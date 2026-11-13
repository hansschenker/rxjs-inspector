import assert from 'node:assert/strict';
import test from 'node:test';
import { getSubscriptionGraph } from '../src/subscription-graph.js';
import { parseTrace, serializeTrace } from '../src/trace.js';
import type { Trace, TraceEvent } from '../src/types.js';

function sharedRecording(): Trace {
  const connection = { nodeId: 'shared', executionId: 'connection:1', role: 'connection' as const, port: 'output' as const };
  const left = { nodeId: 'left', executionId: 'left:1', role: 'boundary' as const, port: 'output' as const };
  const right = { nodeId: 'right', executionId: 'right:1', role: 'boundary' as const, port: 'output' as const };
  const events: TraceEvent[] = [
    { ...left, seq: 1, time: 0, kind: 'subscribe' },
    { ...connection, seq: 2, time: 0, kind: 'subscribe' },
    { ...connection, seq: 3, time: 0, kind: 'link', link: { kind: 'shared', sourceExecutionId: 'connection:1', destinationExecutionId: 'left:1' } },
    { ...right, seq: 4, time: 0, kind: 'subscribe' },
    { ...connection, seq: 5, time: 0, kind: 'link', link: { kind: 'shared', sourceExecutionId: 'connection:1', destinationExecutionId: 'right:1' } },
    { ...left, seq: 6, time: 0, kind: 'unsubscribe' },
    { ...connection, seq: 7, time: 1, kind: 'next', value: { status: 'captured', data: 42 } },
    { ...right, seq: 8, time: 1, kind: 'next', value: { status: 'captured', data: 42 } },
    { ...right, seq: 9, time: 2, kind: 'unsubscribe' },
    { ...connection, seq: 10, time: 2, kind: 'unsubscribe' },
  ];
  return {
    schemaVersion: 2,
    name: 'shared connection graph',
    rxjsBaseline: '7.8.2',
    clock: { name: 'fixture', kind: 'virtual', unit: 'ms' },
    nodes: [
      { id: 'shared', label: 'Shared requests', kind: 'operator', operator: 'share', domain: 'loadRequest$' },
      { id: 'left', label: 'Left consumer', kind: 'sink' },
      { id: 'right', label: 'Right consumer', kind: 'sink' },
    ],
    edges: [{ from: 'shared', to: 'left' }, { from: 'shared', to: 'right' }],
    events,
    capture: { maxEvents: 100, droppedEvents: 0, totalEvents: events.length, complete: true },
  };
}

test('subscription graph uses explicit links before values flow and never reveals future nodes or links', () => {
  const trace = parseTrace(serializeTrace(sharedRecording()));
  assert.deepEqual(getSubscriptionGraph(trace, 0).nodes, []);
  assert.deepEqual(getSubscriptionGraph(trace, 0).edges, []);
  assert.equal(getSubscriptionGraph(trace, 2).edges.length, 0);
  const first = getSubscriptionGraph(trace, 3);
  assert.deepEqual(first.nodes.map(node => node.id), ['left:1', 'connection:1']);
  assert.deepEqual(first.edges.map(edge => [edge.sourceExecutionId, edge.destinationExecutionId]), [['connection:1', 'left:1']]);
  const second = getSubscriptionGraph(trace, 5);
  assert.equal(second.nodes.length, 3);
  assert.equal(second.edges.length, 2);
  assert.ok(second.edges.every(edge => edge.status === 'active'));
  assert.equal(second.evidence, 'observed');
  assert.equal(second.atSeq, 5);
  assert.equal(first.edges[0]?.id, second.edges[0]?.id);
  assert.equal(second.nodes.find(node => node.id === 'connection:1')?.operator, 'share');
  assert.equal(second.nodes.find(node => node.id === 'connection:1')?.domain, 'loadRequest$');
});

test('closing the first consumer does not close its shared source or the second relationship', () => {
  const trace = sharedRecording();
  const graph = getSubscriptionGraph(trace, 6);
  assert.equal(graph.nodes.find(node => node.id === 'left:1')?.status, 'unsubscribed');
  assert.equal(graph.nodes.find(node => node.id === 'connection:1')?.status, 'active');
  assert.deepEqual(graph.edges.map(edge => [edge.destinationExecutionId, edge.status]), [
    ['left:1', 'closed'], ['right:1', 'active'],
  ]);
  assert.equal(getSubscriptionGraph(trace, 9).nodes.find(node => node.id === 'connection:1')?.status, 'active');
  assert.equal(getSubscriptionGraph(trace).nodes.find(node => node.id === 'connection:1')?.status, 'unsubscribed');
  assert.ok(getSubscriptionGraph(trace).edges.every(edge => edge.status === 'closed'));
});

test('independent cold subscription chains keep shared definition labels and distinct runtime relationships', () => {
  const original = sharedRecording();
  const events: TraceEvent[] = [];
  for (const run of [1, 2]) {
    const destination = { nodeId: 'left', executionId: `consumer:${run}`, role: 'boundary' as const, port: 'output' as const };
    const source = { nodeId: 'shared', executionId: `source:${run}`, role: 'boundary' as const, port: 'output' as const };
    for (const event of [
      { ...destination, kind: 'subscribe' as const },
      { ...source, kind: 'subscribe' as const },
      { ...source, kind: 'link' as const, link: { kind: 'upstream' as const, sourceExecutionId: source.executionId, destinationExecutionId: destination.executionId } },
      { ...source, kind: 'complete' as const },
      { ...destination, kind: 'complete' as const },
    ]) events.push({ ...event, seq: events.length + 1, time: run });
  }
  const trace: Trace = { ...original, events, capture: { ...original.capture, totalEvents: events.length } };
  const graph = getSubscriptionGraph(parseTrace(serializeTrace(trace)));
  assert.deepEqual(graph.edges.map(edge => [edge.sourceExecutionId, edge.destinationExecutionId]), [
    ['source:1', 'consumer:1'], ['source:2', 'consumer:2'],
  ]);
  assert.deepEqual(graph.nodes.filter(node => node.nodeId === 'shared').map(node => node.label), ['Shared requests', 'Shared requests']);
  assert.equal(getSubscriptionGraph(trace, 5).nodes.some(node => node.id === 'source:2'), false);
});

test('a retained link reports absent endpoint history with an explicit unknown placeholder', () => {
  const original = sharedRecording();
  const trace: Trace = {
    ...original,
    events: [original.events[2]!],
    capture: { ...original.capture, droppedEvents: 2, totalEvents: 3, complete: false },
  };
  const graph = getSubscriptionGraph(parseTrace(serializeTrace(trace)));
  assert.equal(graph.evidence, 'partial');
  const missing = graph.nodes.find(node => node.id === 'left:1');
  assert.deepEqual(missing, { id: 'left:1', label: 'left:1', status: 'unknown', nextCount: 0, provenance: 'missing-history' });
  assert.equal(missing?.nodeId, undefined);
  assert.equal(missing?.role, undefined);
  assert.equal(graph.nodes.find(node => node.id === 'connection:1')?.provenance, 'missing-history');
  assert.equal(graph.edges[0]?.status, 'unknown');
  assert.deepEqual(getSubscriptionGraph(trace, 2).nodes, []);
});

test('evicted links are not reconstructed from declared edges, matching values, or remaining lifetimes', () => {
  const original = sharedRecording();
  const trace: Trace = {
    ...original,
    events: original.events.slice(5),
    capture: { ...original.capture, droppedEvents: 5, complete: false },
  };
  const graph = getSubscriptionGraph(parseTrace(serializeTrace(trace)));
  assert.equal(graph.edges.length, 0);
  assert.equal(graph.evidence, 'partial');
  assert.equal(graph.nodes.length, 3);
});

test('legacy v1 traces retain their execution nodes without fabricated subscription links', () => {
  const original = sharedRecording();
  const events: TraceEvent[] = original.events.filter(event => event.kind !== 'link').map((event, index) => ({
    ...event, seq: index + 1, role: 'boundary',
  }));
  const trace: Trace = { ...original, schemaVersion: 1, events, capture: { ...original.capture, totalEvents: events.length } };
  const graph = getSubscriptionGraph(parseTrace(serializeTrace(trace)));
  assert.equal(graph.evidence, 'legacy');
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 0);
});

test('graph snapshots are immutable and invalid cursors are rejected', () => {
  const trace = sharedRecording();
  const before = JSON.stringify(trace);
  const graph = getSubscriptionGraph(trace);
  assert.equal(JSON.stringify(trace), before);
  assert.ok(Object.isFrozen(graph));
  assert.ok(Object.isFrozen(graph.nodes));
  assert.ok(Object.isFrozen(graph.nodes[0]));
  assert.ok(Object.isFrozen(graph.edges));
  assert.ok(Object.isFrozen(graph.edges[0]));
  for (const atSeq of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => getSubscriptionGraph(trace, atSeq), /cursor/);
  }
});

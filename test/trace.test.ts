import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTrace, serializeTrace } from '../src/trace.js';
import type { Trace } from '../src/types.js';

function recording(): Trace {
  return {
    schemaVersion: 1,
    name: 'portable history',
    rxjsBaseline: '7.8.2',
    clock: { name: 'test scheduler', kind: 'virtual', unit: 'ms' },
    nodes: [{ id: 'source', label: 'values$', kind: 'source' }, { id: 'result', label: 'result$', kind: 'sink' }],
    edges: [{ from: 'source', to: 'result' }],
    events: [
      { seq: 1, time: 0, nodeId: 'source', executionId: 'source:1', kind: 'subscribe', port: 'output', role: 'boundary' },
      { seq: 2, time: 0, nodeId: 'source', executionId: 'source:1', kind: 'next', port: 'output', role: 'boundary', value: { status: 'captured', data: { nested: [1, 'value', null] } } },
      { seq: 3, time: 10, nodeId: 'source', executionId: 'source:1', kind: 'complete', port: 'output', role: 'boundary' },
    ],
    capture: { maxEvents: 10, droppedEvents: 0, totalEvents: 3, complete: true },
  };
}

function mutableRecording(): any {
  return JSON.parse(JSON.stringify(recording()));
}

test('JSON export/import preserves a portable, deeply immutable recording', () => {
  const encoded = serializeTrace(recording());
  const trace = parseTrace(encoded);
  assert.equal(JSON.stringify(trace), JSON.stringify(recording()));
  assert.equal(serializeTrace(trace), encoded);
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(trace.events));
  assert.ok(Object.isFrozen(trace.events[1]?.value?.data));
  const value = trace.events[1]?.value?.data as { nested: unknown[] };
  assert.ok(Object.isFrozen(value.nested));
  assert.throws(() => value.nested.push('changed'), TypeError);
});

test('imports empty recordings without inventing events', () => {
  const value = mutableRecording();
  value.events = [];
  value.capture.totalEvents = 0;
  assert.equal(parseTrace(JSON.stringify(value)).events.length, 0);
});

test('arbitrary payload property names remain inert data', () => {
  const value = mutableRecording();
  value.events[1].value.data = JSON.parse('{"__proto__":{"polluted":true},"constructor":"domain data","prototype":"domain data"}');
  const parsed = parseTrace(JSON.stringify(value));
  const payload = parsed.events[1]?.value?.data as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(payload), null);
  assert.equal(Object.hasOwn(payload, '__proto__'), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(payload.constructor, 'domain data');
});

test('rejects syntax errors, unsupported schemas, and unexpected structural fields', () => {
  assert.throws(() => parseTrace('{'), /Invalid trace JSON/);
  for (const [field, value] of [['schemaVersion', 3], ['rxjsBaseline', '8.0.0'], ['surprise', true]] as const) {
    const input = mutableRecording();
    input[field] = value;
    assert.throws(() => parseTrace(JSON.stringify(input)), /Invalid trace/);
  }
});

test('validates node identities and graph references', () => {
  const duplicate = mutableRecording();
  duplicate.nodes.push(duplicate.nodes[0]);
  assert.throws(() => parseTrace(JSON.stringify(duplicate)), /duplicate node ID/);
  const missingEdge = mutableRecording();
  missingEdge.edges[0].to = 'missing';
  assert.throws(() => parseTrace(JSON.stringify(missingEdge)), /unknown node/);
  const missingEventNode = mutableRecording();
  missingEventNode.events[1].nodeId = 'missing';
  assert.throws(() => parseTrace(JSON.stringify(missingEventNode)), /unknown node/);
});

test('requires finite times but permits equal timestamps with distinct ordinals', () => {
  assert.equal(parseTrace(serializeTrace(recording())).events[1]?.time, 0);
  const input = mutableRecording();
  input.events[1].time = Infinity;
  assert.throws(() => serializeTrace(input), /finite number/);
  assert.throws(() => parseTrace(JSON.stringify(input)), /finite number/);
});

test('validates ordered suffixes, retention counts, and cause direction', () => {
  const unordered = mutableRecording();
  unordered.events[1].seq = 3;
  assert.throws(() => parseTrace(JSON.stringify(unordered)), /contiguous ordered suffix/);
  const count = mutableRecording();
  count.capture.totalEvents = 4;
  assert.throws(() => parseTrace(JSON.stringify(count)), /droppedEvents \+ retained/);
  const capacity = mutableRecording();
  capacity.capture.maxEvents = 2;
  assert.throws(() => parseTrace(JSON.stringify(capacity)), /exceed maxEvents/);
  const cause = mutableRecording();
  cause.events[1].causeEventSeq = 2;
  assert.throws(() => parseTrace(JSON.stringify(cause)), /cause must precede/);
});

test('retained suffixes may start after an execution subscribed', () => {
  const input = mutableRecording();
  input.events = input.events.slice(1);
  input.events[0].causeEventSeq = 1;
  input.capture.droppedEvents = 1;
  input.capture.complete = false;
  const trace = parseTrace(JSON.stringify(input));
  assert.equal(trace.events[0]?.seq, 2);
  assert.equal(trace.capture.complete, false);
  input.capture.complete = true;
  assert.throws(() => parseTrace(JSON.stringify(input)), /prefix events were dropped/);
});

test('execution identities cannot change or emit after termination', () => {
  const changed = mutableRecording();
  changed.events[1].nodeId = 'result';
  assert.throws(() => parseTrace(JSON.stringify(changed)), /execution metadata changed/);
  const after = mutableRecording();
  after.events[1] = { ...after.events[1], kind: 'complete' };
  assert.throws(() => parseTrace(JSON.stringify(after)), /event after execution termination/);
  const missingStart = mutableRecording();
  missingStart.events[0].kind = 'complete';
  assert.throws(() => parseTrace(JSON.stringify(missingStart)), /begin with subscribe/);
});

test('inner executions require an existing parent in complete recordings', () => {
  const input = mutableRecording();
  input.events[0].role = 'inner';
  assert.throws(() => parseTrace(JSON.stringify(input)), /require parentExecutionId/);
  input.events[0].parentExecutionId = 'missing';
  assert.throws(() => parseTrace(JSON.stringify(input)), /parent execution must already exist/);
});

test('snapshot validation rejects missing data, unsupported values, and cycles', () => {
  const missing = mutableRecording();
  delete missing.events[1].value.data;
  assert.throws(() => parseTrace(JSON.stringify(missing)), /captured values require data/);
  const wrong = mutableRecording();
  wrong.events[1].value.data = { value: undefined };
  assert.throws(() => serializeTrace(wrong), /JSON-only data/);
  const cyclic = mutableRecording();
  const loop: any = {};
  loop.self = loop;
  cyclic.events[1].value.data = loop;
  assert.throws(() => serializeTrace(cyclic), /cyclic payload/);
});

test('unavailable snapshots and reported clock failures survive a round trip', () => {
  const input = mutableRecording();
  input.events[1].value = { status: 'unavailable', reason: 'custom capture failed' };
  input.capture.clockErrors = 2;
  const result = parseTrace(serializeTrace(input));
  assert.equal(result.events[1]?.value?.status, 'unavailable');
  assert.equal((result.capture as any).clockErrors, 2);
  input.capture.clockErrors = -1;
  assert.throws(() => parseTrace(JSON.stringify(input)), /safe integer/);
});

function linkedRecording(): Trace {
  const original = recording();
  return {
    ...original,
    schemaVersion: 2,
    events: [
      { seq: 1, time: 0, nodeId: 'result', executionId: 'consumer:1', kind: 'subscribe', port: 'output', role: 'boundary' },
      { seq: 2, time: 0, nodeId: 'source', executionId: 'source:1', kind: 'subscribe', port: 'output', role: 'connection' },
      { seq: 3, time: 0, nodeId: 'source', executionId: 'source:1', kind: 'link', port: 'output', role: 'connection',
        link: { kind: 'shared', sourceExecutionId: 'source:1', destinationExecutionId: 'consumer:1' } },
    ],
  };
}

test('v2 round trips explicit subscription links and connection roles while v1 remains unchanged', () => {
  const current = linkedRecording();
  const imported = parseTrace(serializeTrace(current));
  assert.deepEqual(imported, current);
  assert.equal(imported.schemaVersion, 2);
  assert.ok(Object.isFrozen(imported.events[2]?.link));
  const legacy = recording();
  assert.equal(JSON.stringify(parseTrace(serializeTrace(legacy))), JSON.stringify(legacy));
  assert.equal(parseTrace(serializeTrace(legacy)).schemaVersion, 1);
});

test('v1 rejects new event kinds, link metadata, and connection roles instead of guessing their meaning', () => {
  const current = JSON.parse(JSON.stringify(linkedRecording()));
  current.schemaVersion = 1;
  assert.throws(() => serializeTrace(current), /Invalid trace/);
  const metadata = mutableRecording();
  metadata.events[1].link = { kind: 'upstream', sourceExecutionId: 'source:1', destinationExecutionId: 'consumer:1' };
  assert.throws(() => serializeTrace(metadata), /unknown field/);
  const role = mutableRecording();
  role.events.forEach((event: any) => { event.role = 'connection'; });
  assert.throws(() => serializeTrace(role), /boundary \| operator \| inner/);
});

test('subscription links require valid distinct endpoints and belong to the source execution', () => {
  for (const change of [
    (value: any) => { value.events[2].link.destinationExecutionId = 'missing'; },
    (value: any) => { value.events[2].link.destinationExecutionId = 'source:1'; },
    (value: any) => { value.events[2].executionId = 'consumer:1'; },
    (value: any) => { value.events[2].link.kind = 'guessed'; },
    (value: any) => { value.events[2].link.extra = true; },
  ]) {
    const value = JSON.parse(JSON.stringify(linkedRecording()));
    change(value);
    assert.throws(() => serializeTrace(value), /Invalid trace/);
  }
});

test('link events require metadata, an output port, and no value payload', () => {
  for (const change of [
    (value: any) => { delete value.events[2].link; },
    (value: any) => { value.events[2].port = 'input'; },
    (value: any) => { value.events[2].value = { status: 'captured', data: 1 }; },
    (value: any) => { value.events[2].kind = 'next'; value.events[2].value = { status: 'captured', data: 1 }; },
  ]) {
    const value = JSON.parse(JSON.stringify(linkedRecording()));
    change(value);
    assert.throws(() => serializeTrace(value), /Invalid trace/);
  }
});

test('duplicate subscription relationships and post-termination link events are rejected', () => {
  const duplicate: any = JSON.parse(JSON.stringify(linkedRecording()));
  duplicate.events.push({ ...duplicate.events[2], seq: 4 });
  duplicate.capture.totalEvents = 4;
  assert.throws(() => serializeTrace(duplicate), /duplicate subscription link/);

  const ended: any = JSON.parse(JSON.stringify(linkedRecording()));
  ended.events.splice(2, 0, { ...ended.events[1], seq: 3, kind: 'complete' });
  ended.events[3].seq = 4;
  ended.capture.totalEvents = 4;
  assert.throws(() => serializeTrace(ended), /event after execution termination/);

  const destinationEnded: any = JSON.parse(JSON.stringify(linkedRecording()));
  destinationEnded.events.splice(2, 0, { ...destinationEnded.events[0], seq: 3, kind: 'unsubscribe' });
  destinationEnded.events[3].seq = 4;
  destinationEnded.capture.totalEvents = 4;
  assert.throws(() => serializeTrace(destinationEnded), /destination already terminated/);
});

test('v2 relationship kinds preserve inner-parent and shared-connection semantics', () => {
  const shared: any = JSON.parse(JSON.stringify(linkedRecording()));
  shared.events[1].role = 'boundary';
  shared.events[2].role = 'boundary';
  assert.throws(() => serializeTrace(shared), /shared link must originate from a connection/);
  const inner: any = JSON.parse(JSON.stringify(linkedRecording()));
  inner.events[2].link.kind = 'inner';
  assert.throws(() => serializeTrace(inner), /inner link must connect/);
  const parent: any = JSON.parse(JSON.stringify(linkedRecording()));
  parent.events[1].parentExecutionId = 'consumer:1';
  assert.throws(() => serializeTrace(parent), /only inner executions/);
});

test('evicted endpoint starts are allowed but a retained future start cannot precede its link', () => {
  const original = linkedRecording();
  const partial: Trace = {
    ...original,
    events: original.events.slice(2),
    capture: { ...original.capture, droppedEvents: 2, complete: false },
  };
  assert.deepEqual(parseTrace(serializeTrace(partial)), partial);
  const future: Trace = {
    ...partial,
    events: [...partial.events, { ...original.events[0]!, seq: 4 }],
    capture: { ...partial.capture, totalEvents: 4 },
  };
  assert.throws(() => serializeTrace(future), /endpoints must already exist/);
});

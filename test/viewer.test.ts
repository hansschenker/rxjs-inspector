import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { mountInspector } from '../src/viewer.js';
import { getExecutions } from '../src/analysis.js';
import { getSubscriptionGraph } from '../src/subscription-graph.js';
import { createDemoTrace } from '../examples/demo.js';
import type { Trace, TraceEvent } from '../src/types.js';

function fixture(): Trace {
  const events: TraceEvent[] = [
    { seq: 1, time: 0, nodeId: 'results', executionId: 'result-1', role: 'boundary', port: 'output', kind: 'subscribe' },
    { seq: 2, time: 0, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'output', kind: 'subscribe' },
    { seq: 3, time: 0, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'input', kind: 'next', value: { status: 'captured', data: 'A' } },
    { seq: 4, time: 0, nodeId: 'latest', executionId: 'inner-a', role: 'inner', port: 'output', kind: 'subscribe', parentExecutionId: 'switch-1', causeEventSeq: 3 },
    { seq: 5, time: 40, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'input', kind: 'next', value: { status: 'captured', data: 'B' } },
    { seq: 6, time: 40, nodeId: 'latest', executionId: 'inner-a', role: 'inner', port: 'output', kind: 'unsubscribe', parentExecutionId: 'switch-1', causeEventSeq: 5 },
    { seq: 7, time: 40, nodeId: 'latest', executionId: 'inner-b', role: 'inner', port: 'output', kind: 'subscribe', parentExecutionId: 'switch-1', causeEventSeq: 5 },
    { seq: 8, time: 50, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'input', kind: 'complete' },
    { seq: 9, time: 70, nodeId: 'latest', executionId: 'inner-b', role: 'inner', port: 'output', kind: 'next', parentExecutionId: 'switch-1', value: { status: 'captured', data: '<img src=x onerror="globalThis.bad=true">' } },
    { seq: 10, time: 70, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'output', kind: 'next', causeEventSeq: 9, value: { status: 'captured', data: 'B result' } },
    { seq: 11, time: 70, nodeId: 'results', executionId: 'result-1', role: 'boundary', port: 'output', kind: 'next', causeEventSeq: 10, value: { status: 'captured', data: 'B result' } },
    { seq: 12, time: 90, nodeId: 'latest', executionId: 'inner-b', role: 'inner', port: 'output', kind: 'complete', parentExecutionId: 'switch-1' },
    { seq: 13, time: 90, nodeId: 'latest', executionId: 'switch-1', role: 'operator', port: 'output', kind: 'complete' },
    { seq: 14, time: 90, nodeId: 'results', executionId: 'result-1', role: 'boundary', port: 'output', kind: 'complete' },
  ];
  return {
    schemaVersion: 1, name: 'Viewer test', rxjsBaseline: '7.8.2',
    clock: { name: 'Test clock', kind: 'virtual', unit: 'ms' },
    nodes: [{ id: 'latest', label: 'switchMap', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' }, { id: 'results', label: 'results$', kind: 'sink' }],
    edges: [{ from: 'latest', to: 'results' }], events,
    capture: { maxEvents: 100, totalEvents: events.length, droppedEvents: 0, complete: true },
  };
}

function subscriptionFixture(): Trace {
  const events: TraceEvent[] = [
    { seq: 1, time: 0, nodeId: 'consumer-a', executionId: 'consumer-a-1', role: 'boundary', port: 'output', kind: 'subscribe' },
    { seq: 2, time: 0, nodeId: 'shared', executionId: 'connection-1', role: 'connection', port: 'output', kind: 'subscribe' },
    { seq: 3, time: 0, nodeId: 'shared', executionId: 'connection-1', role: 'connection', port: 'output', kind: 'link', link: { kind: 'shared', sourceExecutionId: 'connection-1', destinationExecutionId: 'consumer-a-1' } },
    { seq: 4, time: 5, nodeId: 'consumer-b', executionId: 'consumer-b-1', role: 'boundary', port: 'output', kind: 'subscribe' },
    { seq: 5, time: 5, nodeId: 'shared', executionId: 'connection-1', role: 'connection', port: 'output', kind: 'link', link: { kind: 'shared', sourceExecutionId: 'connection-1', destinationExecutionId: 'consumer-b-1' } },
    { seq: 6, time: 15, nodeId: 'consumer-a', executionId: 'consumer-a-1', role: 'boundary', port: 'output', kind: 'unsubscribe' },
    { seq: 7, time: 25, nodeId: 'shared', executionId: 'connection-1', role: 'connection', port: 'output', kind: 'next', value: { status: 'captured', data: 'Still connected' } },
    { seq: 8, time: 35, nodeId: 'consumer-b', executionId: 'consumer-b-1', role: 'boundary', port: 'output', kind: 'unsubscribe' },
    { seq: 9, time: 35, nodeId: 'shared', executionId: 'connection-1', role: 'connection', port: 'output', kind: 'unsubscribe' },
  ];
  return {
    schemaVersion: 2, name: 'Shared subscription graph', rxjsBaseline: '7.8.2',
    clock: { name: 'Test clock', kind: 'virtual', unit: 'ms' },
    nodes: [
      { id: 'shared', label: 'Shared packages', kind: 'operator', operator: 'share' },
      { id: 'consumer-a', label: 'Consumer A', kind: 'sink' },
      { id: 'consumer-b', label: 'Consumer B', kind: 'sink' },
    ],
    edges: [{ from: 'shared', to: 'consumer-a' }, { from: 'shared', to: 'consumer-b' }], events,
    capture: { maxEvents: 100, totalEvents: events.length, droppedEvents: 0, complete: true },
  };
}

function mounted(trace = fixture()) {
  const { document, window } = parseHTML('<html><body><main id="host"><p>Existing content</p></main></body></html>');
  const host = document.getElementById('host') as unknown as HTMLElement;
  const view = mountInspector(host, trace);
  const query = <T extends Element>(selector: string): T => {
    const node = host.querySelector<T>(selector);
    assert.ok(node, selector);
    return node;
  };
  function choose(seq: number): void {
    const select = query<HTMLSelectElement>('select');
    const options = Array.from(select.options);
    for (const option of options) option.selected = false;
    const option = options.find(item => item.value === String(seq));
    assert.ok(option);
    option.selected = true;
    select.dispatchEvent(new window.Event('change'));
  }
  return { host, view, query, choose, window };
}

test('event navigation synchronizes selected event, stage, lifetime, and reconstructed state', () => {
  const { query, choose, view } = mounted();
  assert.equal(query<HTMLButtonElement>('[data-action=previous]').disabled, true);
  choose(8);
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#8.*50 ms/);
  assert.equal(query<HTMLElement>('[data-node=latest]').dataset.selected, 'true');
  assert.match(query<HTMLElement>('.rx-detail').textContent ?? '', /inner-b/);
  assert.match(query<HTMLElement>('.rx-provenance').textContent ?? '', /Reconstructed/);
  query<HTMLButtonElement>('[data-action=next]').click();
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#9/);
  assert.equal(query<HTMLElement>('[data-execution=inner-b]').dataset.selected, 'true');
  choose(14);
  assert.equal(query<HTMLButtonElement>('[data-action=next]').disabled, true);
  view.destroy();
});

test('captured strings render as text and cause navigation uses the recorded ordinal', () => {
  const { query, choose, host, view } = mounted();
  choose(9);
  assert.match(query<HTMLElement>('.rx-value').textContent ?? '', /<img/);
  assert.equal(host.querySelector('img'), null);
  choose(10);
  query<HTMLButtonElement>('[data-action=cause]').click();
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#9/);
  view.destroy();
});

test('subscription graph shows only executions and links observed by the selected event', () => {
  const { host, query, choose, view } = mounted(subscriptionFixture());
  assert.equal(host.querySelectorAll('[data-subscription]').length, 1);
  assert.equal(host.querySelector('[data-subscription=connection-1]'), null);
  assert.equal(host.querySelectorAll('[data-connection]').length, 0);
  assert.match(query<HTMLElement>('.rx-connections').textContent ?? '', /Shared packages → Consumer B/);
  choose(2);
  assert.equal(host.querySelectorAll('[data-subscription]').length, 2);
  assert.equal(host.querySelectorAll('[data-connection]').length, 0);
  choose(3);
  assert.equal(host.querySelectorAll('[data-connection]').length, 1);
  assert.equal(host.querySelector('[data-subscription=consumer-b-1]'), null);
  choose(5);
  assert.equal(host.querySelectorAll('[data-subscription]').length, 3);
  assert.equal(host.querySelectorAll('[data-connection][data-status=active]').length, 2);
  assert.match(query<HTMLElement>('[data-subscription=connection-1]').textContent ?? '', /shared source connection · Active/);
  assert.equal(query<HTMLElement>('.rx-subscription-evidence').dataset.evidence, 'observed');
  choose(6);
  assert.equal(query<HTMLElement>('[data-subscription=consumer-a-1]').dataset.status, 'unsubscribed');
  assert.equal(query<HTMLElement>('[data-subscription=connection-1]').dataset.status, 'active');
  assert.equal(query<HTMLElement>('[data-subscription=consumer-b-1]').dataset.status, 'active');
  assert.equal(query<HTMLElement>('[data-sequence="3"]').dataset.status, 'closed');
  assert.equal(query<HTMLElement>('[data-sequence="5"]').dataset.status, 'active');
  choose(9);
  assert.equal(host.querySelectorAll('[data-connection][data-status=closed]').length, 2);
  choose(1);
  assert.equal(host.querySelectorAll('[data-subscription]').length, 1);
  assert.equal(host.querySelectorAll('[data-connection]').length, 0);
  view.destroy();
});

test('subscription cards and accessible relationship buttons synchronize the timeline without selecting future events', () => {
  const { query, choose, view } = mounted(subscriptionFixture());
  choose(7);
  const consumer = query<HTMLButtonElement>('[data-subscription=consumer-b-1]');
  assert.equal(consumer.type, 'button');
  consumer.click();
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#4/);
  assert.equal(query<HTMLElement>('[data-subscription=consumer-b-1]').getAttribute('aria-pressed'), 'true');
  assert.equal(query<HTMLElement>('[data-execution=consumer-b-1]').dataset.selected, 'true');
  assert.match(query<HTMLElement>('.rx-detail-title').textContent ?? '', /subscribe.*Consumer B/);
  choose(7);
  const relationship = query<HTMLButtonElement>('[data-sequence="5"]');
  assert.match(relationship.getAttribute('aria-label') ?? '', /Shared packages.*Consumer B.*shared.*Active.*event 5/);
  relationship.click();
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#5/);
  assert.equal(query<HTMLElement>('[data-execution=connection-1]').dataset.selected, 'true');
  assert.match(query<HTMLElement>('.rx-detail').textContent ?? '', /Source executionconnection-1Destination executionconsumer-b-1/);
  assert.match(query<HTMLElement>('.rx-provenance').textContent ?? '', /Recorded shared source connection/);
  view.destroy();
});

test('legacy recordings retain declared definitions and clearly lack runtime relationship evidence', () => {
  const { query, choose, host, view } = mounted();
  choose(14);
  assert.match(query<HTMLElement>('.rx-connections').textContent ?? '', /switchMap → results\$/);
  assert.equal(host.querySelectorAll('[data-subscription]').length, 4);
  assert.equal(host.querySelectorAll('[data-connection]').length, 0);
  assert.equal(query<HTMLElement>('.rx-subscription-evidence').dataset.evidence, 'legacy');
  assert.match(query<HTMLElement>('.rx-subscription-evidence').textContent ?? '', /version 1.*no explicit subscription relationships/);
  assert.match(query<HTMLElement>('.rx-subscription-note').textContent ?? '', /version 2/);
  view.destroy();
});

test('partial graph history uses unknown endpoint placeholders and safely renders stable labels', () => {
  const original = subscriptionFixture();
  const label = '<img src=x onerror="globalThis.bad=true">';
  const partial: Trace = {
    ...original,
    nodes: original.nodes.map(node => node.id === 'shared' ? { ...node, label } : node),
    events: original.events.slice(4),
    capture: { ...original.capture, droppedEvents: 4, complete: false },
  };
  const { query, host, view } = mounted(partial);
  const placeholder = query<HTMLButtonElement>('[data-subscription=consumer-b-1]');
  assert.equal(placeholder.dataset.status, 'unknown');
  assert.equal(placeholder.dataset.provenance, 'missing-history');
  assert.equal(placeholder.disabled, true);
  assert.match(placeholder.textContent ?? '', /^consumer-b-1/);
  assert.doesNotMatch(placeholder.textContent ?? '', /Consumer B/);
  assert.equal(query<HTMLElement>('.rx-subscription-evidence').dataset.evidence, 'partial');
  assert.match(query<HTMLElement>('.rx-subscription-evidence').textContent ?? '', /absent edge does not establish/);
  assert.equal(query<HTMLElement>('[data-sequence="5"]').dataset.status, 'unknown');
  assert.match(query<HTMLElement>('[data-subscription=connection-1]').textContent ?? '', /<img/);
  assert.match(query<HTMLElement>('[data-sequence="5"]').textContent ?? '', /<img/);
  assert.equal(host.querySelector('img'), null);
  view.destroy();
});

test('invalid JSON import keeps the existing recording and reports the error', async () => {
  const { query, window, view } = mounted();
  const input = query<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'bad.json', size: 4, text: async () => '{bad' }] });
  input.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(query<HTMLElement>('.rx-message').textContent ?? '', /Import failed/);
  assert.match(query<HTMLElement>('.rx-trace-name').textContent ?? '', /Viewer test/);
  view.destroy();
});

test('valid JSON import replaces the recording and resets selection', async () => {
  const { query, choose, window, view } = mounted();
  choose(8);
  const input = query<HTMLInputElement>('input[type=file]');
  const imported = { ...fixture(), name: 'Imported trace' };
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'valid.json', size: 1000, text: async () => JSON.stringify(imported) }] });
  input.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(query<HTMLElement>('.rx-trace-name').textContent ?? '', /Imported trace/);
  assert.match(query<HTMLElement>('.rx-position').textContent ?? '', /#1/);
  view.destroy();
});

test('destroy cancels a pending import and leaves unrelated host content intact', async () => {
  const { query, window, view, host } = mounted();
  let finish!: (text: string) => void;
  const pending = new Promise<string>(resolve => { finish = resolve; });
  const input = query<HTMLInputElement>('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'pending.json', size: 1000, text: () => pending }] });
  input.dispatchEvent(new window.Event('change'));
  view.destroy();
  finish(JSON.stringify(fixture()));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.querySelector('.rx-inspector'), null);
  assert.match(host.textContent ?? '', /Existing content/);
  assert.throws(() => view.setTrace(fixture()), /destroyed/);
  view.destroy();
});

test('empty recordings and setTrace are supported without fabricating executions', () => {
  const original = fixture();
  const empty = { ...original, events: [], capture: { maxEvents: 100, totalEvents: 0, droppedEvents: 0, complete: true } };
  const { query, view } = mounted(empty);
  assert.equal(query<HTMLButtonElement>('[data-action=next]').disabled, true);
  assert.match(query<HTMLElement>('.rx-lanes').textContent ?? '', /No subscription executions/);
  view.setTrace(original);
  assert.equal(query<HTMLSelectElement>('select').options.length, 14);
  view.destroy();
});

test('browser example records real switchMap cancellation and delayed completion', () => {
  const trace = createDemoTrace('switchMap');
  const executions = getExecutions(trace);
  assert.equal(executions.find(item => item.role === 'inner' && item.status === 'unsubscribed')?.endTime, 40);
  assert.equal(executions.find(item => item.nodeId === 'queries')?.endTime, 50);
  assert.equal(executions.find(item => item.nodeId === 'results')?.endTime, 90);
  assert.deepEqual(trace.events.filter(event => event.nodeId === 'results' && event.kind === 'next').map(event => event.value?.data), [{ query: 'B', result: 'Result for B' }]);
});

test('browser examples distinguish independent execution, explicit sharing, errors, and disposal', () => {
  const independent = getExecutions(createDemoTrace('independent'));
  const shared = getExecutions(createDemoTrace('shared'));
  assert.equal(independent.filter(item => item.nodeId === 'producer').length, 2);
  assert.equal(shared.filter(item => item.nodeId === 'producer').length, 1);
  const errored = getExecutions(createDemoTrace('error'));
  assert.equal(errored.find(item => item.nodeId === 'results')?.status, 'errored');
  const disposed = createDemoTrace('unsubscribe');
  assert.equal(disposed.events.some(event => event.kind === 'complete'), false);
  assert.ok(getExecutions(disposed).every(item => item.status === 'unsubscribed' && item.endTime === 35));
});

test('labelled operator example keeps stable definitions across two separate cold executions', () => {
  const trace = createDemoTrace('labels');
  assert.deepEqual(trace.nodes.filter(node => node.kind === 'operator').map(node => [node.id, node.operator, node.domain]), [
    ['double', 'map', 'doubleValue'], ['accept', 'filter', 'aboveTwo'], ['total', 'scan', 'addValue'],
  ]);
  assert.deepEqual(trace.events.filter(event => event.nodeId === 'results' && event.kind === 'next').map(event => event.value?.data), [4, 10, 4, 10]);
  const executions = getExecutions(trace);
  assert.equal(executions.filter(execution => execution.nodeId === 'total').length, 2);
  assert.equal(new Set(executions.map(execution => execution.id)).size, 10);
  const { query, choose, view } = mounted(trace);
  const event = trace.events.find(item => item.nodeId === 'total' && item.kind === 'next');
  assert.ok(event);
  choose(event.seq);
  assert.match(query<HTMLElement>('[data-node=total]').textContent ?? '', /Running total.*Definition: total.*scan.*addValue/);
  assert.match(query<HTMLElement>('.rx-provenance').textContent ?? '', /Recorded boundary/);
  view.destroy();
});

test('shared example records both consumers before values and keeps its connection after the first leaves', () => {
  const trace = createDemoTrace('shared');
  const connection = getExecutions(trace).find(execution => execution.role === 'connection');
  assert.ok(connection);
  assert.equal(connection.endTime, 35);
  const beforeValues = trace.events.findLast(event => event.time === 5);
  assert.ok(beforeValues);
  const joined = getSubscriptionGraph(trace, beforeValues.seq);
  assert.equal(joined.edges.filter(edge => edge.kind === 'shared' && edge.status === 'active').length, 2);
  assert.ok(joined.nodes.every(node => node.nextCount === 0));
  const firstLeaves = trace.events.findLast(event => event.time === 15);
  assert.ok(firstLeaves);
  const { query, choose, host, view } = mounted(trace);
  choose(firstLeaves.seq);
  assert.equal(query<HTMLElement>(`[data-subscription="${connection.id}"]`).dataset.status, 'active');
  assert.equal(host.querySelectorAll('[data-kind=shared][data-status=active]').length, 1);
  assert.equal(host.querySelectorAll('[data-kind=shared][data-status=closed]').length, 1);
  view.destroy();
});

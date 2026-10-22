import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { mountInspector } from '../src/viewer.js';
import { getExecutions } from '../src/analysis.js';
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

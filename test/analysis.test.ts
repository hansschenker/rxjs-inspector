import assert from 'node:assert/strict';
import test from 'node:test';
import { explainEvent, getExecutions, getSwitchMapState } from '../src/analysis.js';
import type { Trace, TraceEvent } from '../src/types.js';

function recording(): Trace {
  function event(seq: number, time: number, kind: TraceEvent['kind'], options: Partial<TraceEvent> = {}): TraceEvent {
    return {
      seq,
      time,
      kind,
      nodeId: 'latest',
      executionId: 'operator:1',
      port: 'output',
      role: 'operator',
      ...((kind === 'next' || kind === 'error') ? { value: { status: 'captured' as const, data: seq } } : {}),
      ...options,
    };
  }
  const innerA = { executionId: 'inner:A', role: 'inner' as const, parentExecutionId: 'operator:1', innerIndex: 0 };
  const innerB = { executionId: 'inner:B', role: 'inner' as const, parentExecutionId: 'operator:1', innerIndex: 1 };
  const events = [
    event(1, 0, 'subscribe'),
    event(2, 0, 'next', { port: 'input' }),
    event(3, 0, 'subscribe', { ...innerA, causeEventSeq: 2 }),
    event(4, 40, 'next', { port: 'input' }),
    event(5, 40, 'unsubscribe', { ...innerA, causeEventSeq: 4 }),
    event(6, 40, 'subscribe', { ...innerB, causeEventSeq: 4 }),
    event(7, 50, 'complete', { port: 'input' }),
    event(8, 70, 'next', innerB),
    event(9, 70, 'next', { causeEventSeq: 8 }),
    event(10, 90, 'complete', innerB),
    event(11, 90, 'complete', { causeEventSeq: 10 }),
  ];
  return {
    schemaVersion: 1,
    name: 'switchMap investigation',
    rxjsBaseline: '7.8.2',
    clock: { name: 'virtual', kind: 'virtual', unit: 'ms' },
    nodes: [{ id: 'latest', label: 'Latest result', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' }],
    edges: [],
    events,
    capture: { maxEvents: 100, droppedEvents: 0, totalEvents: events.length, complete: true },
  };
}

test('event cursor distinguishes synchronous cancellation and replacement at the same time', () => {
  const trace = recording();
  assert.equal(getSwitchMapState(trace, 'operator:1', 4).activeInnerId, 'inner:A');
  assert.equal(getSwitchMapState(trace, 'operator:1', 5).activeInnerId, null);
  assert.equal(getSwitchMapState(trace, 'operator:1', 6).activeInnerId, 'inner:B');
  assert.equal(getExecutions(trace, 5).find((execution) => execution.id === 'inner:A')?.status, 'unsubscribed');
  assert.equal(getExecutions(trace, 5).some((execution) => execution.id === 'inner:B'), false);
});

test('outer completion leaves active inner and output open until their own terminals', () => {
  const trace = recording();
  const waiting = getSwitchMapState(trace, 'operator:1', 7);
  assert.equal(waiting.outerCompleted, true);
  assert.equal(waiting.outputStatus, 'active');
  assert.equal(waiting.activeInnerId, 'inner:B');
  assert.match(waiting.explanation, /output stays open/);
  assert.equal(getExecutions(trace, 7).find((execution) => execution.id === 'operator:1')?.status, 'active');
  const beforeOutput = getSwitchMapState(trace, 'operator:1', 10);
  assert.equal(beforeOutput.activeInnerId, null);
  assert.equal(beforeOutput.outputStatus, 'active');
  assert.match(beforeOutput.explanation, /completion has not yet been observed/);
  const ended = getSwitchMapState(trace, 'operator:1');
  assert.equal(ended.outputStatus, 'completed');
  assert.equal(ended.activeInnerId, null);
});

test('lifetime summaries preserve each execution and count output notifications only', () => {
  const executions = getExecutions(recording());
  assert.equal(executions.length, 3);
  assert.deepEqual(executions.map((execution) => [execution.id, execution.status, execution.startTime, execution.endTime, execution.nextCount]), [
    ['operator:1', 'completed', 0, 90, 1],
    ['inner:A', 'unsubscribed', 0, 40, 0],
    ['inner:B', 'completed', 40, 90, 1],
  ]);
  assert.ok(Object.isFrozen(executions));
  assert.ok(Object.isFrozen(executions[0]));
});

test('missing subscription history yields unavailable state instead of invented initial state', () => {
  const original = recording();
  const trace: Trace = {
    ...original,
    events: original.events.slice(4),
    capture: { ...original.capture, droppedEvents: 4, complete: false },
  };
  const state = getSwitchMapState(trace, 'operator:1', 7);
  assert.equal(state.provenance, 'unavailable');
  assert.match(state.explanation, /outside the retained history/);
  assert.equal(getExecutions(trace, 7).find((execution) => execution.id === 'operator:1')?.status, 'unknown');
  const innerA = getExecutions(trace, 7).find((execution) => execution.id === 'inner:A');
  assert.equal(innerA?.startTime, undefined);
  assert.equal(innerA?.status, 'unsubscribed');
});

test('an execution started within retained history can be reconstructed despite earlier eviction', () => {
  const original = recording();
  const trace: Trace = {
    ...original,
    events: original.events.map((event) => ({ ...event, seq: event.seq + 20, ...(event.causeEventSeq !== undefined ? { causeEventSeq: event.causeEventSeq + 20 } : {}) })),
    capture: { ...original.capture, droppedEvents: 20, totalEvents: 31, complete: false },
  };
  assert.equal(getSwitchMapState(trace, 'operator:1', 27).provenance, 'reconstructed');
  assert.equal(getSwitchMapState(trace, 'operator:1', 27).activeInnerId, 'inner:B');
});

test('state stays scoped to a subscription when a definition has multiple executions', () => {
  const original = recording();
  const second: TraceEvent[] = [
    { ...original.events[0]!, seq: 12, time: 100, executionId: 'operator:2' },
    { ...original.events[1]!, seq: 13, time: 100, executionId: 'operator:2' },
    { ...original.events[2]!, seq: 14, time: 100, executionId: 'inner:C', parentExecutionId: 'operator:2', causeEventSeq: 13 },
  ];
  const trace: Trace = { ...original, events: [...original.events, ...second], capture: { ...original.capture, totalEvents: 14 } };
  assert.equal(getSwitchMapState(trace, 'operator:1').outputStatus, 'completed');
  assert.equal(getSwitchMapState(trace, 'operator:1').activeInnerId, null);
  assert.equal(getSwitchMapState(trace, 'operator:2').outputStatus, 'active');
  assert.equal(getSwitchMapState(trace, 'operator:2').activeInnerId, 'inner:C');
});

test('unknown executions and unsupported nodes expose unavailable models', () => {
  const trace = recording();
  assert.deepEqual(getExecutions(trace, 0), []);
  assert.equal(getSwitchMapState(trace, 'operator:1', 0).provenance, 'unavailable');
  assert.equal(getSwitchMapState(trace, 'missing').outputStatus, 'unknown');
  const other: Trace = { ...trace, nodes: [{ id: 'latest', label: 'Other', kind: 'operator', operator: 'mergeMap' }] };
  assert.equal(getSwitchMapState(other, 'operator:1').provenance, 'unavailable');
});

test('reentrant overlapping inners disable the simple switchMap model while preserving facts', () => {
  const original = recording();
  const events: TraceEvent[] = [
    original.events[0]!,
    original.events[1]!,
    original.events[2]!,
    { ...original.events[5]!, seq: 4, time: 0, causeEventSeq: 2 },
  ];
  const trace: Trace = { ...original, events, capture: { ...original.capture, totalEvents: 4 } };
  const state = getSwitchMapState(trace, 'operator:1');
  assert.equal(state.provenance, 'unavailable');
  assert.equal(state.activeInnerId, null);
  assert.match(state.explanation, /Reentrant or overlapping/);
  assert.equal(getExecutions(trace).filter((execution) => execution.role === 'inner' && execution.status === 'active').length, 2);
});

test('explanations distinguish observed unsubscription and model-backed replacement', () => {
  const trace = recording();
  assert.match(explainEvent(trace, trace.events[4]!), /replacement by the latest input/);
  assert.match(explainEvent(trace, trace.events[4]!), /Transport abort requires separate evidence/);
  assert.match(explainEvent(trace, trace.events[6]!), /outer input completed/);
  assert.match(explainEvent(trace, trace.events[10]!), /completion notification/);
  assert.match(explainEvent(trace, { ...trace.events[4]!, causeEventSeq: 1 }), /unsubscribed before an output terminal/);
});

test('contradictory completion observations do not become confident model explanations', () => {
  const original = recording();
  const events: TraceEvent[] = [original.events[0]!, { ...original.events[10]!, seq: 2, time: 0, causeEventSeq: 1 }];
  const trace: Trace = { ...original, events, capture: { ...original.capture, totalEvents: 2 } };
  const state = getSwitchMapState(trace, 'operator:1');
  assert.equal(state.provenance, 'unavailable');
  assert.equal(state.outputStatus, 'completed');
  assert.match(state.explanation, /outside the supported/);
});

test('rejects ambiguous invalid cursor numbers', () => {
  const trace = recording();
  for (const value of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => getExecutions(trace, value), /cursor/);
    assert.throws(() => getSwitchMapState(trace, 'operator:1', value), /cursor/);
  }
});

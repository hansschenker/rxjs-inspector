import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Observable,
  Subject,
  Subscriber,
  VirtualTimeScheduler,
  of,
  share,
  switchMap,
  take,
  type Subscription,
} from 'rxjs';
import { createInspector } from '../src/recorder.js';
import { parseTrace, serializeTrace } from '../src/trace.js';
import type { Trace, TraceEvent, TraceNode } from '../src/types.js';

const nodes: readonly TraceNode[] = [
  { id: 'source', label: 'queries$', kind: 'source' },
  { id: 'latest', label: 'latest result', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' },
  { id: 'output', label: 'results$', kind: 'sink' },
  { id: 'left', label: 'left consumer', kind: 'sink' },
  { id: 'right', label: 'right consumer', kind: 'sink' },
];

function makeInspector(options: Partial<Parameters<typeof createInspector>[0]> = {}) {
  return createInspector({ name: 'recorder test', nodes, ...options });
}

function nodeEvents(trace: Trace, nodeId: string): readonly TraceEvent[] {
  return trace.events.filter(event => event.nodeId === nodeId);
}

function outputValues(trace: Trace, nodeId: string) {
  return nodeEvents(trace, nodeId)
    .filter(event => event.kind === 'next' && event.port === 'output')
    .map(event => event.value?.data);
}

test('constructing and inspecting an Observable stays lazy and adds no subscription', () => {
  const inspector = makeInspector();
  let starts = 0;
  const source$ = new Observable<number>(subscriber => {
    starts += 1;
    subscriber.next(starts);
    subscriber.complete();
  });
  const observed$ = source$.pipe(inspector.inspect<number>('source'));
  assert.equal(starts, 0);
  assert.equal(inspector.getTrace().events.length, 0);

  const values: number[] = [];
  observed$.subscribe(value => values.push(value));
  observed$.subscribe(value => values.push(value));

  assert.equal(starts, 2);
  assert.deepEqual(values, [1, 2]);
  const trace = inspector.getTrace();
  const subscriptions = trace.events.filter(event => event.kind === 'subscribe');
  assert.equal(subscriptions.length, 2);
  assert.notEqual(subscriptions[0]?.executionId, subscriptions[1]?.executionId);
  assert.deepEqual(trace.events.map(event => event.kind), [
    'subscribe', 'next', 'complete', 'subscribe', 'next', 'complete',
  ]);
});

test('synchronous take(1) immediately closes the observed upstream execution', () => {
  const inspector = makeInspector();
  let produced = 0;
  let teardowns = 0;
  const source$ = new Observable<number>(subscriber => {
    for (let value = 1; value <= 3 && !subscriber.closed; value += 1) {
      produced += 1;
      subscriber.next(value);
    }
    if (!subscriber.closed) subscriber.complete();
    return () => { teardowns += 1; };
  });
  const values: number[] = [];
  source$.pipe(inspector.inspect<number>('source'), take(1)).subscribe(value => values.push(value));

  assert.deepEqual(values, [1]);
  assert.equal(produced, 1);
  assert.equal(teardowns, 1);
  assert.deepEqual(nodeEvents(inspector.getTrace(), 'source').map(event => event.kind), [
    'subscribe', 'next', 'unsubscribe',
  ]);
});

test('explicit disposal inside synchronous next propagates before another value is produced', () => {
  const inspector = makeInspector();
  const values: number[] = [];
  const sink = new Subscriber<number>({
    next(value) { values.push(value); sink.unsubscribe(); },
    error(error) { throw error; },
    complete() { assert.fail('disposed consumer must not complete'); },
  });
  of(1, 2, 3).pipe(inspector.inspect<number>('source')).subscribe(sink);
  assert.deepEqual(values, [1]);
  assert.deepEqual(outputValues(inspector.getTrace(), 'source'), [1]);
  assert.deepEqual(inspector.getTrace().events.map(event => event.kind), ['subscribe', 'next', 'unsubscribe']);
});

test('completion, error, and early disposal remain distinct terminal reasons', () => {
  const inspector = makeInspector();
  const error = new Error('source failed');
  let received: unknown;
  new Observable(subscriber => subscriber.error(error))
    .pipe(inspector.inspect('source'))
    .subscribe({ error(value) { received = value; } });
  const live$ = new Subject<number>();
  const live = live$.pipe(inspector.inspect<number>('left')).subscribe();
  live.unsubscribe();
  of('done').pipe(inspector.inspect<string>('right')).subscribe();

  const trace = inspector.getTrace();
  assert.equal(received, error);
  assert.deepEqual(nodeEvents(trace, 'source').map(event => event.kind), ['subscribe', 'error']);
  assert.deepEqual(nodeEvents(trace, 'left').map(event => event.kind), ['subscribe', 'unsubscribe']);
  assert.deepEqual(nodeEvents(trace, 'right').map(event => event.kind), ['subscribe', 'next', 'complete']);
});

test('switchMap cancels the replaced inner and waits for its active inner after outer completion', () => {
  const scheduler = new VirtualTimeScheduler();
  const inspector = makeInspector({ clock: { name: 'fixture', kind: 'virtual', now: () => scheduler.now() } });
  const queries$ = new Subject<string>();
  const values: Array<[number, string]> = [];
  const teardowns: Array<[number, string]> = [];
  let completedAt: number | undefined;

  function loadResult$(query: string): Observable<string> {
    return new Observable(subscriber => {
      const result = scheduler.schedule(() => subscriber.next(`result:${query}`), query === 'A' ? 80 : 30);
      const completion = scheduler.schedule(() => subscriber.complete(), query === 'A' ? 100 : 50);
      return () => {
        result.unsubscribe();
        completion.unsubscribe();
        teardowns.push([scheduler.now(), query]);
      };
    });
  }

  queries$.pipe(
    inspector.inspect<string>('source'),
    inspector.switchMap('latest', loadResult$),
    inspector.inspect<string>('output'),
  ).subscribe({
    next(value) { values.push([scheduler.now(), value]); },
    complete() { completedAt = scheduler.now(); },
  });
  scheduler.schedule(() => queries$.next('A'), 0);
  scheduler.schedule(() => queries$.next('B'), 40);
  scheduler.schedule(() => queries$.complete(), 50);
  scheduler.flush();

  assert.deepEqual(values, [[70, 'result:B']]);
  assert.equal(completedAt, 90);
  assert.deepEqual(teardowns, [[40, 'A'], [90, 'B']]);
  const trace = inspector.getTrace();
  const inners = trace.events.filter(event => event.role === 'inner' && event.kind === 'subscribe');
  assert.equal(inners.length, 2);
  assert.equal(inners[0]?.time, 0);
  assert.equal(inners[1]?.time, 40);
  const first = trace.events.filter(event => event.executionId === inners[0]?.executionId);
  const second = trace.events.filter(event => event.executionId === inners[1]?.executionId);
  assert.deepEqual(first.map(event => [event.kind, event.time]), [['subscribe', 0], ['unsubscribe', 40]]);
  assert.deepEqual(second.map(event => [event.kind, event.time]), [['subscribe', 40], ['next', 70], ['complete', 90]]);
  const replacement = trace.events.find(event => event.nodeId === 'latest' && event.port === 'input' && event.kind === 'next' && event.value?.data === 'B');
  assert.equal(first[1]?.causeEventSeq, replacement?.seq);
  const operatorEvents = trace.events.filter(event => event.role === 'operator');
  assert.equal(operatorEvents.find(event => event.kind === 'complete' && event.port === 'input')?.time, 50);
  assert.equal(operatorEvents.find(event => event.kind === 'complete' && event.port === 'output')?.time, 90);
});

test('synchronous inner completion is preserved for every outer value', () => {
  const inspector = makeInspector();
  function double$(value: number) { return of(value * 2); }
  const values: number[] = [];
  let completed = false;
  of(1, 2, 3).pipe(inspector.switchMap('latest', double$)).subscribe({
    next(value) { values.push(value); },
    complete() { completed = true; },
  });
  assert.deepEqual(values, [2, 4, 6]);
  assert.equal(completed, true);
  const innerEvents = inspector.getTrace().events.filter(event => event.role === 'inner');
  assert.equal(innerEvents.filter(event => event.kind === 'complete').length, 3);
  assert.equal(innerEvents.filter(event => event.kind === 'unsubscribe').length, 0);
});

test('switchMap accepts synchronous ObservableInput values without changing their sequence', () => {
  const inspector = makeInspector();
  function expand(value: number) { return [value, value + 10]; }
  const values: number[] = [];
  of(1, 2).pipe(inspector.switchMap('latest', expand)).subscribe(value => values.push(value));
  assert.deepEqual(values, [1, 11, 2, 12]);
});

test('a throwing projector preserves the original error and creates no inner subscription', () => {
  const inspector = makeInspector();
  const failure = new Error('invalid domain input');
  function failToLoad(_value: number): Observable<never> { throw failure; }
  let received: unknown;
  of(1, 2).pipe(inspector.switchMap('latest', failToLoad)).subscribe({ error(error) { received = error; } });
  assert.equal(received, failure);
  const trace = inspector.getTrace();
  assert.equal(trace.events.filter(event => event.role === 'inner' && event.kind === 'subscribe').length, 0);
  assert.equal(trace.events.filter(event => event.role === 'operator' && event.port === 'output' && event.kind === 'error').length, 1);
});

test('inner error disposes the outer execution and preserves the error identity', () => {
  const inspector = makeInspector();
  const queries$ = new Subject<number>();
  const failure = new Error('request failed');
  function failingResult$(_query: number): Observable<string> {
    return new Observable(subscriber => subscriber.error(failure));
  }
  let received: unknown;
  queries$.pipe(inspector.inspect<number>('source'), inspector.switchMap('latest', failingResult$))
    .subscribe({ error(error) { received = error; } });
  queries$.next(1);
  queries$.next(2);
  assert.equal(received, failure);
  const trace = inspector.getTrace();
  assert.deepEqual(outputValues(trace, 'source'), [1]);
  assert.equal(nodeEvents(trace, 'source').at(-1)?.kind, 'unsubscribe');
  assert.equal(trace.events.filter(event => event.role === 'inner' && event.kind === 'error').length, 1);
});

test('disposing switchMap disposes the current inner and outer exactly once', () => {
  const inspector = makeInspector();
  let outerTeardowns = 0;
  let innerTeardowns = 0;
  const source$ = new Observable<number>(subscriber => {
    subscriber.next(1);
    return () => { outerTeardowns += 1; };
  });
  function pendingResult$(_value: number) {
    return new Observable<string>(() => () => { innerTeardowns += 1; });
  }
  const subscription = source$.pipe(
    inspector.inspect<number>('source'),
    inspector.switchMap('latest', pendingResult$),
  ).subscribe();
  subscription.unsubscribe();
  subscription.unsubscribe();
  assert.equal(outerTeardowns, 1);
  assert.equal(innerTeardowns, 1);
  assert.equal(inspector.getTrace().events.filter(event => event.role === 'inner' && event.kind === 'unsubscribe').length, 1);
});

function reentrantProjectorRun(instrument: boolean) {
  const inspector = makeInspector();
  const outer$ = new Subject<number>();
  const innerSubscribers = new Map<number, Subscriber<string>>();
  const steps: string[] = [];
  function project(value: number) {
    steps.push(`project:${value}`);
    if (value === 1) outer$.next(2);
    return new Observable<string>(subscriber => {
      steps.push(`subscribe:${value}`);
      innerSubscribers.set(value, subscriber);
      return () => { steps.push(`teardown:${value}`); };
    });
  }
  const operator = instrument ? inspector.switchMap('latest', project) : switchMap(project);
  outer$.pipe(operator).subscribe({
    next(value) { steps.push(`next:${value}`); },
    complete() { steps.push('complete'); },
  });
  outer$.next(1);
  innerSubscribers.get(1)!.next('A');
  innerSubscribers.get(2)!.next('B');
  outer$.complete();
  innerSubscribers.get(1)!.complete();
  innerSubscribers.get(2)!.complete();
  return { steps, trace: inspector.getTrace() };
}

test('reentrant projectors preserve actual RxJS behavior including overlapping inner executions', () => {
  const baseline = reentrantProjectorRun(false);
  const observed = reentrantProjectorRun(true);
  assert.deepEqual(observed.steps, baseline.steps);
  assert.deepEqual(observed.steps.filter(step => step.startsWith('next:')), ['next:A', 'next:B']);
  const inputEvents = observed.trace.events.filter(event => event.port === 'input' && event.kind === 'next');
  const innerStarts = observed.trace.events.filter(event => event.role === 'inner' && event.kind === 'subscribe');
  assert.equal(innerStarts[0]?.causeEventSeq, inputEvents[1]?.seq);
  assert.equal(innerStarts[1]?.causeEventSeq, inputEvents[0]?.seq);
  assert.deepEqual(parseTrace(serializeTrace(observed.trace)), observed.trace);
});

test('reentrant downstream delivery preserves notification ordering', () => {
  const inspector = makeInspector();
  const source$ = new Subject<number>();
  const values: number[] = [];
  function identity$(value: number) { return of(value); }
  source$.pipe(inspector.switchMap('latest', identity$)).subscribe(value => {
    values.push(value);
    if (value === 1) source$.next(2);
  });
  source$.next(1);
  source$.complete();
  assert.deepEqual(values, [1, 2]);
  const outputs = inspector.getTrace().events.filter(event => event.role === 'operator' && event.port === 'output' && event.kind === 'next');
  assert.deepEqual(outputs.map(event => event.value?.data), [1, 2]);
});

test('two consumers of an explicitly shared source produce one upstream execution', () => {
  const inspector = makeInspector();
  let starts = 0;
  let stops = 0;
  let producer: Subscriber<number> | undefined;
  const source$ = new Observable<number>(subscriber => {
    starts += 1;
    producer = subscriber;
    return () => { stops += 1; };
  });
  const shared$ = source$.pipe(inspector.inspect<number>('source'), share());
  const leftValues: number[] = [];
  const rightValues: number[] = [];
  const left = shared$.pipe(inspector.inspect<number>('left')).subscribe(value => leftValues.push(value));
  const right = shared$.pipe(inspector.inspect<number>('right')).subscribe(value => rightValues.push(value));
  producer!.next(1);
  left.unsubscribe();
  producer!.next(2);
  assert.equal(stops, 0);
  right.unsubscribe();

  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.deepEqual(leftValues, [1]);
  assert.deepEqual(rightValues, [1, 2]);
  const trace = inspector.getTrace();
  assert.equal(nodeEvents(trace, 'source').filter(event => event.kind === 'subscribe').length, 1);
  assert.equal(nodeEvents(trace, 'left').filter(event => event.kind === 'subscribe').length, 1);
  assert.equal(nodeEvents(trace, 'right').filter(event => event.kind === 'subscribe').length, 1);
});

test('snapshot data is detached from later application mutations', () => {
  const inspector = makeInspector();
  const value = { name: 'before', nested: { count: 1 }, list: [1, 2] };
  of(value).pipe(inspector.inspect('source')).subscribe();
  value.name = 'after';
  value.nested.count = 9;
  value.list.push(3);
  assert.deepEqual(outputValues(inspector.getTrace(), 'source'), [
    { name: 'before', nested: { count: 1 }, list: [1, 2] },
  ]);
});

test('a serializer failure is captured without failing or mutating application delivery', () => {
  const inspector = makeInspector({ captureValue() { throw new Error('cannot serialize'); } });
  const value = { original: true };
  let received: unknown;
  let completed = false;
  of(value).pipe(inspector.inspect('source')).subscribe({
    next(next) { received = next; },
    complete() { completed = true; },
  });
  assert.equal(received, value);
  assert.equal(completed, true);
  const captured = inspector.getTrace().events.find(event => event.kind === 'next')?.value;
  assert.equal(captured?.status, 'unavailable');
  assert.doesNotThrow(() => JSON.stringify(inspector.getTrace()));
});

test('default capture does not invoke application getters or toJSON methods', () => {
  const inspector = makeInspector();
  let getterCalls = 0;
  let toJsonCalls = 0;
  const value = {
    safe: 'visible',
    get unsafe() { getterCalls += 1; throw new Error('getter must not run'); },
    toJSON() { toJsonCalls += 1; throw new Error('toJSON must not run'); },
  };
  let delivered: unknown;
  of(value).pipe(inspector.inspect('source')).subscribe(next => { delivered = next; });
  assert.equal(delivered, value);
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
  const snapshot = inspector.getTrace().events.find(event => event.kind === 'next')?.value;
  assert.equal(snapshot?.status, 'truncated');
  assert.doesNotThrow(() => JSON.stringify(inspector.getTrace()));
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
});

test('opaque prototypes and omitted symbol keys are labelled as truncated previews', () => {
  const inspector = makeInspector();
  const hidden = Symbol('domain metadata');
  const values = [
    /search/i,
    new URL('https://example.com/search?q=rxjs'),
    Promise.resolve('result'),
    { visible: 'kept', [hidden]: 'not representable as a JSON object key' },
  ];
  const delivered: unknown[] = [];
  of(...values).pipe(inspector.inspect('source')).subscribe(value => delivered.push(value));
  assert.equal(delivered.length, values.length);
  for (let index = 0; index < values.length; index += 1) assert.equal(delivered[index], values[index]);
  const snapshots = inspector.getTrace().events.filter(event => event.kind === 'next').map(event => event.value);
  assert.equal(snapshots.length, values.length);
  assert.deepEqual(snapshots.map(snapshot => snapshot?.status), ['truncated', 'truncated', 'truncated', 'truncated']);
  assert.doesNotThrow(() => JSON.stringify(inspector.getTrace()));
});

test('a failing, nonfinite, or backward custom clock does not fail application delivery', () => {
  let calls = 0;
  function now() {
    calls += 1;
    if (calls === 1) return 100;
    if (calls === 2) throw new Error('clock failed');
    if (calls === 3) return Number.NaN;
    return 99;
  }
  const inspector = makeInspector({ clock: { name: 'broken clock', kind: 'custom', now } });
  const values: number[] = [];
  of(1).pipe(inspector.inspect<number>('source')).subscribe(value => values.push(value));
  const trace = inspector.getTrace();
  assert.deepEqual(values, [1]);
  assert.equal(trace.capture.clockErrors, 3);
  assert.deepEqual(trace.events.map(event => event.time), [0, 0, 0]);
  assert.equal(trace.events.at(-1)?.kind, 'complete');
});

test('relative custom clock arithmetic cannot put infinity into a trace', () => {
  let calls = 0;
  const inspector = makeInspector({
    clock: { name: 'large finite numbers', kind: 'custom', now: () => ++calls === 1 ? -Number.MAX_VALUE : Number.MAX_VALUE },
  });
  const values: number[] = [];
  of(1).pipe(inspector.inspect<number>('source')).subscribe(value => values.push(value));
  assert.deepEqual(values, [1]);
  assert.ok(inspector.getTrace().events.every(event => Number.isFinite(event.time)));
  assert.ok((inspector.getTrace().capture.clockErrors ?? 0) > 0);
});

test('cyclic and unsupported payloads remain serializable and do not affect delivery', () => {
  const inspector = makeInspector();
  const value: { self?: unknown; big: bigint; fn: () => string } = { big: 1n, fn: () => 'hello' };
  value.self = value;
  const values: unknown[] = [];
  of(value, undefined, Number.NaN).pipe(inspector.inspect('source')).subscribe(next => values.push(next));
  assert.equal(values[0], value);
  assert.equal(values[1], undefined);
  assert.ok(Number.isNaN(values[2]));
  assert.doesNotThrow(() => JSON.stringify(inspector.getTrace()));
});

test('bounded retention exposes the missing prefix and retains global event ordinals', () => {
  const inspector = makeInspector({ maxEvents: 3, clock: { name: 'same-time', kind: 'virtual', now: () => 0 } });
  of(1, 2, 3).pipe(inspector.inspect<number>('source')).subscribe();
  const trace = inspector.getTrace();
  assert.deepEqual(trace.capture, { maxEvents: 3, droppedEvents: 2, totalEvents: 5, complete: false });
  assert.deepEqual(trace.events.map(event => event.seq), [3, 4, 5]);
  assert.deepEqual(trace.events.map(event => event.time), [0, 0, 0]);
});

test('a returned trace is a stable snapshot while live recording continues', () => {
  const inspector = makeInspector();
  const source$ = new Subject<number>();
  const subscription: Subscription = source$.pipe(inspector.inspect<number>('source')).subscribe();
  source$.next(1);
  const before = inspector.getTrace();
  const beforeJson = JSON.stringify(before);
  source$.next(2);
  subscription.unsubscribe();
  assert.equal(JSON.stringify(before), beforeJson);
  assert.deepEqual(outputValues(before, 'source'), [1]);
  assert.deepEqual(outputValues(inspector.getTrace(), 'source'), [1, 2]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Observable, Subject, Subscriber, VirtualTimeScheduler, map, of,
  share, subscribeOn, switchMap, take,
  type MonoTypeOperatorFunction, type OperatorFunction, type Subscription,
} from 'rxjs';
import { createInspector } from '../src/recorder.js';
import { getSwitchMapState } from '../src/analysis.js';
import { parseTrace, serializeTrace } from '../src/trace.js';
import type { SubscriptionLink, Trace, TraceEvent, TraceNode } from '../src/types.js';

const definitions: readonly TraceNode[] = [
  { id: 'source', label: 'source$', kind: 'source' },
  { id: 'other', label: 'independent source$', kind: 'source' },
  { id: 'double', label: 'Double each package', kind: 'operator', operator: 'map', domain: 'doubleValue' },
  { id: 'latest', label: 'Latest result', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' },
  { id: 'shared', label: 'Shared connection', kind: 'operator', operator: 'share' },
  { id: 'left', label: 'Consumer A', kind: 'sink' },
  { id: 'right', label: 'Consumer B', kind: 'sink' },
];

function starts(trace: Trace, nodeId: string, role?: TraceEvent['role']) {
  return trace.events.filter(event => event.kind === 'subscribe' && event.nodeId === nodeId && (role === undefined || event.role === role));
}

function links(trace: Trace, kind?: SubscriptionLink['kind']) {
  return trace.events.filter(event => event.kind === 'link' && (kind === undefined || event.link?.kind === kind));
}

function terminal(trace: Trace, executionId: string) {
  return trace.events.find(event => event.executionId === executionId && event.port === 'output' && ['complete', 'error', 'unsubscribe'].includes(event.kind));
}

function assertRoundTrip(trace: Trace): void {
  const json = serializeTrace(trace);
  // Import intentionally uses null-prototype payload objects; compare the portable JSON contract.
  assert.equal(serializeTrace(parseTrace(json)), json);
}

function openSource() {
  let subscriber: Subscriber<number> | undefined;
  let started = 0;
  let stopped = 0;
  const source = new Observable<number>(destination => {
    started++;
    subscriber = destination;
    return () => { stopped++; };
  });
  return { source, current: () => subscriber!, started: () => started, stopped: () => stopped };
}

test('operator labels survive repeated subscriptions and the real operator is applied once', () => {
  const mutableNodes = definitions.map(node => ({ ...node }));
  const inspector = createInspector({ nodes: mutableNodes });
  let applications = 0;
  let subscriptions = 0;
  const countedMap: OperatorFunction<number, number> = source => {
    applications++;
    return source.pipe(map(value => value * 2));
  };
  const source = new Observable<number>(subscriber => {
    subscriptions++;
    subscriber.next(2);
    subscriber.complete();
  });
  const result = source.pipe(inspector.inspect('source'), inspector.operator('double', countedMap));
  assert.equal(applications, 1);
  assert.equal(subscriptions, 0);
  assert.equal(inspector.getTrace().events.length, 0);
  mutableNodes.find(node => node.id === 'double')!.label = 'Changed outside the inspector';
  const values: number[] = [];
  result.subscribe(value => values.push(value));
  result.subscribe(value => values.push(value));
  assert.equal(applications, 1);
  assert.equal(subscriptions, 2);
  assert.deepEqual(values, [4, 4]);
  const trace = inspector.getTrace();
  assert.equal(trace.schemaVersion, 2);
  assert.equal(trace.nodes.find(node => node.id === 'double')?.label, 'Double each package');
  assert.equal(starts(trace, 'double', 'boundary').length, 2);
  assert.notEqual(starts(trace, 'double')[0]?.executionId, starts(trace, 'double')[1]?.executionId);
  assert.deepEqual(parseTrace(serializeTrace(trace)), trace);
});

test('accepted stable definitions omit structural extras and undefined optionals in portable traces', () => {
  const source = { id: 'source', label: 'source$', kind: 'source' as const, operator: undefined, domain: undefined, color: 'blue' };
  const operator = { id: 'double', label: 'Double', kind: 'operator' as const, operator: 'map', domain: 'doubleValue', view: { expanded: true } };
  const edge = { from: 'source', to: 'double', presentation: 'dashed' };
  // Explicit undefined is a common JavaScript/loosely typed configuration shape.
  const inspector = createInspector({ nodes: [source as TraceNode, operator], edges: [edge] });
  of(2).pipe(inspector.inspect('source'), inspector.operator('double', map(value => value * 2))).subscribe();
  const trace = inspector.getTrace();
  assert.deepEqual(trace.nodes, [
    { id: 'source', label: 'source$', kind: 'source' },
    { id: 'double', label: 'Double', kind: 'operator', operator: 'map', domain: 'doubleValue' },
  ]);
  assert.deepEqual(trace.edges, [{ from: 'source', to: 'double' }]);
  assert.ok(Object.isFrozen(trace.nodes[1]));
  assertRoundTrip(trace);
});

test('invalid optional definition labels fail before recording starts', () => {
  for (const field of ['operator', 'domain'] as const) {
    for (const value of [null, 42, {}, []]) {
      const node = { id: 'invalid', label: 'Invalid label', kind: 'operator', [field]: value };
      assert.throws(() => createInspector({ nodes: [node as unknown as TraceNode] }), new RegExp(`node ${field} label must be a string`));
    }
  }
});

test('generic operator wrapping preserves a real share operator applied at construction', () => {
  const inspector = createInspector({ nodes: definitions });
  const producer = openSource();
  const shared = producer.source.pipe(inspector.operator('shared', share<number>()));
  const first = shared.subscribe();
  const second = shared.subscribe();
  assert.equal(producer.started(), 1);
  first.unsubscribe();
  assert.equal(producer.stopped(), 0);
  second.unsubscribe();
  assert.equal(producer.stopped(), 1);
  assert.equal(links(inspector.getTrace(), 'shared').length, 0, 'generic wrappers do not invent internal share evidence');
});

test('independent cold chains receive distinct subscription edges before any value', () => {
  const inspector = createInspector({ nodes: definitions });
  const producer = openSource();
  const stage = producer.source.pipe(inspector.inspect('source'), inspector.operator('double', map(value => value * 2)));
  const first = stage.pipe(inspector.inspect('left')).subscribe();
  const second = stage.pipe(inspector.inspect('right')).subscribe();
  const trace = inspector.getTrace();
  assert.equal(producer.started(), 2);
  assert.equal(trace.events.filter(event => event.kind === 'next').length, 0);
  const sourceStarts = starts(trace, 'source');
  const mapStarts = starts(trace, 'double');
  const expected = [
    [sourceStarts[0]!.executionId, mapStarts[0]!.executionId],
    [sourceStarts[1]!.executionId, mapStarts[1]!.executionId],
    [mapStarts[0]!.executionId, starts(trace, 'left')[0]!.executionId],
    [mapStarts[1]!.executionId, starts(trace, 'right')[0]!.executionId],
  ];
  assert.deepEqual(links(trace).map(event => [event.link!.sourceExecutionId, event.link!.destinationExecutionId]).sort(), expected.sort());
  first.unsubscribe();
  second.unsubscribe();
});

test('independent reentrant subscriptions are not mistaken for upstream connections', () => {
  const inspector = createInspector({ nodes: definitions });
  const source = new Observable<number>(subscriber => {
    of(9).pipe(inspector.inspect('other')).subscribe();
    subscriber.next(9);
    subscriber.complete();
  });
  source.pipe(inspector.inspect('source'), inspector.inspect('left')).subscribe();
  const trace = inspector.getTrace();
  const otherId = starts(trace, 'other')[0]!.executionId;
  assert.equal(links(trace).length, 1);
  assert.ok(links(trace).every(event => event.link!.sourceExecutionId !== otherId && event.link!.destinationExecutionId !== otherId));
  assert.deepEqual(parseTrace(serializeTrace(trace)), trace);
});

test('subscription links survive a real subscribeOn scheduling boundary', () => {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({ nodes: definitions, clock: { name: 'subscribeOn fixture', kind: 'virtual', now: () => scheduler.now() } });
  const values: number[] = [];
  of(2).pipe(
    inspector.inspect('source'),
    subscribeOn(scheduler, 5),
    inspector.operator('double', map(value => value * 2)),
    inspector.inspect('left'),
  ).subscribe(value => values.push(value));
  assert.equal(starts(inspector.getTrace(), 'source').length, 0);
  scheduler.flush();
  const trace = inspector.getTrace();
  const sourceId = starts(trace, 'source')[0]!.executionId;
  const edge = links(trace).find(event => event.link!.sourceExecutionId === sourceId)!;
  assert.equal(edge.time, 5);
  assert.equal(edge.link!.destinationExecutionId, starts(trace, 'double')[0]!.executionId);
  assert.deepEqual(values, [4]);
});

test('destination discovery never invokes a destination getter', () => {
  const inspector = createInspector({ nodes: definitions });
  const sink = new Subscriber<number>({ next() {}, error() {}, complete() {} });
  let reads = 0;
  Object.defineProperty(sink, 'destination', {
    configurable: true,
    get() { reads++; throw new Error('unsupported getter'); },
    set() { /* Subscriber cleanup may clear its destination. */ },
  });
  new Observable<number>(() => undefined).pipe(inspector.inspect('source')).subscribe(sink);
  sink.unsubscribe();
  assert.equal(reads, 0);
  assert.equal(links(inspector.getTrace()).length, 0);
});

test('generic switchMap observation does not claim the specialized inner model', () => {
  const inspector = createInspector({ nodes: definitions });
  const values: number[] = [];
  of(2).pipe(inspector.operator('latest', switchMap(value => of(value * 2)))).subscribe(value => values.push(value));
  const trace = inspector.getTrace();
  const execution = starts(trace, 'latest')[0]!;
  assert.equal(execution.role, 'boundary');
  assert.equal(getSwitchMapState(trace, execution.executionId).provenance, 'unavailable');
  assert.equal(trace.events.filter(event => event.role === 'inner').length, 0);
  assert.deepEqual(values, [4]);
});

test('specialized switchMap records explicit inner relationships', () => {
  const inspector = createInspector({ nodes: definitions });
  of(1, 2).pipe(inspector.switchMap('latest', value => of(value))).subscribe();
  const trace = inspector.getTrace();
  const operator = starts(trace, 'latest', 'operator')[0]!;
  const inners = starts(trace, 'latest', 'inner');
  assert.equal(links(trace, 'inner').length, 2);
  assert.deepEqual(links(trace, 'inner').map(event => event.link), inners.map(inner => ({
    kind: 'inner', sourceExecutionId: inner.executionId, destinationExecutionId: operator.executionId,
  })));
  assert.deepEqual(parseTrace(serializeTrace(trace)), trace);
});

test('share records fan-out before notifications and preserves first-leaves/last-closes/reconnect', () => {
  const inspector = createInspector({ nodes: definitions });
  const producer = openSource();
  const shared = producer.source.pipe(inspector.inspect('source'), inspector.share<number>('shared'));
  const firstValues: number[] = [];
  const secondValues: number[] = [];
  const first = shared.pipe(inspector.inspect('left')).subscribe(value => firstValues.push(value));
  const second = shared.pipe(inspector.inspect('right')).subscribe(value => secondValues.push(value));
  const beforeValues = inspector.getTrace();
  const connection = starts(beforeValues, 'shared', 'connection')[0]!;
  const consumers = starts(beforeValues, 'shared', 'boundary');
  assert.equal(producer.started(), 1);
  assert.equal(consumers.length, 2);
  assert.equal(connection.parentExecutionId, undefined);
  assert.equal(beforeValues.events.filter(event => event.kind === 'next').length, 0);
  assert.deepEqual(links(beforeValues, 'shared').map(event => event.link), consumers.map(consumer => ({
    kind: 'shared', sourceExecutionId: connection.executionId, destinationExecutionId: consumer.executionId,
  })));
  producer.current().next(1);
  first.unsubscribe();
  assert.equal(producer.stopped(), 0);
  assert.equal(terminal(inspector.getTrace(), connection.executionId), undefined);
  producer.current().next(2);
  assert.deepEqual(firstValues, [1]);
  assert.deepEqual(secondValues, [1, 2]);
  second.unsubscribe();
  assert.equal(producer.stopped(), 1);
  assert.equal(terminal(inspector.getTrace(), connection.executionId)?.kind, 'unsubscribe');
  const third = shared.subscribe();
  const trace = inspector.getTrace();
  const connections = starts(trace, 'shared', 'connection');
  assert.equal(producer.started(), 2);
  assert.equal(connections.length, 2);
  assert.notEqual(connections[0]?.executionId, connections[1]?.executionId);
  assert.equal(links(trace, 'shared').at(-1)?.link?.sourceExecutionId, connections[1]?.executionId);
  third.unsubscribe();
  assert.deepEqual(parseTrace(serializeTrace(inspector.getTrace())), inspector.getTrace());
});

test('share with resetOnRefCountZero false retains one connection across a consumer gap', () => {
  const inspector = createInspector({ nodes: definitions });
  const producer = openSource();
  const shared = producer.source.pipe(inspector.share<number>('shared', { resetOnRefCountZero: false }));
  const first = shared.subscribe();
  first.unsubscribe();
  assert.equal(producer.stopped(), 0);
  const values: number[] = [];
  const second = shared.subscribe(value => values.push(value));
  producer.current().next(3);
  const trace = inspector.getTrace();
  assert.equal(producer.started(), 1);
  assert.equal(starts(trace, 'shared', 'connection').length, 1);
  assert.equal(links(trace, 'shared').length, 2);
  assert.equal(new Set(links(trace, 'shared').map(event => event.link?.sourceExecutionId)).size, 1);
  assert.deepEqual(values, [3]);
  second.unsubscribe();
  producer.current().complete();
  assert.equal(producer.stopped(), 1);
  assert.deepEqual(parseTrace(serializeTrace(inspector.getTrace())), inspector.getTrace());
});

test('terminal retained Subjects do not create active links from an ended connection', () => {
  for (const ending of ['complete', 'error'] as const) {
    const inspector = createInspector({ nodes: definitions });
    const failure = new Error('same retained error');
    let subscriptions = 0;
    const source = new Observable<number>(subscriber => {
      subscriptions++;
      if (ending === 'error') subscriber.error(failure);
      else subscriber.complete();
    });
    const shared = source.pipe(inspector.share<number>('shared', { resetOnError: false, resetOnComplete: false }));
    const errors: unknown[] = [];
    shared.subscribe({ error: error => errors.push(error) });
    shared.subscribe({ error: error => errors.push(error) });
    const trace = inspector.getTrace();
    assert.equal(subscriptions, 1);
    assert.equal(starts(trace, 'shared', 'connection').length, 1);
    assert.equal(starts(trace, 'shared', 'boundary').length, 2);
    assert.equal(links(trace, 'shared').length, 1);
    if (ending === 'error') assert.deepEqual(errors, [failure, failure]);
    assertRoundTrip(trace);
  }
});

test('synchronous observed share followed by take(1) stops production and teardown exactly once', () => {
  const inspector = createInspector({ nodes: definitions });
  let produced = 0;
  let disposed = 0;
  const source = new Observable<number>(subscriber => {
    for (let value = 1; value <= 5 && !subscriber.closed; value++) {
      produced++;
      subscriber.next(value);
    }
    if (!subscriber.closed) subscriber.complete();
    return () => { disposed++; };
  });
  const values: number[] = [];
  source.pipe(inspector.inspect('source'), inspector.share<number>('shared'), take(1)).subscribe(value => values.push(value));
  assert.equal(produced, 1);
  assert.equal(disposed, 1);
  assert.deepEqual(values, [1]);
  assert.deepEqual(parseTrace(serializeTrace(inspector.getTrace())), inspector.getTrace());
});

function reentrantShareRun(instrumented: boolean, ending: 'complete' | 'error') {
  const inspector = createInspector({ nodes: definitions });
  const steps: string[] = [];
  let count = 0;
  let reentered = false;
  const source = new Observable<number>(subscriber => {
    const index = ++count;
    steps.push(`source:${index}`);
    subscriber.next(index);
    if (ending === 'error') subscriber.error(new Error('fixture'));
    else subscriber.complete();
    return () => { steps.push(`teardown:${index}`); };
  });
  const operator: MonoTypeOperatorFunction<number> = instrumented ? inspector.share<number>('shared') : share<number>();
  const shared = source.pipe(operator);
  function finish(label: string) {
    steps.push(`${ending}:${label}`);
    if (!reentered) {
      reentered = true;
      shared.subscribe({ next: value => steps.push(`next:B:${value}`), error: () => finish('B'), complete: () => finish('B') });
    }
  }
  shared.subscribe({ next: value => steps.push(`next:A:${value}`), error: () => finish('A'), complete: () => finish('A') });
  return { steps, trace: inspector.getTrace() };
}

test('share terminal resets preserve actual RxJS reentrant subscription and teardown order', () => {
  for (const ending of ['complete', 'error'] as const) {
    const baseline = reentrantShareRun(false, ending);
    const recorded = reentrantShareRun(true, ending);
    assert.deepEqual(recorded.steps, baseline.steps);
    assert.equal(starts(recorded.trace, 'shared', 'connection').length, 2);
    const connections = starts(recorded.trace, 'shared', 'connection');
    const consumers = starts(recorded.trace, 'shared', 'boundary');
    assert.deepEqual(links(recorded.trace, 'shared').map(event => event.link), connections.map((connection, index) => ({
      kind: 'shared', sourceExecutionId: connection.executionId, destinationExecutionId: consumers[index]!.executionId,
    })));
    assertRoundTrip(recorded.trace);
  }
});

test('a consumer joining during share delivery keeps actual Subject fan-out behavior', () => {
  const inspector = createInspector({ nodes: definitions });
  const input = new Subject<number>();
  const shared = input.pipe(inspector.share<number>('shared'));
  const firstValues: number[] = [];
  const secondValues: number[] = [];
  let second: Subscription | undefined;
  const first = shared.subscribe(value => {
    firstValues.push(value);
    second ??= shared.subscribe(next => secondValues.push(next));
  });
  input.next(1);
  input.next(2);
  assert.deepEqual(firstValues, [1, 2]);
  assert.deepEqual(secondValues, [2]);
  assert.equal(starts(inspector.getTrace(), 'shared', 'connection').length, 1);
  assert.equal(links(inspector.getTrace(), 'shared').length, 2);
  first.unsubscribe();
  second!.unsubscribe();
  assert.deepEqual(parseTrace(serializeTrace(inspector.getTrace())), inspector.getTrace());
});

test('operator and share APIs require explicit compatible stable metadata and supported reset options', () => {
  const inspector = createInspector({ nodes: [...definitions, { id: 'missing', label: 'Missing operator metadata', kind: 'operator' }] });
  assert.throws(() => inspector.operator('source', map(value => value)), /kind "operator"/);
  assert.throws(() => inspector.operator('missing', map(value => value)), /nonempty operator label/);
  assert.throws(() => inspector.share('double'), /operator "share"/);
  assert.throws(() => inspector.share('shared', { connector: () => new Subject() } as never), /Unsupported inspected share option/);
  assert.throws(() => inspector.share('shared', { resetOnError: () => of(1) } as never), /must be boolean/);
});

import { Observable, VirtualTimeScheduler, filter, interval, map, of, scan } from 'rxjs';
import { createInspector } from '../src/index.js';
import { mountInspector } from '../src/viewer.js';
import type { Trace } from '../src/types.js';

export type Scenario = 'labels' | 'switchMap' | 'independent' | 'shared' | 'error' | 'unsubscribe';

function recordLabelledOperators(): Trace {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({
    name: 'Stable labels · two cold runs',
    clock: { name: 'Synchronous fixture', kind: 'virtual', now: () => scheduler.now() },
    nodes: [
      { id: 'values', label: 'numbers$', kind: 'source' },
      { id: 'double', label: 'Double each value', kind: 'operator', operator: 'map', domain: 'doubleValue' },
      { id: 'accept', label: 'Accept values above two', kind: 'operator', operator: 'filter', domain: 'aboveTwo' },
      { id: 'total', label: 'Running total', kind: 'operator', operator: 'scan', domain: 'addValue' },
      { id: 'results', label: 'totals$', kind: 'sink' },
    ],
    edges: [
      { from: 'values', to: 'double' }, { from: 'double', to: 'accept' },
      { from: 'accept', to: 'total' }, { from: 'total', to: 'results' },
    ],
  });
  const doubleValue = (value: number): number => value * 2;
  const aboveTwo = (value: number): boolean => value > 2;
  const addValue = (total: number, value: number): number => total + value;
  const totals$ = of(1, 2, 3).pipe(
    inspector.inspect<number>('values'),
    inspector.operator('double', map(doubleValue)),
    inspector.operator('accept', filter(aboveTwo)),
    inspector.operator('total', scan(addValue, 0)),
    inspector.inspect<number>('results'),
  );
  // Two actual subscriptions: labels remain stable and execution IDs differ.
  totals$.subscribe();
  totals$.subscribe();
  return inspector.getTrace();
}

function recordSearch(): Trace {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({
    name: 'Latest search wins',
    clock: { name: 'Search fixture', kind: 'virtual', now: () => scheduler.now() },
    nodes: [
      { id: 'queries', label: 'queries$', kind: 'source' },
      { id: 'latest', label: 'switchMap', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' },
      { id: 'results', label: 'results$', kind: 'sink' },
    ],
    edges: [{ from: 'queries', to: 'latest' }, { from: 'latest', to: 'results' }],
  });
  const queries$ = new Observable<string>(subscriber => {
    const first = scheduler.schedule(() => subscriber.next('A'), 0);
    const second = scheduler.schedule(() => subscriber.next('B'), 40);
    const complete = scheduler.schedule(() => subscriber.complete(), 50);
    return () => { first.unsubscribe(); second.unsubscribe(); complete.unsubscribe(); };
  });
  function loadResult$(query: string): Observable<{ query: string; result: string }> {
    return new Observable(subscriber => {
      const emit = scheduler.schedule(() => subscriber.next({ query, result: `Result for ${query}` }), query === 'A' ? 80 : 30);
      const complete = scheduler.schedule(() => subscriber.complete(), query === 'A' ? 100 : 50);
      return () => { emit.unsubscribe(); complete.unsubscribe(); };
    });
  }
  queries$.pipe(
    inspector.inspect<string>('queries'),
    inspector.switchMap('latest', loadResult$),
    inspector.inspect('results'),
  ).subscribe();
  scheduler.flush();
  return inspector.getTrace();
}

function recordConsumers(shared: boolean): Trace {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({
    name: shared ? 'Two consumers · explicitly shared source' : 'Two consumers · independent cold executions',
    clock: { name: 'Consumer fixture', kind: 'virtual', now: () => scheduler.now() },
    nodes: [
      { id: 'producer', label: 'producer$', kind: 'source' },
      ...(shared ? [{ id: 'shared', label: 'Shared packages', kind: 'operator' as const, operator: 'share' }] : []),
      { id: 'consumer-a', label: 'consumer A', kind: 'sink' },
      { id: 'consumer-b', label: 'consumer B', kind: 'sink' },
    ],
    edges: shared
      ? [{ from: 'producer', to: 'shared' }, { from: 'shared', to: 'consumer-a' }, { from: 'shared', to: 'consumer-b' }]
      : [{ from: 'producer', to: 'consumer-a' }, { from: 'producer', to: 'consumer-b' }],
  });
  const producer$ = new Observable<string>(subscriber => {
    const firstValue = scheduler.schedule(() => subscriber.next('first package'), 10);
    const secondValue = scheduler.schedule(() => subscriber.next('second package'), 25);
    const complete = scheduler.schedule(() => subscriber.complete(), 50);
    return () => { firstValue.unsubscribe(); secondValue.unsubscribe(); complete.unsubscribe(); };
  }).pipe(inspector.inspect<string>('producer'));
  const source$ = shared
    ? producer$.pipe(inspector.share<string>('shared', { resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true }))
    : producer$;
  const firstConsumer = source$.pipe(inspector.inspect('consumer-a')).subscribe();
  scheduler.schedule(() => {
    const secondConsumer = source$.pipe(inspector.inspect('consumer-b')).subscribe();
    scheduler.schedule(() => secondConsumer.unsubscribe(), 30);
  }, 5);
  scheduler.schedule(() => firstConsumer.unsubscribe(), 15);
  scheduler.flush();
  return inspector.getTrace();
}

function recordError(): Trace {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({
    name: 'An inner source fails',
    clock: { name: 'Error fixture', kind: 'virtual', now: () => scheduler.now() },
    nodes: [
      { id: 'requests', label: 'requests$', kind: 'source' },
      { id: 'latest', label: 'switchMap', kind: 'operator', operator: 'switchMap', domain: 'loadUnavailableResult$' },
      { id: 'results', label: 'results$', kind: 'sink' },
    ],
    edges: [{ from: 'requests', to: 'latest' }, { from: 'latest', to: 'results' }],
  });
  const requests$ = new Observable<string>(subscriber => {
    const request = scheduler.schedule(() => subscriber.next('A'), 0);
    const completion = scheduler.schedule(() => subscriber.complete(), 50);
    return () => { request.unsubscribe(); completion.unsubscribe(); };
  });
  function loadUnavailableResult$(_query: string): Observable<never> {
    return new Observable(subscriber => scheduler.schedule(() => subscriber.error(new Error('Result unavailable in this fixture')), 20));
  }
  function handleExpectedError(): void { /* The fixture intentionally records this error. */ }
  requests$.pipe(
    inspector.inspect<string>('requests'),
    inspector.switchMap('latest', loadUnavailableResult$),
    inspector.inspect('results'),
  ).subscribe({ error: handleExpectedError });
  scheduler.flush();
  return inspector.getTrace();
}

function recordUnsubscription(): Trace {
  const scheduler = new VirtualTimeScheduler();
  const inspector = createInspector({
    name: 'Consumer ends an interval subscription',
    clock: { name: 'Unsubscription fixture', kind: 'virtual', now: () => scheduler.now() },
    nodes: [{ id: 'ticks', label: 'ticks$', kind: 'source' }, { id: 'consumer', label: 'consumer', kind: 'sink' }],
    edges: [{ from: 'ticks', to: 'consumer' }],
  });
  const subscription = interval(10, scheduler).pipe(inspector.inspect('ticks'), inspector.inspect('consumer')).subscribe();
  scheduler.schedule(() => subscription.unsubscribe(), 35);
  scheduler.flush();
  return inspector.getTrace();
}

/** Each invocation runs a fresh controlled fixture. Scrubbing the viewer does not. */
export function createDemoTrace(scenario: Scenario): Trace {
  switch (scenario) {
    case 'labels': return recordLabelledOperators();
    case 'switchMap': return recordSearch();
    case 'independent': return recordConsumers(false);
    case 'shared': return recordConsumers(true);
    case 'error': return recordError();
    case 'unsubscribe': return recordUnsubscription();
  }
}

const descriptions: Record<Scenario, string> = {
  labels: 'Two cold runs use the same map, filter, and scan labels. Each run produces 4 then 10 with separate subscription identities. All values are synchronous; event ordinals show their order.',
  switchMap: 'A newer query replaces the first inner subscription. When the outer source completes, the output waits for the active inner. Both inner sources are controlled cold fixtures.',
  independent: 'Two consumers subscribe to a cold source at different times. The recording contains two separate producer executions.',
  shared: 'Both consumers join before the first value. A leaves at 15 ms; the shared source stays active for B until B leaves at 35 ms. The graph records the shared connection separately from both consumers.',
  error: 'An inner source emits an error. Inspect how it reaches the output and how the active outer subscription is disposed.',
  unsubscribe: 'The consumer explicitly unsubscribes at 35 ms. Disposal closes the observed executions without a complete notification.',
};

if (typeof document !== 'undefined') {
  const host = document.querySelector<HTMLElement>('#inspector');
  const picker = document.querySelector<HTMLSelectElement>('#scenario');
  const rerun = document.querySelector<HTMLButtonElement>('#record-again');
  const description = document.querySelector<HTMLElement>('#scenario-description');
  if (host && picker && rerun && description) {
    const view = mountInspector(host, createDemoTrace('switchMap'));
    description.textContent = descriptions.switchMap;
    function recordSelectedScenario(): void {
      const scenario = picker!.value as Scenario;
      if (!(scenario in descriptions)) return;
      view.setTrace(createDemoTrace(scenario));
      description!.textContent = descriptions[scenario];
    }
    picker.addEventListener('change', recordSelectedScenario);
    rerun.addEventListener('click', recordSelectedScenario);
    window.addEventListener('pagehide', () => view.destroy(), { once: true });
  }
}

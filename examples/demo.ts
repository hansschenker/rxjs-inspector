import { Observable, VirtualTimeScheduler, interval, share } from 'rxjs';
import { createInspector } from '../src/index.js';
import { mountInspector } from '../src/viewer.js';
import type { Trace } from '../src/types.js';

export type Scenario = 'switchMap' | 'independent' | 'shared' | 'error' | 'unsubscribe';

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
      { id: 'consumer-a', label: 'consumer A', kind: 'sink' },
      { id: 'consumer-b', label: 'consumer B', kind: 'sink' },
    ],
    edges: [{ from: 'producer', to: 'consumer-a' }, { from: 'producer', to: 'consumer-b' }],
  });
  const producer$ = new Observable<string>(subscriber => {
    const value = scheduler.schedule(() => subscriber.next('shared package'), 10);
    const complete = scheduler.schedule(() => subscriber.complete(), 30);
    return () => { value.unsubscribe(); complete.unsubscribe(); };
  }).pipe(inspector.inspect<string>('producer'));
  const source$ = shared
    ? producer$.pipe(share({ resetOnError: true, resetOnComplete: true, resetOnRefCountZero: true }))
    : producer$;
  source$.pipe(inspector.inspect('consumer-a')).subscribe();
  scheduler.schedule(() => source$.pipe(inspector.inspect('consumer-b')).subscribe(), 5);
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
    case 'switchMap': return recordSearch();
    case 'independent': return recordConsumers(false);
    case 'shared': return recordConsumers(true);
    case 'error': return recordError();
    case 'unsubscribe': return recordUnsubscription();
  }
}

const descriptions: Record<Scenario, string> = {
  switchMap: 'A newer query replaces the first inner subscription. When the outer source completes, the output waits for the active inner. Both inner sources are controlled cold fixtures.',
  independent: 'Two consumers subscribe to a cold source at different times. The recording contains two separate producer executions.',
  shared: 'The same two consumers now use an explicitly shared source. The recording contains one upstream producer execution and two consumer subscriptions.',
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

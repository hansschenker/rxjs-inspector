import { writeFile } from 'node:fs/promises';
import { Observable, Subject, VirtualTimeScheduler } from 'rxjs';
import { createInspector, serializeTrace } from '../src/index.js';

interface SearchResult { readonly query: string; readonly label: string }

const scheduler = new VirtualTimeScheduler();
const inspector = createInspector({
  name: 'Search: latest query wins',
  clock: { name: 'virtual search clock', kind: 'virtual', now: () => scheduler.now() },
  nodes: [
    { id: 'queries', label: 'queries$', kind: 'source' },
    { id: 'latest', label: 'latest result', kind: 'operator', operator: 'switchMap', domain: 'loadResult$' },
    { id: 'results', label: 'results$', kind: 'sink' },
  ],
  edges: [{ from: 'queries', to: 'latest' }, { from: 'latest', to: 'results' }],
});

/** Controlled fixture: timing comes from the scheduler; the domain names the result. */
function loadResult$(query: string): Observable<SearchResult> {
  return new Observable(destination => {
    const responseDelay = query === 'A' ? 80 : 30;
    const response = scheduler.schedule(() => destination.next({ query, label: `Result for ${query}` }), responseDelay);
    const completion = scheduler.schedule(() => destination.complete(), responseDelay + 20);
    return () => { response.unsubscribe(); completion.unsubscribe(); };
  });
}

const queries$ = new Subject<string>(); // Explicit live source driven by this controlled fixture.
const results$ = queries$.pipe(
  inspector.inspect<string>('queries'),
  inspector.switchMap('latest', loadResult$),
  inspector.inspect<SearchResult>('results'),
);
function showResult(result: SearchResult): void { console.log(`${scheduler.now()} ms`, result); }
results$.subscribe({ next: showResult });
scheduler.schedule(() => queries$.next('A'), 0);
scheduler.schedule(() => queries$.next('B'), 40);
scheduler.schedule(() => queries$.complete(), 50);
scheduler.flush();

const trace = inspector.getTrace();
await writeFile(new URL('../search-trace.json', import.meta.url), serializeTrace(trace), 'utf8');
console.log(`Recorded ${trace.events.length} events in search-trace.json. Import it in the viewer with npm run demo.`);

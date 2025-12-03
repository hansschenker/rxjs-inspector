// src/example/debounced-search-timeline.ts
// Demonstrates RxJS Inspector with a debounced search pipeline

import { Subject, of } from 'rxjs';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  delay,
  finalize,
} from 'rxjs/operators';

import {
  installRxjsInstrumentation,
  notifications$,
} from '../instrumentation/core.js';
import { NotificationEvent } from '../instrumentation/types.js';
import { eventsToTimelineMermaid } from '../visualization/eventsToTimelineMermaid.js';

// --- 1. Install instrumentation ------------------------------------------------

installRxjsInstrumentation();

// Collect all NotificationEvents for this run
const recorded: NotificationEvent[] = [];
const eventsSub = notifications$.subscribe(e => recorded.push(e));

// --- 2. Simulated search input & API -------------------------------------------

interface SearchResult {
  total: number;
  items: string[];
}

// Simulated "user typing" stream
const searchInput$ = new Subject<string>();

// Simulated async search API
function searchApi(query: string) {
  // Emit one result after 100ms and complete
  return of<SearchResult>({
    total: 1,
    items: [`Result for ${query}`],
  }).pipe(delay(100));
}

// Debounced search pipeline under inspection
const searchResult$ = searchInput$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(query => searchApi(query)),
  finalize(() => {
    // When the pipeline completes, generate and print the Mermaid timeline
    const mermaid = eventsToTimelineMermaid(
      recorded,
      'RxJS Debounced Search Operator Chain',
    );
    console.log('\n=== RxJS Inspector – Debounced Search Timeline ===\n');
    console.log(mermaid);
    console.log('\n=== end timeline ===\n');

    // Stop listening to instrumentation events
    eventsSub.unsubscribe();
  }),
);

// Subscribe as if this were the UI
searchResult$.subscribe({
  next: result => {
    console.log('UI received search result:', result);
  },
  complete: () => {
    console.log('searchResult$ complete');
  },
});

// --- 3. Drive the scenario with timed keystrokes --------------------------------

// Timeline (approx):
//  0.100s: "r"
//  0.200s: "rx"
//  0.300s: "rxjs"
//  0.700s: input complete
//
// With debounceTime(300):
//  "rxjs" is emitted around 0.600s,
//  searchApi("rxjs") returns around 0.700s.

setTimeout(() => {
  console.log('[input] "r"');
  searchInput$.next('r');
}, 100);

setTimeout(() => {
  console.log('[input] "rx"');
  searchInput$.next('rx');
}, 200);

setTimeout(() => {
  console.log('[input] "rxjs"');
  searchInput$.next('rxjs');
}, 300);

setTimeout(() => {
  console.log('[input] complete');
  searchInput$.complete();
}, 700);

// After ~1 second everything should have completed and the process can exit.
// (Node will exit automatically once there are no more timers/subscriptions.)

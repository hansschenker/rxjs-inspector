// Conceptual debounced search example for rxjs-inspector.
// This is not wired to a real UI, but shows the kind of pipeline
// you might want to inspect.

import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { Observable, of } from 'rxjs';
import { installRxjsInstrumentation, notifications$ } from '../instrumentation/core.js';

installRxjsInstrumentation();

interface SearchResult {
  total: number;
  items: string[];
}

// Mock search input and API
const searchInput$: Observable<string> = of('r', 'rx', 'rxjs', 'rxjs error');

function searchApi(query: string): Observable<SearchResult> {
  // In a real app, this would be an HTTP request.
  return of({
    total: 1,
    items: [`Result for ${query}`],
  });
}

export const searchResult$ = searchInput$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(query => searchApi(query)),
);

// For now, just subscribe and log notifications to console
notifications$.subscribe(evt => {
  // In a real tool, this would go to a file or visualization layer.
  console.log('[INSTR]', evt);
});

searchResult$.subscribe(result => {
  console.log('SEARCH RESULT', result);
});

// src/simple.ts
// Simple demo of RxJS Inspector instrumentation

// 1) Side-effect import: starts NDJSON logging to rxjs-inspector.ndjson
import './node/ndjson-logger.js';

import { of } from 'rxjs';
import { map } from 'rxjs/operators';

// 2) Import instrumentation (and optionally notifications$ for debugging)
import { installRxjsInstrumentation, notifications$ } from './instrumentation/core.js';

// 3) Install instrumentation BEFORE any subscriptions
installRxjsInstrumentation();

// 4) Debug: log inspector events to console
notifications$.subscribe((evt) => {
  console.log('[INSPECTOR EVENT]', evt);
});

// 5) Your demo observable
of(1, 2, 3)
  .pipe(map((x: number) => x * 10))
  .subscribe({
    next: (value) => console.log('value:', value),
    complete: () => console.log('complete'),
  });

import { of } from 'rxjs';
import { map } from 'rxjs/operators';
// src/simple.ts

// 1) Start NDJSON logging (side effect import)
// ndjson-logger.ts is in src/node/
import './node/ndjson-logger';

// 2) Install Rxjs-Inspector instrumentation
// core.ts is in src/instrumentation/
import { installRxjsInstrumentation } from './instrumentation/core';

installRxjsInstrumentation();


console.log('--- simple.ts: Rxjs-Inspector demo ---');

of(5, 6, 7, 8, 9)
  .pipe(map((x) => x * 10))
  .subscribe({
    next: (value) => console.log('RESULT', value),
    complete: () => console.log('RESULT complete'),
  });

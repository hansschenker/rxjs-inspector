import { from } from 'rxjs';
import { map, filter, take } from 'rxjs/operators';
// src/simple.ts

// 1) Start NDJSON logging (side effect import)
// ndjson-logger.ts is in src/node/
import './node/ndjson-logger';

// 2) Install Rxjs-Inspector instrumentation
// core.ts is in src/instrumentation/
import { installRxjsInstrumentation } from './instrumentation/core';
import { tag } from './instrumentation/tag';

installRxjsInstrumentation();


console.log('--- simple.ts: Rxjs-Inspector demo ---');

from([1, 2, 3, 4, 5, 6, 7, 8, 9])
  .pipe(
    tag('Numbers$'),
    map((x) => x * 10),
    tag('map n => n * 10'),
    filter((x) => x > 30),
    tag('filter n => n > 30'),
    take(5),
    tag('take 5'),
  )
  .subscribe({
    next: (value) => console.log('RESULT', value),
    complete: () => console.log('RESULT complete'),
  });

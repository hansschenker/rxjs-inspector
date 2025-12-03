import { from, map, filter } from 'rxjs';
import { createWriteStream } from 'node:fs';
import { installRxjsInstrumentation, notifications$ } from '../instrumentation/core.js';
import { tag } from '../operators/tag.js';

// Install the RxJS Inspector monkey patch
installRxjsInstrumentation();

// NDJSON log file
const logFile = createWriteStream('rxjs-inspector-tagged.ndjson', { flags: 'w' });

// Subscribe to all notification events and write them as NDJSON
notifications$.subscribe(evt => {
  logFile.write(JSON.stringify(evt) + '\n');
});

// Example pipeline with tagged source observable
const source$ = from([1, 2, 3, 4, 5, 6, 7, 8, 9]).pipe(
  tag('numbers-from-array')
);

const result$ = source$.pipe(
  map((n: number) => n * 10),
  filter((n: number) => n > 40),
);

result$.subscribe({
  next: value => {
    console.log('RESULT', value);
  },
  complete: () => {
    console.log('RESULT complete');
    setTimeout(() => logFile.end(), 100);
  },
});

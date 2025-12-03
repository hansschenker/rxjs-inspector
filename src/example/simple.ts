import { from, map, filter } from 'rxjs';
import { createWriteStream } from 'node:fs';
import { installRxjsInstrumentation, notifications$ } from '../instrumentation/core.js';

// Install the RxJS Inspector monkey patch
installRxjsInstrumentation();

// NDJSON log file
const logFile = createWriteStream('rxjs-inspector.ndjson', { flags: 'a' });

// Subscribe to all notification events and write them as NDJSON
notifications$.subscribe(evt => {
  logFile.write(JSON.stringify(evt) + '\n');
});

// Example pipeline under inspection
const result$ = from([1, 2, 3, 4, 5, 6, 7, 8, 9]).pipe(
  map((n: number) => n * 10),
  filter((n: number) => n > 40),
);

result$.subscribe({
  next: value => {
    console.log('RESULT', value);
  },
  complete: () => {
    console.log('RESULT complete');
    logFile.end();
  },
});

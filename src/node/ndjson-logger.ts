// src/node/ndjson-logger.ts

import { createWriteStream } from 'node:fs';
import { notifications$ } from '../instrumentation/core';

const stream = createWriteStream('rxjs-inspector.ndjson', { flags: 'a' });

stream.on('error', (err) => {
  console.error('[rxjs-inspector] NDJSON stream error:', err);
});

notifications$.subscribe((event: unknown) => {
  const line = JSON.stringify(event) + '\n';
  stream.write(line);
});

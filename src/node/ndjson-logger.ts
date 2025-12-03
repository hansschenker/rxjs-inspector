// src/node/ndjson-logger.ts
import { createWriteStream, WriteStream } from 'node:fs';
import { notifications$ } from '../instrumentation/core.js';
import { Subscription } from 'rxjs';

const stream: WriteStream = createWriteStream('rxjs-inspector.ndjson', { flags: 'a' });
let subscription: Subscription | null = null;

stream.on('error', (err) => {
  console.error('[rxjs-inspector] NDJSON stream error:', err);
});

/**
 * Safely serialize a value, handling circular references.
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

subscription = notifications$.subscribe((event) => {
  try {
    const line = safeStringify(event) + '\n';
    stream.write(line);
  } catch (err) {
    console.error('[rxjs-inspector] Failed to serialize event:', err);
  }
});

// Cleanup on process exit
function cleanup(): void {
  subscription?.unsubscribe();
  stream.end();
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

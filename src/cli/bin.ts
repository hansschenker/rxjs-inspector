#!/usr/bin/env node
// src/cli/bin.ts
import fs from 'node:fs';
import process from 'node:process';
import { printLog } from './print-log.js';
import { NotificationEvent } from '../instrumentation/types.js';

type Format = 'tree' | 'flat' | 'timeline';

function parseNdjson(text: string): NotificationEvent[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as NotificationEvent);
}

function main() {
  const [, , filePath, formatArg] = process.argv;

  if (!filePath) {
    console.error('Usage: rxjs-inspector <file.ndjson|file.json> [format]');
    console.error('Formats: tree, flat, timeline');
    process.exit(1);
  }

  const format: Format = (formatArg as Format) ?? 'tree';

  const raw = fs.readFileSync(filePath, 'utf8');

  // Support both JSON array and NDJSON formats
  let events: NotificationEvent[];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    events = JSON.parse(raw) as NotificationEvent[];
  } else {
    events = parseNdjson(raw);
  }

  printLog(events, { format });
}

main();

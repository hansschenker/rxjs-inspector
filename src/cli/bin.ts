#!/usr/bin/env node
// src/cli/bin.ts
import fs from 'node:fs';
import process from 'node:process';
import { printLog } from './print-log';
import { NotificationEvent } from '../instrumentation/types';

function main() {
  const [,, filePath, formatArg] = process.argv;

  if (!filePath) {
    console.error('Usage: rxjs-inspector <events.json> [format]');
    process.exit(1);
  }

  const format = (formatArg as any) ?? 'tree';

  const raw = fs.readFileSync(filePath, 'utf8');
  const events = JSON.parse(raw) as NotificationEvent[];

  printLog(events, { format });
}

main();

// src/cli/print-log.ts

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

type NotificationType = 'subscribe' | 'next' | 'error' | 'complete' | 'unsubscribe';

interface NotificationEvent {
  type: NotificationType;
  runId?: number;              // optional for legacy events
  timestamp: number;
  observableId: number;
  subscriptionId: number;
  [key: string]: any;          // value, error, etc.
}

function loadEvents(filePath: string): NotificationEvent[] {
  const abs = path.resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.map((line) => JSON.parse(line) as NotificationEvent);
}

function printOneGroup(events: NotificationEvent[]): void {
  if (events.length === 0) {
    console.log('  (no events)');
    return;
  }

  // Group by observableId → subscriptionId
  const byObservable = new Map<number, Map<number, NotificationEvent[]>>();

  for (const evt of events) {
    let bySub = byObservable.get(evt.observableId);
    if (!bySub) {
      bySub = new Map();
      byObservable.set(evt.observableId, bySub);
    }
    const list = bySub.get(evt.subscriptionId) ?? [];
    list.push(evt);
    bySub.set(evt.subscriptionId, list);
  }

  // Compute start time for this group
  const sortedAll = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const start = sortedAll[0]?.timestamp ?? 0;

  for (const [observableId, bySub] of byObservable.entries()) {
    console.log(`Observable ${observableId}:`);
    for (const [subscriptionId, subEvents] of bySub.entries()) {
      console.log(`  Subscription ${subscriptionId}:`);
      const sorted = [...subEvents].sort((a, b) => a.timestamp - b.timestamp);
      for (const evt of sorted) {
        const dt = evt.timestamp - start;
        const base = `    +${dt}ms ${evt.type.padEnd(10)}`;
        if (evt.type === 'next' && 'value' in evt) {
          console.log(`${base} value = ${JSON.stringify(evt.value)}`);
        } else if (evt.type === 'error' && 'error' in evt) {
          console.log(`${base} error = ${JSON.stringify(evt.error)}`);
        } else {
          console.log(base);
        }
      }
    }
  }
}

function groupAndPrint(events: NotificationEvent[]): void {
  if (events.length === 0) {
    console.log('No events found.');
    return;
  }

  const legacy: NotificationEvent[] = [];
  const byRun = new Map<number, NotificationEvent[]>();

  for (const evt of events) {
    if (typeof evt.runId === 'number') {
      const list = byRun.get(evt.runId) ?? [];
      list.push(evt);
      byRun.set(evt.runId, list);
    } else {
      legacy.push(evt);
    }
  }

  // First, print legacy events (no runId)
  if (legacy.length > 0) {
    console.log('=== Legacy events (no runId) ===');
    printOneGroup(legacy);
  }

  // Then, print each run with a proper header
  const runIds = Array.from(byRun.keys()).sort((a, b) => a - b);
  for (const runId of runIds) {
    console.log(`\n=== Run ${runId} ===`);
    const runEvents = byRun.get(runId)!;
    printOneGroup(runEvents);
  }
}

function main() {
  const fileArg = process.argv[2] ?? 'rxjs-inspector.ndjson';
  const events = loadEvents(fileArg);
  groupAndPrint(events);
}

main();

// src/cli/print-log.ts
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

type NotificationType = 'subscribe' | 'next' | 'error' | 'complete' | 'unsubscribe';

interface NotificationEvent {
  type: NotificationType;
  timestamp: number;
  observableId: number;
  subscriptionId: number;
  // any other fields: value, error, etc.
  [key: string]: any;
}

function loadEvents(filePath: string): NotificationEvent[] {
  const abs = path.resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.map((line) => JSON.parse(line) as NotificationEvent);
}

function groupAndPrint(events: NotificationEvent[]): void {
  if (events.length === 0) {
    console.log('No events found.');
    return;
  }

  const startTime = events[0].timestamp;

  // Group by observableId then subscriptionId
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

  for (const [observableId, bySub] of byObservable.entries()) {
    console.log(`\nObservable ${observableId}:`);
    for (const [subscriptionId, subEvents] of bySub.entries()) {
      console.log(`  Subscription ${subscriptionId}:`);
      for (const evt of subEvents) {
        const dt = evt.timestamp - startTime;
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

function main() {
  const fileArg = process.argv[2] ?? 'rxjs-inspector.ndjson';
  const events = loadEvents(fileArg);
  groupAndPrint(events);
}

main();

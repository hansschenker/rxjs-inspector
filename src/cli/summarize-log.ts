// src/cli/summarize-log.ts

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { NotificationEvent } from '../instrumentation/types.js';

// Extended event type with optional runId for grouping
type ExtendedNotificationEvent = NotificationEvent & {
  runId?: number;
};

interface ObservableSummary {
  observableId: number;
  subscriptionIds: Set<number>;
  totalEvents: number;
  nextCount: number;
  errorCount: number;
  completeCount: number;
  unsubscribeCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
}

function loadEvents(filePath: string): ExtendedNotificationEvent[] {
  const abs = path.resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.map((line) => JSON.parse(line) as ExtendedNotificationEvent);
}

function buildSummary(events: NotificationEvent[]): Map<number, ObservableSummary> {
  const byObservable = new Map<number, ObservableSummary>();

  for (const evt of events) {
    let summary = byObservable.get(evt.observableId);
    if (!summary) {
      summary = {
        observableId: evt.observableId,
        subscriptionIds: new Set<number>(),
        totalEvents: 0,
        nextCount: 0,
        errorCount: 0,
        completeCount: 0,
        unsubscribeCount: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      };
      byObservable.set(evt.observableId, summary);
    }

    summary.totalEvents++;

    // track subscriptions / unsubscriptions
    if (
      evt.type === 'subscribe' ||
      evt.type === 'next' ||
      evt.type === 'error' ||
      evt.type === 'complete' ||
      evt.type === 'unsubscribe'
    ) {
      summary.subscriptionIds.add(evt.subscriptionId);
    }

    // counts by type
    if (evt.type === 'next') summary.nextCount++;
    if (evt.type === 'error') summary.errorCount++;
    if (evt.type === 'complete') summary.completeCount++;
    if (evt.type === 'unsubscribe') summary.unsubscribeCount++;

    // timestamps
    if (summary.firstTimestamp === null || evt.timestamp < summary.firstTimestamp) {
      summary.firstTimestamp = evt.timestamp;
    }
    if (summary.lastTimestamp === null || evt.timestamp > summary.lastTimestamp) {
      summary.lastTimestamp = evt.timestamp;
    }
  }

  return byObservable;
}

function computeWarnings(s: ObservableSummary): string[] {
  const warnings: string[] = [];

  const hasNext = s.nextCount > 0;
  const hasComplete = s.completeCount > 0;
  const hasError = s.errorCount > 0;

  // 1) Emits but never completes or errors
  if (hasNext && !hasComplete && !hasError) {
    warnings.push(
      '⚠ emits values but never completes or errors (possible leak / intentionally infinite stream)'
    );
  }

  // 2) Has errors
  if (hasError) {
    warnings.push(`⚠ emitted errors (errorCount = ${s.errorCount})`);
  }

  // 3) Multiple subscriptions
  if (s.subscriptionIds.size > 1) {
    warnings.push(
      `ℹ multiple subscriptions (${s.subscriptionIds.size}) – consider share()/shareReplay() if upstream is expensive`
    );
  }

  return warnings;
}

function summarizeRun(runLabel: string, events: NotificationEvent[]): void {
  if (events.length === 0) {
    console.log(`=== ${runLabel} ===`);
    console.log('  (no events)');
    return;
  }

  const byObservable = buildSummary(events);

  console.log(`=== ${runLabel} ===`);

  const sortedSummaries = Array.from(byObservable.values()).sort(
    (a, b) => a.observableId - b.observableId,
  );

  for (const s of sortedSummaries) {
    const duration =
      s.firstTimestamp !== null && s.lastTimestamp !== null
        ? s.lastTimestamp - s.firstTimestamp
        : 0;

    console.log(`Observable ${s.observableId}:`);
    console.log(`  subscriptions:    ${s.subscriptionIds.size}`);
    console.log(`  events:           ${s.totalEvents}`);
    console.log(`  next:             ${s.nextCount}`);
    console.log(`  complete:         ${s.completeCount}`);
    console.log(`  error:            ${s.errorCount}`);
    console.log(`  unsubscribe:      ${s.unsubscribeCount}`);
    console.log(`  duration:         ${duration}ms`);

    const warnings = computeWarnings(s);
    if (warnings.length === 0) {
      console.log('  warnings:         (none)');
    } else {
      console.log('  warnings:');
      for (const w of warnings) {
        console.log(`    - ${w}`);
      }
    }
  }
}

function groupAndSummarize(events: ExtendedNotificationEvent[]): void {
  if (events.length === 0) {
    console.log('No events found.');
    return;
  }

  const legacy: ExtendedNotificationEvent[] = [];
  const byRun = new Map<number, ExtendedNotificationEvent[]>();

  for (const evt of events) {
    if (typeof evt.runId === 'number') {
      const list = byRun.get(evt.runId) ?? [];
      list.push(evt);
      byRun.set(evt.runId, list);
    } else {
      legacy.push(evt);
    }
  }

  // Legacy block (no runId)
  if (legacy.length > 0) {
    summarizeRun('Legacy events (no runId)', legacy);
  }

  // Each proper run
  const runIds = Array.from(byRun.keys()).sort((a, b) => a - b);
  for (const runId of runIds) {
    summarizeRun(`Run ${runId}`, byRun.get(runId)!);
  }
}

function main() {
  const fileArg = process.argv[2] ?? 'rxjs-inspector.ndjson';
  const events = loadEvents(fileArg);
  groupAndSummarize(events);
}

main();

// src/cli/to-mermaid.ts
//
// Read rxjs-inspector NDJSON logs and emit a simple Mermaid flowchart.
// One node per observable in a chosen run, showing basic stats.
//
// Usage:
//   ts-node src/cli/to-mermaid.ts              # use rxjs-inspector.ndjson, latest run
//   ts-node src/cli/to-mermaid.ts mylog.ndjson # use custom file
//   ts-node src/cli/to-mermaid.ts mylog.ndjson 1764410778180  # explicit runId

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

type NotificationType = 'subscribe' | 'next' | 'error' | 'complete' | 'unsubscribe';

interface NotificationEvent {
  type: NotificationType;
  runId?: number;              // optional for legacy events
  timestamp: number;
  observableId: number;
  subscriptionId: number;
  value?: unknown;
  error?: unknown;
  [key: string]: any;
}

interface ObservableStats {
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

function loadEvents(filePath: string): NotificationEvent[] {
  const abs = path.resolve(filePath);
  const text = readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.map((line) => JSON.parse(line) as NotificationEvent);
}

function groupByRun(events: NotificationEvent[]): {
  runs: Map<number, NotificationEvent[]>;
  legacy: NotificationEvent[];
} {
  const runs = new Map<number, NotificationEvent[]>();
  const legacy: NotificationEvent[] = [];

  for (const evt of events) {
    if (typeof evt.runId === 'number') {
      const list = runs.get(evt.runId) ?? [];
      list.push(evt);
      runs.set(evt.runId, list);
    } else {
      legacy.push(evt);
    }
  }

  return { runs, legacy };
}

function pickRun(
  runs: Map<number, NotificationEvent[]>,
  legacy: NotificationEvent[],
  explicitRunId?: number,
): { label: string; events: NotificationEvent[] } {
  if (explicitRunId !== undefined && runs.has(explicitRunId)) {
    return { label: `Run ${explicitRunId}`, events: runs.get(explicitRunId)! };
  }

  const runIds = Array.from(runs.keys()).sort((a, b) => a - b);
  if (runIds.length > 0) {
    const latest = runIds[runIds.length - 1];
    return { label: `Run ${latest}`, events: runs.get(latest)! };
  }

  if (legacy.length > 0) {
    return { label: 'Legacy events (no runId)', events: legacy };
  }

  return { label: 'Empty log', events: [] };
}

function buildStats(events: NotificationEvent[]): Map<number, ObservableStats> {
  const byObservable = new Map<number, ObservableStats>();

  for (const evt of events) {
    let stats = byObservable.get(evt.observableId);
    if (!stats) {
      stats = {
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
      byObservable.set(evt.observableId, stats);
    }

    stats.totalEvents++;
    stats.subscriptionIds.add(evt.subscriptionId);

    if (evt.type === 'next') stats.nextCount++;
    if (evt.type === 'error') stats.errorCount++;
    if (evt.type === 'complete') stats.completeCount++;
    if (evt.type === 'unsubscribe') stats.unsubscribeCount++;

    if (stats.firstTimestamp === null || evt.timestamp < stats.firstTimestamp) {
      stats.firstTimestamp = evt.timestamp;
    }
    if (stats.lastTimestamp === null || evt.timestamp > stats.lastTimestamp) {
      stats.lastTimestamp = evt.timestamp;
    }
  }

  return byObservable;
}

function emitMermaid(label: string, statsByObs: Map<number, ObservableStats>): void {
  const statsList = Array.from(statsByObs.values()).sort(
    (a, b) => a.observableId - b.observableId,
  );

  if (statsList.length === 0) {
    console.error('No events for selected run; nothing to visualize.');
    return;
  }

  console.log('flowchart TD');
  console.log('  %% Rxjs-Inspector Mermaid view');
  console.log(`  %% ${label}`);

  for (const s of statsList) {
    const nodeId = `obs${s.observableId}`;
    const duration =
      s.firstTimestamp !== null && s.lastTimestamp !== null
        ? s.lastTimestamp - s.firstTimestamp
        : 0;

    const subs = s.subscriptionIds.size;
    const labelLines = [
      `Observable ${s.observableId}`,
      `subs: ${subs}`,
      `next: ${s.nextCount}`,
      `complete: ${s.completeCount}`,
      `error: ${s.errorCount}`,
      `unsubscribe: ${s.unsubscribeCount}`,
      `dur: ${duration}ms`,
    ];

    const nodeLabel = labelLines.join('\\n');
    console.log(`  ${nodeId}["${nodeLabel}"]`);
  }

  // Edges can be added in a later version when we infer relationships.
  // For now we just render nodes and let Mermaid lay them out.
}

function main() {
  const args = process.argv.slice(2);
  const filePath = args[0] ?? 'rxjs-inspector.ndjson';
  const runIdArg = args[1] !== undefined ? Number(args[1]) : undefined;

  const events = loadEvents(filePath);
  if (events.length === 0) {
    console.error('No events found in log file.');
    return;
  }

  const { runs, legacy } = groupByRun(events);
  const { label, events: runEvents } = pickRun(runs, legacy, runIdArg);

  if (runEvents.length === 0) {
    console.error(`No events found for selected run (${label}).`);
    return;
  }

  const stats = buildStats(runEvents);
  emitMermaid(label, stats);
}

main();

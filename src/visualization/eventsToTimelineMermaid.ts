import { NotificationEvent } from '../instrumentation/types';

const TICK_MS = 100;      // 100ms per tick
const MAX_TICKS = 7;      // 0..7 -> 0.000..0.700 seconds

type DocKind =
  | 'created'
  | 'subscribed'
  | 'next'
  | 'error'
  | 'complete'
  | 'unsubscribed'
  | 'complete&unsubscribed';

interface DocEvent {
  kind: DocKind;
  event: NotificationEvent;
}

export function eventsToTimelineMermaid(
  events: NotificationEvent[],
  title = 'RxJS Inspector Timeline',
): string {
  if (!events.length) {
    return '```mermaid\ntimeline\n  title (no events)\n```';
  }

  const start = Math.min(...events.map(e => e.timestamp));

  const quantizeTick = (ts: number) => {
    const dt = ts - start;
    let tick = Math.floor(dt / TICK_MS);
    if (tick > MAX_TICKS) tick = MAX_TICKS;
    return tick;
  };

  // Sort events by time, then observableId, then subscriptionId
  const sorted = [...events].sort((a, b) => {
    const ta = a.timestamp - b.timestamp;
    if (ta !== 0) return ta;
    const oa = a.observableId - b.observableId;
    if (oa !== 0) return oa;
    const sa = (a.subscriptionId ?? 0) - (b.subscriptionId ?? 0);
    return sa;
  });

  // Group events by quantized tick
  const buckets = new Map<number, NotificationEvent[]>();
  for (const e of sorted) {
    const tick = quantizeTick(e.timestamp);
    const bucket = buckets.get(tick) ?? [];
    bucket.push(e);
    buckets.set(tick, bucket);
  }

  const ticks = [...buckets.keys()].sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('timeline');
  lines.push(`  title ${title}`);
  lines.push('');

  for (const tick of ticks) {
    const timestampSec = ((tick * TICK_MS) / 1000).toFixed(3);
    const bucket = buckets.get(tick)!;

    const docEvents = toDocEvents(bucket);

    docEvents.forEach((d, index) => {
      const prefix = index === 0 ? `  ${timestampSec} :` : '        :';
      const text = formatDocEventText(d);
      lines.push(`${prefix} ${text}`);
    });

    lines.push(''); // blank line between time blocks
  }

  lines.push('```');
  return lines.join('\n');
}

function toDocEvents(bucket: NotificationEvent[]): DocEvent[] {
  // Group by observableId + subscriptionId
  const groups = new Map<string, NotificationEvent[]>();

  for (const e of bucket) {
    const key = `${e.observableId}:${e.subscriptionId ?? 0}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const doc: DocEvent[] = [];

  for (const [, events] of groups) {
    // We don't really care about exact millisecond order inside a bucket,
    // but keep it stable.
    events.sort((a, b) => {
      const ta = a.timestamp - b.timestamp;
      if (ta !== 0) return ta;
      return a.type.localeCompare(b.type);
    });

    const base = events[0];
    const hasComplete = events.some(e => e.type === 'complete');
    const hasUnsub = events.some(e => e.type === 'unsubscribe');

    // 1) Add non-complete/unsubscribe events as-is
    for (const e of events) {
      if (e.type === 'complete' || e.type === 'unsubscribe') continue;
      doc.push({
        kind: eventTypeToKind(e.type),
        event: e,
      });
    }

    // 2) Merge complete & unsubscribe into a single doc event if both exist
    if (hasComplete && hasUnsub) {
      const completeEvt =
        events.find(e => e.type === 'complete') ?? base;
      doc.push({
        kind: 'complete&unsubscribed',
        event: completeEvt,
      });
    } else if (hasComplete) {
      const completeEvt = events.find(e => e.type === 'complete')!;
      doc.push({
        kind: 'complete',
        event: completeEvt,
      });
    } else if (hasUnsub) {
      const unsubEvt = events.find(e => e.type === 'unsubscribe')!;
      doc.push({
        kind: 'unsubscribed',
        event: unsubEvt,
      });
    }
  }

  // Stable ordering:
  //  - by observableId
  //  - by subscriptionId
  //  - by doc-kind in logical order (not alphabetical!)
  doc.sort((a, b) => {
    const oa = a.event.observableId - b.event.observableId;
    if (oa !== 0) return oa;
    const sa =
      (a.event.subscriptionId ?? 0) - (b.event.subscriptionId ?? 0);
    if (sa !== 0) return sa;
    return kindOrder(a.kind) - kindOrder(b.kind);
  });

  return doc;
}

function eventTypeToKind(type: NotificationEvent['type']): DocKind {
  switch (type) {
    case 'observable-create':
      return 'created';
    case 'subscribe':
      return 'subscribed';
    case 'next':
      return 'next';
    case 'error':
      return 'error';
    case 'complete':
      return 'complete';
    case 'unsubscribe':
      return 'unsubscribed';
  }
}

function kindOrder(kind: DocKind): number {
  switch (kind) {
    case 'created':
      return 0;
    case 'subscribed':
      return 1;
    case 'next':
      return 2;
    case 'error':
      return 3;
    case 'complete':
      return 4;
    case 'unsubscribed':
      return 5;
    case 'complete&unsubscribed':
      return 6;
  }
}

function formatDocEventText(d: DocEvent): string {
  const e = d.event;
  const obs = `obs${e.observableId}`;
  const sub = e.subscriptionId != null ? ` (sub${e.subscriptionId})` : '';

  switch (d.kind) {
    case 'created':
      return `${obs} created${infoSuffix(e.info)}`;
    case 'subscribed':
      return `${obs} subscribed${sub}`;
    case 'next':
      return `${obs} next ${shortValue(e.value)}${sub}`;
    case 'error':
      return `${obs} error ${shortValue(e.error)}${sub}`;
    case 'complete':
      return `${obs} complete${sub}`;
    case 'unsubscribed':
      return `${obs} unsubscribed${sub}`;
    case 'complete&unsubscribed':
      return `${obs} complete & unsubscribed${sub}`;
  }
}

function shortValue(v: unknown): string {
  if (v == null) return 'null';
  try {
    const json = JSON.stringify(v);
    return json.length > 40 ? json.slice(0, 37) + '...' : json;
  } catch {
    return String(v);
  }
}

function infoSuffix(info?: string): string {
  return info ? ` (${info})` : '';
}

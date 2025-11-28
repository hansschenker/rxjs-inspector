import { NotificationEvent } from '../instrumentation/types';

export function eventsToTimelineMermaid(
  events: NotificationEvent[],
  title = 'RxJS Inspector Timeline',
): string {
  if (!events.length) {
    return '```mermaid\ntimeline\n  title (no events)\n```';
  }

  const start = Math.min(...events.map(e => e.timestamp));
  const rel = (e: NotificationEvent) =>
    ((e.timestamp - start) / 1000).toFixed(3); // seconds

  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('timeline');
  lines.push(`  title ${title}`);
  lines.push('');
  lines.push('  section Events');

  for (const e of events) {
    const t = rel(e);
    const base = `obs${e.observableId}/sub${e.subscriptionId ?? 0}`;

    switch (e.type) {
      case 'observable-create':
        lines.push(`    observable-create ${base} : ${t}`);
        break;
      case 'subscribe':
        lines.push(`    subscribe ${base} : ${t}`);
        break;
      case 'next':
        lines.push(`    next ${JSON.stringify(e.value)} ${base} : ${t}`);
        break;
      case 'error':
        lines.push(`    error ${String(e.error)} ${base} : ${t}`);
        break;
      case 'complete':
        lines.push(`    complete ${base} : ${t}`);
        break;
      case 'unsubscribe':
        lines.push(`    unsubscribe ${base} : ${t}`);
        break;
    }
  }

  lines.push('```');
  return lines.join('\n');
}

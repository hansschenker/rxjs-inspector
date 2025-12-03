// src/visualization/marbleDiagram.ts
import { NotificationEvent } from '../instrumentation/types.js';

/** Characters per second for marble diagram scaling */
const DEFAULT_SCALE = 50;

export function eventsToMarbleDiagram(
  events: NotificationEvent[],
  observableId: number,
  scale = DEFAULT_SCALE,
): string {
  const obsEvents = events.filter((e) => e.observableId === observableId);
  if (!obsEvents.length) return '';

  const start = obsEvents[0].timestamp;
  const end = obsEvents[obsEvents.length - 1].timestamp;
  const durationMs = Math.max(1, end - start);

  const length = Math.ceil((durationMs * scale) / 1000);
  const chars: string[] = new Array(length).fill('-');

  for (const evt of obsEvents) {
    const pos = Math.min(
      length - 1,
      Math.floor(((evt.timestamp - start) * scale) / 1000),
    );

    if (evt.type === 'next') {
      const value = (evt as any).value;
      chars[pos] = String(value).charAt(0);
    } else if (evt.type === 'complete') {
      chars[pos] = '|';
    } else if (evt.type === 'error') {
      chars[pos] = 'X';
    }
  }

  return chars.join('');
}

// Example:
// source:  --1--2--3--4--5--|
// map:     --a--b--c--d--e--|
// filter:  -----b--c--d--e--|

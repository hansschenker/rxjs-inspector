import { NotificationEvent } from '../instrumentation/types.js';
import { OperatorInfo } from '../instrumentation/types.js';

// Helper to read a label/name from operator info if present
export function formatOperatorLabel(info?: OperatorInfo): string | undefined {
  return info?.name;
}

/**
 * Filter events to only include those with observableId <= maxId.
 */
export function filterByMaxObservableId(
  events: NotificationEvent[],
  maxId: number,
): NotificationEvent[] {
  return events.filter((e) => e.observableId <= maxId);
}

/**
 * Filter events by a specific subscription ID.
 */
export function filterBySubscriptionId(
  events: NotificationEvent[],
  subscriptionId: number,
): NotificationEvent[] {
  return events.filter(
    (e) => 'subscriptionId' in e && e.subscriptionId === subscriptionId,
  );
}

/**
 * Filter events by a specific observable ID.
 */
export function filterByObservableId(
  events: NotificationEvent[],
  observableId: number,
): NotificationEvent[] {
  return events.filter((e) => e.observableId === observableId);
}

/**
 * Filter events by time range.
 */
export function filterByTimeRange(
  events: NotificationEvent[],
  start: number,
  end: number,
): NotificationEvent[] {
  return events.filter((e) => e.timestamp >= start && e.timestamp <= end);
}

import { NotificationEvent } from '../instrumentation/types.js';

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

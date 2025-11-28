import { NotificationEvent } from '../instrumentation/types';

export function filterBySubscriptionId(
  events: NotificationEvent[],
  subscriptionId: number,
): NotificationEvent[] {
  return events.filter(e => e.subscriptionId === subscriptionId);
}

export function filterByObservableId(
  events: NotificationEvent[],
  observableId: number,
): NotificationEvent[] {
  return events.filter(e => e.observableId === observableId);
}

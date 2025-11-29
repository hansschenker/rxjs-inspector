export type NotificationType =
  | 'observable-create'
  | 'subscribe'
  | 'next'
  | 'error'
  | 'complete'
  | 'unsubscribe';

export interface NotificationEvent {
  type: NotificationType;
  timestamp: number;

  observableId: number;
  subscriptionId?: number;

  value?: unknown;
  error?: unknown;
  info?: string;
}

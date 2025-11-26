import { Observable, Subscription, Subject, PartialObserver } from 'rxjs';

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

export const notificationSubject = new Subject<NotificationEvent>();
export const notifications$ = notificationSubject.asObservable();

let nextObservableId = 1;
let nextSubscriptionId = 1;

const OBS_ID = Symbol('rxjsInspectorObservableId');
const SUB_ID = Symbol('rxjsInspectorSubscriptionId');

const now = () => Date.now();

function getObservableId(obs: any): number {
  if (!obs[OBS_ID]) {
    obs[OBS_ID] = nextObservableId++;
    notificationSubject.next({
      type: 'observable-create',
      timestamp: now(),
      observableId: obs[OBS_ID],
      info: obs.constructor?.name ?? 'Observable',
    });
  }
  return obs[OBS_ID];
}

function toObserver<T>(
  observerOrNext?: PartialObserver<T> | ((value: T) => void),
  error?: (err: any) => void,
  complete?: () => void,
): PartialObserver<T> {
  if (typeof observerOrNext === 'function') {
    return { next: observerOrNext, error, complete };
  }
  if (observerOrNext) {
    return observerOrNext;
  }
  return { next: () => {}, error, complete };
}

export function installRxjsInstrumentation(): void {
  const proto = Observable.prototype as any;
  if (proto.__rxjsInspectorInstalled) return;
  proto.__rxjsInspectorInstalled = true;

  const originalSubscribe = proto.subscribe as Observable<any>['subscribe'];

  proto.subscribe = function <T>(
    this: Observable<T>,
    observerOrNext?: PartialObserver<T> | ((value: T) => void),
    error?: (err: any) => void,
    complete?: () => void,
  ): Subscription {
    const observableId = getObservableId(this);
    const subscriptionId = nextSubscriptionId++;

    notificationSubject.next({
      type: 'subscribe',
      timestamp: now(),
      observableId,
      subscriptionId,
    });

    const downstream = toObserver<T>(observerOrNext, error, complete);

    const wrappedObserver: PartialObserver<T> = {
      next: (value: T) => {
        notificationSubject.next({
          type: 'next',
          timestamp: now(),
          observableId,
          subscriptionId,
          value,
        });
        downstream.next?.(value);
      },
      error: (err: any) => {
        notificationSubject.next({
          type: 'error',
          timestamp: now(),
          observableId,
          subscriptionId,
          error: err,
        });
        downstream.error?.(err);
      },
      complete: () => {
        notificationSubject.next({
          type: 'complete',
          timestamp: now(),
          observableId,
          subscriptionId,
        });
        downstream.complete?.();
      },
    };

    const subscription = originalSubscribe.call(this, wrappedObserver) as Subscription;

    (subscription as any)[SUB_ID] = subscriptionId;
    const originalUnsubscribe = subscription.unsubscribe;

    subscription.unsubscribe = function (this: Subscription): void {
      notificationSubject.next({
        type: 'unsubscribe',
        timestamp: now(),
        observableId,
        subscriptionId,
      });
      return originalUnsubscribe.apply(this);
    };

    return subscription;
  };
}

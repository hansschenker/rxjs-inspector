## Getting Started

Rxjs-Inspector instruments `Observable.prototype.subscribe`, emits structured
`NotificationEvent`s for every subscribe/next/error/complete/unsubscribe, and
(optionally) logs them as NDJSON.

### 1. Install the instrumentation

In `instrumentation/core.ts`:

```ts
import { Observable, Subject, Subscription, PartialObserver } from 'rxjs';

const INTERNAL_FLAG = '__rxjsInspectorInternalObservable';
const SUB_ID = Symbol('rxjsInspectorSubscriptionId');

export type NotificationEvent =
  | { type: 'subscribe'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'next'; timestamp: number; observableId: number; subscriptionId: number; value: unknown }
  | { type: 'error'; timestamp: number; observableId: number; subscriptionId: number; error: any }
  | { type: 'complete'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'unsubscribe'; timestamp: number; observableId: number; subscriptionId: number };

const notificationSubject = new Subject<NotificationEvent>();
(notificationSubject as any)[INTERNAL_FLAG] = true;

export const notifications$ = notificationSubject as Observable<NotificationEvent>;

let nextObservableId = 1;
let nextSubscriptionId = 1;

function now(): number {
  return Date.now();
}

function getObservableId(obs: any): number {
  if (!obs.__rxjsInspectorId) {
    obs.__rxjsInspectorId = nextObservableId++;
  }
  return obs.__rxjsInspectorId;
}

function toObserver<T>(
  observerOrNext?: PartialObserver<T> | ((value: T) => void),
  error?: (err: any) => void,
  complete?: () => void,
): PartialObserver<T> {
  if (typeof observerOrNext === 'function') {
    return {
      next: observerOrNext,
      error,
      complete,
    };
  }
  return (observerOrNext ?? {}) as PartialObserver<T>;
}

export function installRxjsInstrumentation(): void {
  const proto = Observable.prototype as any;
  if (proto.__rxjsInspectorInstalled) return;
  proto.__rxjsInspectorInstalled = true;

  const originalSubscribe: Observable<unknown>['subscribe'] = proto.subscribe;

  proto.subscribe = function <T>(
    this: Observable<T>,
    observerOrNext?: PartialObserver<T> | ((value: T) => void),
    error?: (err: any) => void,
    complete?: () => void,
  ): Subscription {
    const self: any = this;

    // Skip internal inspector streams to avoid recursion and OOM
    if (self[INTERNAL_FLAG]) {
      return originalSubscribe.call(this, observerOrNext as any, error, complete) as Subscription;
    }

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

    const subscription = originalSubscribe.call(this, wrappedObserver as any) as Subscription;

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

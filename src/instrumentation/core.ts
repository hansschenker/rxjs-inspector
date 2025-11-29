// instrumentation/core.ts

import { Observable, Subject, Subscription } from 'rxjs';
import type { PartialObserver } from 'rxjs';

// One run id per process / script execution
const RUN_ID = Date.now();

const INTERNAL_FLAG = '__rxjsInspectorInternalObservable';
const SUB_ID = Symbol('rxjsInspectorSubscriptionId');

// ─────────────────────────────────────────────────────────────
// Event types
// ─────────────────────────────────────────────────────────────

export type NotificationCommon = {
  runId: number;
  timestamp: number;
  observableId: number;
  subscriptionId: number;
};

export type NotificationEvent =
  | (NotificationCommon & { type: 'subscribe' })
  | (NotificationCommon & { type: 'next'; value: unknown })
  | (NotificationCommon & { type: 'error'; error: any })
  | (NotificationCommon & { type: 'complete' })
  | (NotificationCommon & { type: 'unsubscribe' });

// ─────────────────────────────────────────────────────────────
// Telemetry bus
// ─────────────────────────────────────────────────────────────

const notificationSubject = new Subject<NotificationEvent>();

// Mark this observable as "internal" so we don't instrument it
(notificationSubject as any)[INTERNAL_FLAG] = true;

// Export as Observable so consumers can't next() into it directly
export const notifications$ = notificationSubject as Observable<NotificationEvent>;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

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

  // Empty object is a perfectly valid "do nothing" observer
  return (observerOrNext ?? {}) as PartialObserver<T>;
}

// ─────────────────────────────────────────────────────────────
// Main instrumentation hook
// ─────────────────────────────────────────────────────────────

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

    // 🔒 Skip internal inspector observables to avoid recursion / OOM
    if (self[INTERNAL_FLAG]) {
      return originalSubscribe.call(this, observerOrNext as any, error, complete) as Subscription;
    }

    const observableId = getObservableId(this);
    const subscriptionId = nextSubscriptionId++;

    // subscribe event
    notificationSubject.next({
      type: 'subscribe',
      runId: RUN_ID,
      timestamp: now(),
      observableId,
      subscriptionId,
    });

    const downstream = toObserver<T>(observerOrNext, error, complete);

    const wrappedObserver: PartialObserver<T> = {
      next: (value: T) => {
        notificationSubject.next({
          type: 'next',
          runId: RUN_ID,
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
          runId: RUN_ID,
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
          runId: RUN_ID,
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
        runId: RUN_ID,
        timestamp: now(),
        observableId,
        subscriptionId,
      });
      return originalUnsubscribe.apply(this);
    };

    return subscription;
  };
}

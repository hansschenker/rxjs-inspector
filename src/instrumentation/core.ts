

// instrumentation/core.ts
import { Observable, Subject, Subscription, PartialObserver } from 'rxjs';
// import your NotificationEvent type etc.

const INTERNAL_FLAG = '__rxjsInspectorInternalObservable';
const SUB_ID = Symbol('rxjsInspectorSubscriptionId');

export type NotificationEvent =
  | { type: 'subscribe'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'next'; timestamp: number; observableId: number; subscriptionId: number; value: unknown }
  | { type: 'error'; timestamp: number; observableId: number; subscriptionId: number; error: any }
  | { type: 'complete'; timestamp: number; observableId: number; subscriptionId: number }
  | { type: 'unsubscribe'; timestamp: number; observableId: number; subscriptionId: number };

// ---- internal telemetry bus ----
const notificationSubject = new Subject<NotificationEvent>();
(notificationSubject as any)[INTERNAL_FLAG] = true;

// Export as Observable so others can listen:
export const notifications$ = notificationSubject as Observable<NotificationEvent>;

// your existing helpers:
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
  return observerOrNext || {} as PartialObserver<T>;
}

// ---- main instrumentation hook ----
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

    // 🔒 Skip internal inspector observables to avoid recursion
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















// previously existing code: ---------
// import { Observable, Subscription, Subject, PartialObserver } from 'rxjs';



// export type NotificationType =
//   | 'observable-create'
//   | 'subscribe'
//   | 'next'
//   | 'error'
//   | 'complete'
//   | 'unsubscribe';

// export interface NotificationEvent {
//   type: NotificationType;
//   timestamp: number;

//   observableId: number;
//   subscriptionId?: number;

//   value?: unknown;
//   error?: unknown;
//   info?: string;
// }

// export const notificationSubject = new Subject<NotificationEvent>();
// export const notifications$ = notificationSubject.asObservable();

// let nextObservableId = 1;
// let nextSubscriptionId = 1;

// const OBS_ID = Symbol('rxjsInspectorObservableId');
// const SUB_ID = Symbol('rxjsInspectorSubscriptionId');

// const now = () => Date.now();

// function getObservableId(obs: any): number {
//   if (!obs[OBS_ID]) {
//     obs[OBS_ID] = nextObservableId++;
//     notificationSubject.next({
//       type: 'observable-create',
//       timestamp: now(),
//       observableId: obs[OBS_ID],
//       info: obs.constructor?.name ?? 'Observable',
//     });
//   }
//   return obs[OBS_ID];
// }

// function toObserver<T>(
//   observerOrNext?: PartialObserver<T> | ((value: T) => void),
//   error?: (err: any) => void,
//   complete?: () => void,
// ): PartialObserver<T> {
//   if (typeof observerOrNext === 'function') {
//     return { next: observerOrNext, error, complete };
//   }
//   if (observerOrNext) {
//     return observerOrNext;
//   }
//   return { next: () => {}, error, complete };
// }

// // export function installRxjsInstrumentation(): void {
// //   const proto = Observable.prototype as any;
// //   if (proto.__rxjsInspectorInstalled) return;
// //   proto.__rxjsInspectorInstalled = true;

// //   const originalSubscribe: Observable<unknown>['subscribe'] = proto.subscribe;

// //   proto.subscribe = function <T>(
// //     this: Observable<T>,
// //     observerOrNext?: PartialObserver<T> | ((value: T) => void),
// //     error?: (err: any) => void,
// //     complete?: () => void,
// //   ): Subscription {
// //     const observableId = getObservableId(this);
// //     const subscriptionId = nextSubscriptionId++;

// //     notificationSubject.next({
// //       type: 'subscribe',
// //       timestamp: now(),
// //       observableId,
// //       subscriptionId,
// //     });

// //     const downstream = toObserver<T>(observerOrNext, error, complete);

// //     const wrappedObserver: PartialObserver<T> = {
// //       next: (value: T) => {
// //         notificationSubject.next({
// //           type: 'next',
// //           timestamp: now(),
// //           observableId,
// //           subscriptionId,
// //           value,
// //         });
// //         downstream.next?.(value);
// //       },
// //       error: (err: any) => {
// //         notificationSubject.next({
// //           type: 'error',
// //           timestamp: now(),
// //           observableId,
// //           subscriptionId,
// //           error: err,
// //         });
// //         downstream.error?.(err);
// //       },
// //       complete: () => {
// //         notificationSubject.next({
// //           type: 'complete',
// //           timestamp: now(),
// //           observableId,
// //           subscriptionId,
// //         });
// //         downstream.complete?.();
// //       },
// //     };

// //     // The one small “escape hatch” for TS:
// //     const subscription = originalSubscribe.call(this, wrappedObserver as any) as Subscription;

// //     (subscription as any)[SUB_ID] = subscriptionId;
// //     const originalUnsubscribe = subscription.unsubscribe;

// //     subscription.unsubscribe = function (this: Subscription): void {
// //       notificationSubject.next({
// //         type: 'unsubscribe',
// //         timestamp: now(),
// //         observableId,
// //         subscriptionId,
// //       });
// //       return originalUnsubscribe.apply(this);
// //     };

// //     return subscription;
// //   };
// // }

// export function installRxjsInstrumentation(): void {
//   const proto = Observable.prototype as any;
//   if (proto.__rxjsInspectorInstalled) return;
//   proto.__rxjsInspectorInstalled = true;

//   const originalSubscribe: Observable<unknown>['subscribe'] = proto.subscribe;

//   proto.subscribe = function <T>(
//     this: Observable<T>,
//     observerOrNext?: PartialObserver<T> | ((value: T) => void),
//     error?: (err: any) => void,
//     complete?: () => void,
//   ): Subscription {
//     // No logging at all – just call through
//     return originalSubscribe.call(this, observerOrNext as any, error, complete) as Subscription;
//   };
// }

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifications$ = exports.notificationSubject = void 0;
exports.installRxjsInstrumentation = installRxjsInstrumentation;
const rxjs_1 = require("rxjs");
exports.notificationSubject = new rxjs_1.Subject();
exports.notifications$ = exports.notificationSubject.asObservable();
let nextObservableId = 1;
let nextSubscriptionId = 1;
const OBS_ID = Symbol('rxjsInspectorObservableId');
const SUB_ID = Symbol('rxjsInspectorSubscriptionId');
const now = () => Date.now();
function getObservableId(obs) {
    var _a, _b;
    if (!obs[OBS_ID]) {
        obs[OBS_ID] = nextObservableId++;
        exports.notificationSubject.next({
            type: 'observable-create',
            timestamp: now(),
            observableId: obs[OBS_ID],
            info: (_b = (_a = obs.constructor) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : 'Observable',
        });
    }
    return obs[OBS_ID];
}
function toObserver(observerOrNext, error, complete) {
    if (typeof observerOrNext === 'function') {
        return { next: observerOrNext, error, complete };
    }
    if (observerOrNext) {
        return observerOrNext;
    }
    return { next: () => { }, error, complete };
}
function installRxjsInstrumentation() {
    const proto = rxjs_1.Observable.prototype;
    if (proto.__rxjsInspectorInstalled)
        return;
    proto.__rxjsInspectorInstalled = true;
    const originalSubscribe = proto.subscribe;
    proto.subscribe = function (observerOrNext, error, complete) {
        const observableId = getObservableId(this);
        const subscriptionId = nextSubscriptionId++;
        exports.notificationSubject.next({
            type: 'subscribe',
            timestamp: now(),
            observableId,
            subscriptionId,
        });
        const downstream = toObserver(observerOrNext, error, complete);
        const wrappedObserver = {
            next: (value) => {
                var _a;
                exports.notificationSubject.next({
                    type: 'next',
                    timestamp: now(),
                    observableId,
                    subscriptionId,
                    value,
                });
                (_a = downstream.next) === null || _a === void 0 ? void 0 : _a.call(downstream, value);
            },
            error: (err) => {
                var _a;
                exports.notificationSubject.next({
                    type: 'error',
                    timestamp: now(),
                    observableId,
                    subscriptionId,
                    error: err,
                });
                (_a = downstream.error) === null || _a === void 0 ? void 0 : _a.call(downstream, err);
            },
            complete: () => {
                var _a;
                exports.notificationSubject.next({
                    type: 'complete',
                    timestamp: now(),
                    observableId,
                    subscriptionId,
                });
                (_a = downstream.complete) === null || _a === void 0 ? void 0 : _a.call(downstream);
            },
        };
        const subscription = originalSubscribe.call(this, wrappedObserver);
        subscription[SUB_ID] = subscriptionId;
        const originalUnsubscribe = subscription.unsubscribe;
        subscription.unsubscribe = function () {
            exports.notificationSubject.next({
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
// export function installRxjsInstrumentation(): void {
//   const proto = Observable.prototype as any;
//   if (proto.__rxjsInspectorInstalled) return;
//   proto.__rxjsInspectorInstalled = true;
//   const originalSubscribe = proto.subscribe as Observable<any>['subscribe'];
//   proto.subscribe = function <T>(
//     this: Observable<T>,
//     observerOrNext?: PartialObserver<T> | ((value: T) => void),
//     error?: (err: any) => void,
//     complete?: () => void,
//   ): Subscription {
//     const observableId = getObservableId(this);
//     const subscriptionId = nextSubscriptionId++;
//     notificationSubject.next({
//       type: 'subscribe',
//       timestamp: now(),
//       observableId,
//       subscriptionId,
//     });
//     const downstream = toObserver<T>(observerOrNext, error, complete);
//     const wrappedObserver: PartialObserver<T> = {
//       next: (value: T) => {
//         notificationSubject.next({
//           type: 'next',
//           timestamp: now(),
//           observableId,
//           subscriptionId,
//           value,
//         });
//         downstream.next?.(value);
//       },
//       error: (err: any) => {
//         notificationSubject.next({
//           type: 'error',
//           timestamp: now(),
//           observableId,
//           subscriptionId,
//           error: err,
//         });
//         downstream.error?.(err);
//       },
//       complete: () => {
//         notificationSubject.next({
//           type: 'complete',
//           timestamp: now(),
//           observableId,
//           subscriptionId,
//         });
//         downstream.complete?.();
//       },
//     };
//     const subscription = originalSubscribe.call(this, wrappedObserver) as Subscription;
//     (subscription as any)[SUB_ID] = subscriptionId;
//     const originalUnsubscribe = subscription.unsubscribe;
//     subscription.unsubscribe = function (this: Subscription): void {
//       notificationSubject.next({
//         type: 'unsubscribe',
//         timestamp: now(),
//         observableId,
//         subscriptionId,
//       });
//       return originalUnsubscribe.apply(this);
//     };
//     return subscription;
//   };
// }

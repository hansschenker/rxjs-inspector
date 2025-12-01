// src/instrumentation/core.ts
import { Observable, Subscription } from 'rxjs';
import { Subject } from 'rxjs';
import {
  defaultInstrumentationConfig,
  InstrumentationConfig,
  NotificationEvent,
  OperatorInfo,
} from './types';

type AnyObservable = Observable<unknown> & {
  __rxjsInspectorId?: number;
  source?: AnyObservable;
  operator?: { constructor?: { name?: string } };
  __rxjsInspectorInstalled?: boolean;
  __rxjsInspectorOriginalSubscribe?: Observable<unknown>['subscribe'];
};

const notificationSubject = new Subject<NotificationEvent>();
export const notifications$ = notificationSubject.asObservable();

let config: InstrumentationConfig = defaultInstrumentationConfig;

export function configureInstrumentation(
  opts: Partial<InstrumentationConfig>,
): void {
  config = { ...config, ...opts };
}

let nextObservableId = 1;
let nextSubscriptionId = 1;

const now = () => Date.now();

function emitEvent(event: NotificationEvent): void {
  if (!config.enabled) return;
  notificationSubject.next(event);
}

// ---- Operator / observable tracking ----

function extractOperatorInfo(obs: AnyObservable): OperatorInfo {
  const name =
    obs.operator?.constructor?.name ||
    // fallback to constructor name of the observable itself
    (obs as any).constructor?.name ||
    'Unknown';

  const parent = obs.source?.__rxjsInspectorId;

  let stackTrace: string | undefined;
  try {
    stackTrace = new Error().stack;
  } catch {
    // ignore
  }

  return { name, parent, stackTrace };
}

function getObservableId(obs: AnyObservable): number {
  if (!obs.__rxjsInspectorId) {
    obs.__rxjsInspectorId = nextObservableId++;

    const operatorInfo = extractOperatorInfo(obs);

    emitEvent({
      type: 'observable-create',
      timestamp: now(),
      observableId: obs.__rxjsInspectorId,
      operatorInfo,
    });
  }
  return obs.__rxjsInspectorId;
}

// ---- Install / uninstall instrumentation ----

export function installRxjsInstrumentation(): void {
  const proto = Observable.prototype as AnyObservable;

  if ((proto as any).__rxjsInspectorInstalled) {
    return;
  }

  const originalSubscribe = proto.subscribe;
  (proto as any).__rxjsInspectorOriginalSubscribe = originalSubscribe;
  (proto as any).__rxjsInspectorInstalled = true;

  proto.subscribe = function patchedSubscribe(
    this: AnyObservable,
    observerOrNext?: any,
    error?: (err: any) => void,
    complete?: () => void,
  ): Subscription {
    const observableId = getObservableId(this);
    const subscriptionId = nextSubscriptionId++;

    emitEvent({
      type: 'subscribe',
      timestamp: now(),
      observableId,
      subscriptionId,
    });

    // Normalize args → observer object
    const userObserver =
      typeof observerOrNext === 'function'
        ? {
            next: observerOrNext,
            error,
            complete,
          }
        : observerOrNext || {};

    const wrappedObserver = {
      next: (value: unknown) => {
        if (config.enabled && Math.random() <= (config.sampleRate ?? 1)) {
          emitEvent({
            type: 'next',
            timestamp: now(),
            observableId,
            subscriptionId,
            value: config.excludeValues ? '<redacted>' : value,
          });
        }
        userObserver.next?.(value);
      },
      error: (err: unknown) => {
        emitEvent({
          type: 'error',
          timestamp: now(),
          observableId,
          subscriptionId,
          error: err,
        });
        userObserver.error?.(err);
      },
      complete: () => {
        emitEvent({
          type: 'complete',
          timestamp: now(),
          observableId,
          subscriptionId,
        });
        userObserver.complete?.();
      },
    };

    const subscription = originalSubscribe.call(this, wrappedObserver);

    const originalUnsubscribe = subscription.unsubscribe.bind(subscription);

    subscription.unsubscribe = function patchedUnsubscribe() {
      emitEvent({
        type: 'unsubscribe',
        timestamp: now(),
        observableId,
        subscriptionId,
      });
      return originalUnsubscribe();
    };

    return subscription;
  } as any;
}

export function uninstallRxjsInstrumentation(): void {
  const proto = Observable.prototype as AnyObservable;
  if (!proto.__rxjsInspectorInstalled) return;

  if (proto.__rxjsInspectorOriginalSubscribe) {
    proto.subscribe = proto.__rxjsInspectorOriginalSubscribe;
  }

  delete proto.__rxjsInspectorOriginalSubscribe;
  delete proto.__rxjsInspectorInstalled;

  notificationSubject.complete();
}

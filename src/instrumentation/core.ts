// src/instrumentation/core.ts
import { Observable, Subscription } from 'rxjs';
import { Subject } from 'rxjs';
import {
  defaultInstrumentationConfig,
  InstrumentationConfig,
  NotificationEvent,
  OperatorInfo,
} from './types.js';

type AnyObservable = Observable<unknown> & {
  __rxjsInspectorId?: number;
  source?: AnyObservable;
  operator?: { constructor?: { name?: string } };
  __rxjsInspectorInstalled?: boolean;
  __rxjsInspectorOriginalSubscribe?: Observable<unknown>['subscribe'];
};
export const INTERNAL_FLAG = Symbol('__rxjsInspectorInternal');
let config: InstrumentationConfig = defaultInstrumentationConfig;

let notificationSubject = new Subject<NotificationEvent>();
export const notifications$ = notificationSubject.asObservable().pipe(
  // Mark as internal to prevent instrumentation
) as any;
(notifications$ as any)[INTERNAL_FLAG] = true;

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

// ---- Helper: Check if observable is internal ----

/**
 * Checks if an observable or any of its sources are marked as internal.
 * Internal observables (like notifications$) should not be instrumented
 * to prevent infinite recursion.
 */
function isInternalObservable(obs: AnyObservable): boolean {
  let current: AnyObservable | undefined = obs;
  while (current) {
    if ((current as any)[INTERNAL_FLAG]) {
      return true;
    }
    current = current.source;
  }
  return false;
}

// ---- Operator / observable tracking ----

function extractOperatorInfo(obs: AnyObservable): OperatorInfo {
  // NOTE: RxJS v7+ uses anonymous functions for operators, so we must rely on stack traces
  // The rxjs-spy technique (prototype inspection) only works for RxJS v5/v6 class-based operators

  // Priority 0: Check for manual tag
  const tag = (obs as any).__rxjsInspectorTag;
  if (tag) {
    return { name: tag, parent: obs.source?.__rxjsInspectorId, stackTrace: undefined };
  }

  let name = (obs as any).constructor?.name || 'Observable';
  const parent = obs.source?.__rxjsInspectorId;

  let stackTrace: string | undefined;
  try {
    stackTrace = new Error().stack;

    if (stackTrace) {
      const lines = stackTrace.split('\n');

      // Priority 1: Look for RxJS operators (map, filter, etc.)
      for (const line of lines) {
        const opMatch = line.match(/rxjs[\\/](?:dist[\\/](?:cjs|esm)[\\/])?internal[\\/]operators[\\/](\w+)\.(?:js|ts)/);
        if (opMatch) {
          name = opMatch[1];
          return { name, parent, stackTrace };
        }
      }

      // Priority 2: Look for RxJS source observables (from, of, interval, etc.)
      for (const line of lines) {
        const srcMatch = line.match(/rxjs[\\/](?:dist[\\/](?:cjs|esm)[\\/])?internal[\\/]observable[\\/](\w+)\.(?:js|ts)/);
        if (srcMatch) {
          name = srcMatch[1];
          return { name, parent, stackTrace };
        }
      }

      // Priority 3: Check if this is a piped observable (has source but no operator match)
      if ((obs as any).source && name === 'Observable') {
        name = 'pipe';
        return { name, parent, stackTrace };
      }

      // Priority 4: Look for custom operators in user code
      for (const line of lines) {
        if (line.includes('instrumentation/core.ts')) continue;
        if (line.includes('node_modules')) continue;

        const funcMatch = line.match(/at (\w+)/);
        if (funcMatch) {
          const funcName = funcMatch[1];
          const ignored = ['Object', 'Module', 'Function', 'Observable', 'Subscriber', 'SafeSubscriber'];
          if (!ignored.includes(funcName)) {
            name = funcName;
            return { name, parent, stackTrace };
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return { name, parent, stackTrace };
}

function getObservableId(obs: AnyObservable): number {
  if (!obs.__rxjsInspectorId) {
    obs.__rxjsInspectorId = nextObservableId++;

    // Ensure the source observable has an ID first (if it exists)
    if (obs.source && !obs.source.__rxjsInspectorId) {
      getObservableId(obs.source);
    }

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
    // Skip instrumentation for internal observables to prevent infinite recursion
    if (isInternalObservable(this)) {
      return originalSubscribe.call(this, observerOrNext, error, complete);
    }

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

    const subscription = originalSubscribe.call(this, wrappedObserver as any);

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
  };
}


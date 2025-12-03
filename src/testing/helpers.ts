// src/testing/helpers.ts
import { Observable, Subscription } from 'rxjs';
import { NotificationEvent } from '../instrumentation/types.js';
import { notifications$ } from '../instrumentation/core.js';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Record all notification events emitted while subscribing to an observable.
 * @param observable - The observable to subscribe to
 * @param timeoutMs - Maximum time to wait for completion (default: 5000ms)
 * @returns Promise resolving to array of captured events
 */
export function recordEvents<T>(
  observable: Observable<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NotificationEvent[]> {
  return new Promise<NotificationEvent[]>((resolve, reject) => {
    const events: NotificationEvent[] = [];
    let notificationsSub: Subscription | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      notificationsSub?.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };

    notificationsSub = notifications$.subscribe((e) => {
      events.push(e);
    });

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`recordEvents timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    observable.subscribe({
      complete: () => {
        cleanup();
        resolve(events);
      },
      error: (err) => {
        cleanup();
        // Still resolve with events, but include the error info
        resolve(events);
      },
    });
  });
}

/**
 * Record events for a specified duration, useful for infinite observables.
 * @param observable - The observable to subscribe to
 * @param durationMs - How long to record events
 * @returns Promise resolving to array of captured events
 */
export function recordEventsFor<T>(
  observable: Observable<T>,
  durationMs: number,
): Promise<NotificationEvent[]> {
  return new Promise<NotificationEvent[]>((resolve) => {
    const events: NotificationEvent[] = [];

    const notificationsSub = notifications$.subscribe((e) => {
      events.push(e);
    });

    const subscription = observable.subscribe();

    setTimeout(() => {
      subscription.unsubscribe();
      notificationsSub.unsubscribe();
      resolve(events);
    }, durationMs);
  });
}

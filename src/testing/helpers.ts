// src/testing/helpers.ts
import { Observable } from 'rxjs';
import { NotificationEvent } from '../instrumentation/types';
import { notifications$ } from '../instrumentation/core';

export function recordEvents<T>(
  observable: Observable<T>,
): Promise<NotificationEvent[]> {
  return new Promise<NotificationEvent[]>((resolve) => {
    const events: NotificationEvent[] = [];

    const notificationsSub = notifications$.subscribe((e) => {
      events.push(e);
    });

    observable.subscribe({
      complete: () => {
        notificationsSub.unsubscribe();
        resolve(events);
      },
      error: () => {
        notificationsSub.unsubscribe();
        resolve(events);
      },
    });
  });
}

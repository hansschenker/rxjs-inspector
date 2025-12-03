// test/recursion-prevention.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { of, map, filter, take } from 'rxjs';
import {
  installRxjsInstrumentation,
  uninstallRxjsInstrumentation,
  notifications$,
} from '../instrumentation/core';
import { NotificationEvent } from '../instrumentation/types';

describe('Recursion prevention', () => {
  beforeEach(() => {
    installRxjsInstrumentation();
  });

  afterEach(() => {
    uninstallRxjsInstrumentation();
  });

  it('should not create infinite loop when subscribing to notifications$', (done) => {
    const events: NotificationEvent[] = [];

    // Subscribe to notifications and use RxJS operators
    // This would cause infinite recursion without proper prevention
    notifications$
      .pipe(
        filter((e) => e.type === 'next'),
        map((e) => e.observableId),
        take(10) // Safety limit
      )
      .subscribe((obsId) => {
        events.push({ type: 'next', timestamp: Date.now(), observableId: obsId, subscriptionId: 0, value: obsId });
      });

    // Create a simple observable that emits values
    of(1, 2, 3).subscribe();

    // Wait a bit to ensure no runaway recursion
    setTimeout(() => {
      // Should have captured only the user observable events, not internal ones
      expect(events.length).toBeLessThan(10);
      expect(events.length).toBeGreaterThan(0);
      done();
    }, 100);
  });

  it('should still track user observables normally', () => {
    const events: NotificationEvent[] = [];

    notifications$.subscribe((e) => events.push(e));

    of(1, 2, 3)
      .pipe(map((x) => x * 2))
      .subscribe();

    // Should have observable-create, subscribe, next, and complete events
    const subscribeEvents = events.filter((e) => e.type === 'subscribe');
    const nextEvents = events.filter((e) => e.type === 'next');

    expect(subscribeEvents.length).toBeGreaterThan(0);
    // Map operator creates its own observable, so we get events from both 'of' and 'map' observables
    // Each emits 3 values, so we get 6 next events total
    expect(nextEvents.length).toBe(6);
  });

  it('should allow reinstallation after uninstall', () => {
    const events1: NotificationEvent[] = [];

    // First installation
    notifications$.subscribe((e) => events1.push(e));
    of(1).subscribe();

    expect(events1.length).toBeGreaterThan(0);

    // Uninstall
    uninstallRxjsInstrumentation();

    // Reinstall
    installRxjsInstrumentation();

    const events2: NotificationEvent[] = [];
    notifications$.subscribe((e) => events2.push(e));
    of(2).subscribe();

    expect(events2.length).toBeGreaterThan(0);
  });

  it('should not instrument notifications$ itself', () => {
    const events: NotificationEvent[] = [];

    // Subscribe to notifications
    notifications$.subscribe((e) => events.push(e));

    // Now subscribe to notifications$ again
    // This should NOT create observable-create events for notifications$
    notifications$.pipe(take(1)).subscribe();

    // Create a user observable
    of(1).subscribe();

    // Filter for observable-create events
    const createEvents = events.filter((e) => e.type === 'observable-create');

    // Should only have observable-create events for user observables (of, take operator)
    // NOT for notifications$ itself
    expect(createEvents.length).toBeGreaterThan(0);

    // None of the created observables should be from the notifications$ chain
    // (This is a basic check - in reality we'd need to inspect operatorInfo names)
    const hasNotificationSubject = createEvents.some(
      (e) => e.type === 'observable-create' && e.operatorInfo?.name === 'Subject'
    );
    expect(hasNotificationSubject).toBe(false);
  });

  it('should handle complex operator chains on notifications$', () => {
    const events: NotificationEvent[] = [];

    // Complex chain on notifications$
    notifications$
      .pipe(
        filter((e) => e.type === 'next'),
        map((e) => e.observableId),
        filter((id) => id > 0)
      )
      .subscribe((id) => {
        events.push({ type: 'next', timestamp: Date.now(), observableId: id, subscriptionId: 0, value: id });
      });

    // Create user observables
    of(1, 2, 3).subscribe();

    // Should work without stack overflow
    expect(events.length).toBeLessThan(20); // Reasonable upper bound
    expect(events.length).toBeGreaterThan(0);
  });
});

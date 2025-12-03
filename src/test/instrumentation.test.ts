// test/instrumentation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { of, map } from 'rxjs';
import { NotificationEvent } from '../instrumentation/types.js';
import {
  installRxjsInstrumentation,
  uninstallRxjsInstrumentation,
<<<<<<< HEAD
} from '../instrumentation/core.js';
import { recordEvents } from '../testing/helpers.js';
=======
} from '../instrumentation/core';
import { recordEvents } from '../testing/helpers';
>>>>>>> 8406626071ed9079fd7929fa722f5030261bec8f

describe('Rxjs instrumentation', () => {
  beforeAll(() => {
    installRxjsInstrumentation();
  });

  afterAll(() => {
    uninstallRxjsInstrumentation();
  });

  it('captures next events for a simple map chain', async () => {
    const events = await recordEvents(
      of(1, 2, 3).pipe(map((x: number) => x * 2)),
    );

<<<<<<< HEAD
    const nextEvents = events.filter((e: NotificationEvent) => e.type === 'next');
    expect(nextEvents).toHaveLength(3);
=======
    const nextEvents = events.filter((e) => e.type === 'next');
    // Map operator creates its own observable, so we capture events from both 'of' and 'map'
    // Each emits 3 values: of(1,2,3) emits 3 times, map also emits 3 times = 6 total
    expect(nextEvents).toHaveLength(6);
>>>>>>> 8406626071ed9079fd7929fa722f5030261bec8f

    // Optional sanity check: operator-create events exist
    const creates = events.filter((e: NotificationEvent) => e.type === 'observable-create');
    expect(creates.length).toBeGreaterThan(0);
  });
});

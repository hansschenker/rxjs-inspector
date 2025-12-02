// test/instrumentation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { of, map } from 'rxjs';
import {
  installRxjsInstrumentation,
  uninstallRxjsInstrumentation,
} from '../instrumentation/core';
import { recordEvents } from '../testing/helpers';

describe('Rxjs instrumentation', () => {
  beforeAll(() => {
    installRxjsInstrumentation();
  });

  afterAll(() => {
    uninstallRxjsInstrumentation();
  });

  it('captures next events for a simple map chain', async () => {
    const events = await recordEvents(
      of(1, 2, 3).pipe(map((x) => x * 2)),
    );

    const nextEvents = events.filter((e) => e.type === 'next');
    // Map operator creates its own observable, so we capture events from both 'of' and 'map'
    // Each emits 3 values: of(1,2,3) emits 3 times, map also emits 3 times = 6 total
    expect(nextEvents).toHaveLength(6);

    // Optional sanity check: operator-create events exist
    const creates = events.filter((e) => e.type === 'observable-create');
    expect(creates.length).toBeGreaterThan(0);
  });
});

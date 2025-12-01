// test/instrumentation.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { of, map } from 'rxjs';
import {
  installRxjsInstrumentation,
  uninstallRxjsInstrumentation,
} from '../src/instrumentation/core';
import { recordEvents } from '../src/testing/helpers';

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
    expect(nextEvents).toHaveLength(3);

    // Optional sanity check: operator-create events exist
    const creates = events.filter((e) => e.type === 'observable-create');
    expect(creates.length).toBeGreaterThan(0);
  });
});

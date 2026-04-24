import test from "node:test";
import assert from "node:assert/strict";
import { createWelcomeDismissScheduler } from "../welcome-dismiss.ts";

test("welcome dismissal scheduler coalesces pending work", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks: Array<() => void> = [];
  let dismissCount = 0;

  globalThis.setTimeout = ((callback: () => void) => {
    callbacks.push(callback);
    return { id: callbacks.length } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const scheduler = createWelcomeDismissScheduler({
      dismiss: () => { dismissCount += 1; },
      getGeneration: () => 1,
      isEnabled: () => true,
    });

    scheduler.schedule(undefined);
    scheduler.schedule(undefined);
    scheduler.schedule(undefined);

    assert.equal(callbacks.length, 1);
    callbacks[0]?.();
    assert.equal(dismissCount, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("welcome dismissal scheduler cancels stale pending work", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks: Array<() => void> = [];
  const cleared = new Set<object>();
  let dismissCount = 0;
  let generation = 1;
  let enabled = true;

  globalThis.setTimeout = ((callback: () => void) => {
    const handle = { id: callbacks.length + 1 };
    callbacks.push(callback);
    return handle as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle && typeof handle === "object") {
      cleared.add(handle);
    }
  }) as typeof clearTimeout;

  try {
    const scheduler = createWelcomeDismissScheduler({
      dismiss: () => { dismissCount += 1; },
      getGeneration: () => generation,
      isEnabled: () => enabled,
    });

    scheduler.schedule(undefined);
    generation += 1;
    callbacks[0]?.();
    assert.equal(dismissCount, 0);

    scheduler.schedule(undefined);
    enabled = false;
    callbacks[1]?.();
    assert.equal(dismissCount, 0);

    enabled = true;
    scheduler.schedule(undefined);
    scheduler.cancel();
    assert.equal(cleared.size, 1);
    assert.equal(dismissCount, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

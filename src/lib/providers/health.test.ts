import { afterEach, describe, expect, it, vi } from "vitest";
import {
  providerHealth,
  recordFailure,
  recordSuccess,
  resetHealth,
  subscribeHealth,
} from "./health";

afterEach(() => resetHealth());

/**
 * What the Diagnostics panel reads, and what the copied bug report carries.
 * If this is wrong the reader is told a source is fine while nothing is
 * arriving from it.
 */
describe("what each radar source has been doing", () => {
  it("remembers the last success and clears the failure with it", () => {
    recordFailure("mrms", "the service returned 503", 1000);
    recordSuccess("mrms", 20, 2000);

    const [entry] = providerHealth();
    expect(entry.id).toBe("mrms");
    expect(entry.lastSuccess).toBe(2000);
    expect(entry.frameCount).toBe(20);
    // A source that is answering again is not still failing, and leaving the
    // old message there reads as though it were.
    expect(entry.lastError).toBeNull();
    expect(entry.consecutiveFailures).toBe(0);
    // What went wrong before is kept: the panel says when it last failed.
    expect(entry.lastFailure).toBe(1000);
  });

  it("counts failures in a row, and only in a row", () => {
    recordFailure("mrms", "one", 1);
    recordFailure("mrms", "two", 2);
    recordFailure("mrms", "three", 3);
    expect(providerHealth()[0].consecutiveFailures).toBe(3);
    expect(providerHealth()[0].lastError).toBe("three");

    recordSuccess("mrms", 5, 4);
    recordFailure("mrms", "four", 5);
    // One after a success is one, not four. "Failing constantly" and "failed
    // once just now" are different things to tell somebody.
    expect(providerHealth()[0].consecutiveFailures).toBe(1);
  });

  it("keeps each source apart", () => {
    recordSuccess("mrms", 20, 1);
    recordFailure("ridge", "the service returned 503", 2);

    const found = Object.fromEntries(
      providerHealth().map((entry) => [entry.id, entry]),
    );
    expect(found.mrms.lastError).toBeNull();
    expect(found.ridge.lastError).toBe("the service returned 503");
    expect(found.ridge.frameCount).toBe(0);
  });

  it("hands back a new list each time, so React can tell it changed", () => {
    // The panel subscribes to this. Returning the same array with the same
    // objects mutated inside it would leave the panel showing the first
    // reading forever.
    recordSuccess("mrms", 1, 1);
    const first = providerHealth();
    const firstEntry = first[0];
    recordSuccess("mrms", 2, 2);
    const second = providerHealth();

    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(firstEntry);
    expect(firstEntry.frameCount).toBe(1);
    expect(second[0].frameCount).toBe(2);
  });

  it("tells whoever is listening, and stops when they go", () => {
    const listener = vi.fn();
    const stop = subscribeHealth(listener);
    recordSuccess("mrms", 1, 1);
    expect(listener).toHaveBeenCalledTimes(1);
    recordFailure("mrms", "no", 2);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    recordSuccess("mrms", 3, 3);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("comes back empty after a reset", () => {
    recordSuccess("mrms", 1, 1);
    recordFailure("ridge", "no", 2);
    expect(providerHealth()).toHaveLength(2);
    resetHealth();
    expect(providerHealth()).toEqual([]);
  });
});

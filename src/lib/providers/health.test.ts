import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_INCIDENTS,
  clearIncidents,
  loadProviderIncidents,
  providerHealth,
  providerIncidents,
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

/**
 * What the sources have done lately, which a count of failures cannot say.
 *
 * The report used to carry "three failed in a row" and nothing else, so an
 * outage that ended an hour ago left no trace at all and a reader sending a
 * report could not say which service had been down.
 */
describe("the history of what each source has done", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetHealth();
    loadProviderIncidents();
  });
  afterEach(() => {
    window.localStorage.clear();
    resetHealth();
  });

  it("records a change of state and not a poll", () => {
    // A source failing for an hour is one incident, not two hundred. The
    // whole point of keeping fifty of them is that fifty covers a bad
    // afternoon across every source.
    recordFailure("ridge", "the service is busy", 1000);
    recordFailure("ridge", "the service is busy", 2000);
    recordFailure("ridge", "still busy", 3000);
    expect(providerIncidents()).toHaveLength(1);

    recordSuccess("ridge", 12, 4000);
    recordSuccess("ridge", 12, 5000);
    expect(providerIncidents()).toHaveLength(2);

    const [failed, repaired] = providerIncidents();
    expect(failed).toMatchObject({
      id: "ridge",
      at: 1000,
      ok: false,
      reason: "the service is busy",
    });
    expect(repaired).toMatchObject({ id: "ridge", at: 4000, ok: true });
    // A repair carries no reason: there is nothing for a service to say
    // about working.
    expect(repaired.reason).toBeNull();
  });

  it("keeps one source's history apart from another's", () => {
    recordFailure("ridge", "busy", 1000);
    recordFailure("rainviewer", "refused", 1100);
    recordSuccess("ridge", 4, 1200);
    expect(providerIncidents().map((one) => [one.id, one.ok])).toEqual([
      ["ridge", false],
      ["rainviewer", false],
      ["ridge", true],
    ]);
  });

  it("is bounded, oldest out first", () => {
    for (let at = 0; at < MAX_INCIDENTS + 10; at += 1) {
      if (at % 2) recordSuccess("ridge", 1, at + 1);
      else recordFailure("ridge", `failure ${at}`, at + 1);
    }
    const kept = providerIncidents();
    expect(kept).toHaveLength(MAX_INCIDENTS);
    // The newest is the last thing that happened, and the oldest has gone.
    expect(kept[kept.length - 1].at).toBe(MAX_INCIDENTS + 10);
    expect(kept[0].at).toBeGreaterThan(1);
  });

  it("survives a restart, and can be ended", () => {
    recordFailure("ridge", "busy", 1000);
    recordSuccess("ridge", 4, 2000);

    // A restart: the module's own memory goes, the store does not.
    resetHealth();
    expect(providerIncidents()).toHaveLength(0);
    loadProviderIncidents();
    expect(providerIncidents()).toHaveLength(2);

    clearIncidents();
    expect(providerIncidents()).toHaveLength(0);
    loadProviderIncidents();
    expect(providerIncidents()).toHaveLength(0);
  });

  it("drops a stored history it cannot read rather than repairing one", () => {
    window.localStorage.setItem("openradar.incidents", "not json at all");
    loadProviderIncidents();
    expect(providerIncidents()).toEqual([]);

    window.localStorage.setItem(
      "openradar.incidents",
      JSON.stringify([
        { id: "ridge", at: 1000, ok: false, reason: "busy" },
        { id: "ridge", ok: true },
        "nonsense",
      ]),
    );
    loadProviderIncidents();
    expect(providerIncidents()).toHaveLength(1);
  });
});

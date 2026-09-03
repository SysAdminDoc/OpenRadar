import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetOfflineForTests,
  isOnline,
  offlineSince,
  subscribeOffline,
} from "./online";

/** Pretends the machine's network came or went, the way the browser does. */
function network(state: "online" | "offline") {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => state === "online",
  });
  window.dispatchEvent(new Event(state));
}

afterEach(() => {
  forgetOfflineForTests();
  network("online");
  vi.useRealTimers();
});

describe("when the machine lost its network", () => {
  it("records the moment once, and keeps it", () => {
    // The event says the state changed and nothing else, so the moment has to
    // be remembered. More than one surface says it — the chrome and the
    // watch's health line — and a chrome reading one time while the panel
    // reads another is worse than neither saying anything.
    forgetOfflineForTests();
    network("online");
    vi.useFakeTimers();
    const heard: number[] = [];
    const stop = subscribeOffline(() => heard.push(Date.now()));
    expect(offlineSince()).toBeNull();

    network("offline");
    const first = offlineSince();
    expect(first).not.toBeNull();
    expect(heard).toHaveLength(1);

    // A second offline event, which a flapping connection sends, does not
    // move it: the machine went offline when it went offline. The clock is
    // moved between the two, because two events inside one millisecond
    // produce the same number whether or not anything reads it again.
    vi.setSystemTime(new Date(Date.now() + 30_000));
    network("offline");
    expect(offlineSince()).toBe(first);

    stop();
  });

  it("forgets the moment the network comes back", () => {
    forgetOfflineForTests();
    network("offline");
    const stop = subscribeOffline(() => {});
    expect(offlineSince()).not.toBeNull();

    network("online");
    expect(offlineSince()).toBeNull();
    expect(isOnline()).toBe(true);

    // And a second outage is its own moment rather than the first one again.
    network("offline");
    expect(offlineSince()).not.toBeNull();
    stop();
  });

  it("answers for a workspace that started with no network", () => {
    // There is no event to hear: it was already off when the app opened.
    // "Since you opened this" is honest and "since never" is not.
    forgetOfflineForTests();
    network("offline");
    const before = Date.now();
    expect(offlineSince()).toBeGreaterThanOrEqual(before);
  });
});

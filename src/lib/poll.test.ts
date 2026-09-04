import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollWhileOnline } from "./poll";

/** Pretends the machine's network came or went, the way the browser does. */
function network(state: "online" | "offline") {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => state === "online",
  });
  window.dispatchEvent(new Event(state));
}

afterEach(() => {
  network("online");
  vi.useRealTimers();
});

describe("a repeating ask that knows about the network", () => {
  it("asks nothing at all while there is none", () => {
    // The workspace has a dozen of these. With no network each one went on
    // asking and failing on its own schedule, writing a line into the log
    // every time, and from a reader's side twelve services all appeared to
    // be down at once.
    vi.useFakeTimers();
    network("offline");
    const asked = vi.fn();
    const stop = pollWhileOnline(asked, 1000);

    expect(asked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(asked).not.toHaveBeenCalled();
    stop();
  });

  it("asks the moment the network comes back, not at the next turn", () => {
    // A laptop lid closed for an hour should not open onto a two minute wait
    // for the first refresh.
    vi.useFakeTimers();
    network("offline");
    const asked = vi.fn();
    const stop = pollWhileOnline(asked, 120_000);

    network("online");
    expect(asked).toHaveBeenCalledTimes(1);

    // And the timer is still the timer.
    vi.advanceTimersByTime(120_000);
    expect(asked).toHaveBeenCalledTimes(2);
    stop();
  });

  it("asks once on the way in, unless the caller already did", () => {
    vi.useFakeTimers();
    network("online");
    const eager = vi.fn();
    const stopEager = pollWhileOnline(eager, 1000);
    expect(eager).toHaveBeenCalledTimes(1);
    stopEager();

    // Every hook that already made its own first ask under a condition of
    // its own passes false, or it would ask twice on every mount.
    const patient = vi.fn();
    const stopPatient = pollWhileOnline(patient, 1000, false);
    expect(patient).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(patient).toHaveBeenCalledTimes(1);
    stopPatient();
  });

  it("stops for good when it is torn down", () => {
    // Both halves: an interval left running is a leak, and a listener left
    // on the window is a caller that fires after its component is gone.
    vi.useFakeTimers();
    network("online");
    const asked = vi.fn();
    const stop = pollWhileOnline(asked, 1000, false);

    stop();
    vi.advanceTimersByTime(10_000);
    network("offline");
    network("online");
    expect(asked).not.toHaveBeenCalled();
  });
});

describe("every repeating ask in the workspace", () => {
  it("goes through this one, or says why it does not", () => {
    // The rule the twelve pollers share is written down once: hold off with
    // no network, ask again the moment there is one, and stop cleanly. A
    // hook that writes its own timer gets its own copy of that rule, and the
    // thirteenth got it slightly wrong. Two intervals in `src/hooks` are not
    // asks at all and are named here rather than left to be recognised.
    const allowed = new Map([
      ["useClock.ts", "the minute and second clocks, which fetch nothing"],
      ["useAmbient.ts", "a frame-rate sampler, which fetches nothing"],
      [
        "useRadarTimeline.ts",
        "the playback clock, which walks frames already held",
      ],
    ]);
    const at = join(import.meta.dirname, "..", "hooks");
    const offenders: string[] = [];
    for (const name of readdirSync(at)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.includes(".test.")) continue;
      const source = readFileSync(join(at, name), "utf8");
      if (!source.includes("setInterval")) continue;
      if (allowed.has(name)) continue;
      offenders.push(name);
    }
    expect(
      offenders,
      `${offenders.join(", ")} keeps its own timer; use pollWhileOnline or add a reason here`,
    ).toEqual([]);
  });
});

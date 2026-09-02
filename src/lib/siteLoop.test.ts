import { describe, expect, it } from "vitest";
import { loopKey, loopPrefetch, trimHeld, volumeForTime } from "./siteLoop";

/** Five volumes about five minutes apart, oldest first. */
const times = [
  Date.UTC(2026, 7, 30, 21, 0),
  Date.UTC(2026, 7, 30, 21, 5),
  Date.UTC(2026, 7, 30, 21, 10),
  Date.UTC(2026, 7, 30, 21, 15),
  Date.UTC(2026, 7, 30, 21, 20),
];

describe("which volume a moment is showing", () => {
  it("takes the last volume finished at or before the moment", () => {
    // The radar publishes a volume when it has finished sweeping it, so
    // between two of them the older one is what is true.
    expect(volumeForTime(times, Date.UTC(2026, 7, 30, 21, 7))).toBe(times[1]);
    expect(volumeForTime(times, times[2])).toBe(times[2]);
    expect(volumeForTime(times, Date.UTC(2026, 7, 30, 23, 0))).toBe(times[4]);
  });

  it("never reaches forward for a nearer one", () => {
    // 21:09 is a minute from 21:10 and four from 21:05, so the nearest is the
    // one that has not happened yet. Drawing it would put a picture of the
    // future under a timestamp from the past, which on a fast storm is the
    // difference between a warning covering the cell and trailing it.
    expect(volumeForTime(times, Date.UTC(2026, 7, 30, 21, 9))).toBe(times[1]);
  });

  it("has nothing to show for a moment older than anything held", () => {
    expect(volumeForTime(times, Date.UTC(2026, 7, 30, 20, 59))).toBe(null);
    expect(volumeForTime([], Date.now())).toBe(null);
  });
});

describe("what to have in hand", () => {
  it("asks for the one on screen first and then the way it plays", () => {
    // Every volume is ten megabytes fetched and decoded. Entering a site view
    // cost one; making it cost ten up front would be a tenfold bill for a
    // loop nobody has pressed play on.
    expect(loopPrefetch(times, Date.UTC(2026, 7, 30, 21, 7))).toEqual([
      times[1],
      times[2],
      times[3],
    ]);
  });

  it("stops at the newest rather than inventing one", () => {
    expect(loopPrefetch(times, times[4])).toEqual([times[4]]);
    expect(loopPrefetch(times, Date.UTC(2026, 7, 30, 20, 0))).toEqual([]);
  });
});

describe("what one rendered volume is held under", () => {
  it("separates two pictures of the same volume", () => {
    const base = {
      station: "KDMX",
      at: times[0],
      product: "reflectivity",
      tilt: 0,
      dealias: false,
      motion: null,
      threshold: null,
      palette: 1,
      highContrast: false,
    } as const;
    // Every one of these changes what is drawn, and a key that ignored any of
    // them would hand back a picture of a different question.
    expect(loopKey(base)).toBe(loopKey({ ...base }));
    expect(loopKey({ ...base, tilt: 1 })).not.toBe(loopKey(base));
    expect(loopKey({ ...base, product: "velocity" })).not.toBe(loopKey(base));
    expect(loopKey({ ...base, threshold: 20 })).not.toBe(loopKey(base));
    expect(loopKey({ ...base, highContrast: true })).not.toBe(loopKey(base));
    expect(loopKey({ ...base, palette: 2 })).not.toBe(loopKey(base));
    expect(loopKey({ ...base, motion: [10, 270] })).not.toBe(loopKey(base));
  });
});

describe("how many rendered volumes to keep", () => {
  it("keeps the most recently added and drops the rest", () => {
    // A rendered sweep is a PNG the size of the site's coverage, and this
    // window is meant to stay open for days.
    const held = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect([...trimHeld(held, 2).keys()]).toEqual(["b", "c"]);
    expect(trimHeld(held, 5)).toBe(held);
    expect([...trimHeld(held, 0).keys()]).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_LOOP_VOLUMES,
  MIN_LOOP_VOLUMES,
  loopKey,
  stepNow,
  stepsForVolumes,
  trimHeld,
  volumeForTime,
} from "./siteLoop";

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

describe("which step to stand on to see each volume", () => {
  /** Seven mosaic steps two minutes apart, ending with the newest volume. */
  const steps = [12, 10, 8, 6, 4, 2, 0].map((back) => ({
    time: (times[4] - back * 60_000) / 1000,
  }));

  it("gives one step per volume, oldest first", () => {
    // Saving a loop by walking the steps wrote the same volume into two and
    // three frames, each captioned with a different mosaic time. Walking the
    // volumes writes each of them once.
    const walk = stepsForVolumes(steps, [times[2], times[3], times[4]]);
    expect(walk.map((one) => one.at)).toEqual([times[2], times[3], times[4]]);
    expect(walk.map((one) => one.index)).toEqual([1, 4, 6]);
  });

  it("leaves out a volume no step lands on", () => {
    // 21:13 is superseded by 21:14 before the next step comes round, so no
    // step ever shows it. A frame count that included it would leave the walk
    // drawing 21:14 twice under two different stamps.
    const walk = stepsForVolumes(steps, [
      times[4] - 7 * 60_000,
      times[4] - 6 * 60_000,
      times[4],
    ]);
    expect(walk.map((one) => one.at)).toEqual([
      times[4] - 6 * 60_000,
      times[4],
    ]);
    expect(walk.map((one) => one.index)).toEqual([3, 6]);
  });

  it("has nothing to walk when no step reaches any volume", () => {
    expect(stepsForVolumes(steps, [])).toEqual([]);
    expect(stepsForVolumes([], [times[0]])).toEqual([]);
    // Every step older than the oldest volume: the mosaic has caught up with
    // nothing the site has published yet.
    expect(stepsForVolumes(steps, [times[4] + 60 * 60_000])).toEqual([]);
  });
});

describe("a step that moves while the walk is running", () => {
  const steps = [12, 10, 8, 6, 4, 2, 0].map((back) => ({
    time: (times[4] - back * 60_000) / 1000,
  }));

  it("is found again by its own time when the frames shift", () => {
    // Saving a loop of thirty volumes outlives the timeline's own refresh,
    // and a refresh that drops the oldest frame shifts every position down by
    // one. Each of these positions is the FIRST step of its volume, so one
    // shift lands the walk on the LAST step of the previous volume: the frame
    // waits out its whole timeout and is then written with the wrong
    // picture under the right caption.
    const walk = stepsForVolumes(steps, [times[2], times[3], times[4]]);
    expect(walk.map((one) => one.index)).toEqual([1, 4, 6]);

    const shifted = steps.slice(1);
    expect(walk.map((one) => stepNow(shifted, one))).toEqual([0, 3, 5]);
    // And each of those really is the step that was chosen.
    for (const step of walk) {
      expect(shifted[stepNow(shifted, step)].time).toBe(step.frameTime);
    }
  });

  it("stays where it was when its frame has gone entirely", () => {
    // Nothing better to do than carry on: the alternative is jumping to
    // whatever now sits at that position, which is a different moment.
    const walk = stepsForVolumes(steps, [times[2], times[3], times[4]]);
    const gone = steps.slice(3);
    expect(stepNow(gone, walk[0])).toBe(walk[0].index);
  });

  it("costs nothing when nothing has moved", () => {
    const walk = stepsForVolumes(steps, [times[2], times[3], times[4]]);
    for (const step of walk) {
      expect(stepNow(steps, step)).toBe(step.index);
    }
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

describe("the bound on a loop's length is written down once", () => {
  // It is written down twice: here, where the panel offers the numbers, and
  // in `level2.rs`, which clamps whatever it is asked for before it goes to
  // the bucket. Nothing failed when they drifted. The one that matters is
  // the native clamp, because a reader who is offered 40 in a dropdown and
  // silently given 30 has a loop that stops where nothing said it would.
  const native = readFileSync(
    join(import.meta.dirname, "..", "..", "src-tauri", "src", "level2.rs"),
    "utf8",
  );

  it("agrees with the clamp in level2.rs", () => {
    const declared = native.match(/pub const MAX_LOOP_VOLUMES: usize = (\d+);/);
    expect(
      declared,
      "level2.rs no longer declares MAX_LOOP_VOLUMES, so this gate is reading nothing",
    ).not.toBeNull();
    expect(
      Number(declared![1]),
      "src/lib/siteLoop.ts and src-tauri/src/level2.rs disagree about the longest loop",
    ).toBe(MAX_LOOP_VOLUMES);
  });

  it("agrees with the floor the clamp applies", () => {
    // The clamp's low end is a literal rather than a constant, so it is read
    // out of the call itself.
    const clamp = native.match(/count\.clamp\((\d+), MAX_LOOP_VOLUMES\)/);
    expect(
      clamp,
      "level2_recent_times no longer clamps against MAX_LOOP_VOLUMES",
    ).not.toBeNull();
    expect(
      Number(clamp![1]),
      "src/lib/siteLoop.ts and src-tauri/src/level2.rs disagree about the shortest loop",
    ).toBe(MIN_LOOP_VOLUMES);
  });
});

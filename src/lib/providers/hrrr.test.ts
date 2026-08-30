import { describe, expect, it } from "vitest";
import {
  HRRR_MAX_FRAMES,
  HRRR_STEP_MINUTES,
  hrrrFrames,
  hrrrTileUrl,
  parseHrrrRun,
} from "./hrrr";

const run = {
  initUtc: "2026-08-30T05:00:00Z",
  initToken: "202608300500",
};
const initEpoch = Date.parse(run.initUtc) / 1000;

describe("HRRR run index", () => {
  it("turns the published run into the token the tile path wants", () => {
    expect(parseHrrrRun({ model_init_utc: "2026-08-30T05:00:00Z" })).toEqual(
      run,
    );
    expect(parseHrrrRun({ model_init_utc: "not a time" })).toBeNull();
    expect(parseHrrrRun({})).toBeNull();
    expect(parseHrrrRun(null)).toBeNull();
  });

  it("addresses one forecast hour with a zero-padded lead", () => {
    expect(hrrrTileUrl(run, 15)).toBe(
      "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0015-202608300500/{z}/{x}/{y}.png",
    );
    expect(hrrrTileUrl(run, 360)).toContain("REFD-F0360-202608300500");
  });
});

describe("forecast frames", () => {
  it("starts after the newest observation and steps every quarter hour", () => {
    const newest = initEpoch + 90 * 60;
    const frames = hrrrFrames(run, newest);

    expect(frames[0].time).toBe(initEpoch + 105 * 60);
    expect(frames[0].forecast).toEqual({
      initUtc: run.initUtc,
      leadMinutes: 105,
    });
    expect(frames[1].time - frames[0].time).toBe(HRRR_STEP_MINUTES * 60);
    expect(frames.every((frame) => frame.time > newest)).toBe(true);
  });

  it("never caches more than six hours of lead", () => {
    const frames = hrrrFrames(run, initEpoch);
    expect(frames).toHaveLength(HRRR_MAX_FRAMES);
    expect(frames.at(-1)!.forecast?.leadMinutes).toBe(
      HRRR_MAX_FRAMES * HRRR_STEP_MINUTES,
    );
  });

  it("returns nothing once the run is older than its own tail", () => {
    expect(hrrrFrames(run, initEpoch + 19 * 3600)).toEqual([]);
    expect(hrrrFrames({ ...run, initUtc: "nonsense" }, 0)).toEqual([]);
  });
});

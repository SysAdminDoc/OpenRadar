import { describe, expect, it } from "vitest";
import { wallpaperDue, WALLPAPER_FLOOR_MINUTES } from "./wallpaper";

/**
 * What the schedule counts.
 *
 * The bug this holds shut: the gap was counted from the attempt rather than
 * from a picture that actually went up. A cold start fires the effect before
 * the map has come up and before the first frames land, so the attempt found
 * nothing to draw, spent the slot, and left the desktop untouched for the
 * whole of the reader's chosen gap. On a three-hour gap that is three hours
 * of nothing after every launch.
 */

const MINUTE = 60_000;
const START = Date.parse("2026-09-02T09:00:00.000Z");

/** The workspace's own arithmetic, with the writing stubbed. */
function run(options: {
  everyMinutes: number;
  writes: boolean[];
  ticks: number;
}) {
  let lastAt = 0;
  let written = 0;
  let attempt = 0;
  const at: number[] = [];
  for (let tick = 0; tick < options.ticks; tick += 1) {
    const now = START + tick * MINUTE;
    if (!wallpaperDue(options.everyMinutes, lastAt, now)) continue;
    const wrote = options.writes[attempt] ?? true;
    attempt += 1;
    if (wrote) {
      written += 1;
      at.push(tick);
      lastAt = now;
    }
  }
  return { written, at };
}

describe("counting the gap between pictures", () => {
  it("does not spend a slot on a launch with nothing to draw", () => {
    // The first four minutes have no frames and no canvas.
    const quiet = run({
      everyMinutes: 180,
      writes: [false, false, false, false],
      ticks: 20,
    });
    expect(quiet.written).toBeGreaterThan(0);
    expect(quiet.at[0]).toBeLessThanOrEqual(5);
  });

  it("waits the whole gap after one that did go up", () => {
    const steady = run({ everyMinutes: 60, writes: [], ticks: 190 });
    expect(steady.at).toEqual([0, 60, 120, 180]);
  });

  it("never asks for one faster than the floor, whatever it is told", () => {
    const pushy = run({ everyMinutes: 1, writes: [], ticks: 61 });
    for (let step = 1; step < pushy.at.length; step += 1) {
      expect(pushy.at[step] - pushy.at[step - 1]).toBeGreaterThanOrEqual(
        WALLPAPER_FLOOR_MINUTES,
      );
    }
  });
});

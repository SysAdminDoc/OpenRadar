import { describe, expect, it, vi } from "vitest";
import { writeWallpaperIfDue, WALLPAPER_FLOOR_MINUTES } from "./wallpaper";

/**
 * What the schedule counts.
 *
 * The bug this holds shut: the gap was counted from the attempt rather than
 * from a picture that actually went up. A launch fires this before the map
 * has come up and before the first frames land, so the attempt found nothing
 * to draw, spent the slot, and left the desktop untouched for the whole of
 * the reader's chosen gap. On three hours, that is three hours of nothing
 * after every launch.
 */

const MINUTE = 60_000;
const START = Date.parse("2026-09-02T09:00:00.000Z");

describe("counting the gap between pictures", () => {
  it("does not spend a slot on a launch with nothing to draw", async () => {
    const write = vi.fn(async () => false);
    const onFailure = vi.fn();
    const after = await writeWallpaperIfDue({
      everyMinutes: 180,
      lastAt: 0,
      now: START,
      write,
      onFailure,
    });
    expect(write).toHaveBeenCalledTimes(1);
    // Still due, so the frames arriving a second later get their picture.
    expect(after).toBe(0);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("counts from the picture that went up", async () => {
    const after = await writeWallpaperIfDue({
      everyMinutes: 180,
      lastAt: 0,
      now: START,
      write: async () => true,
      onFailure: vi.fn(),
    });
    expect(after).toBe(START);
  });

  it("asks for nothing until the gap has passed", async () => {
    const write = vi.fn(async () => true);
    const after = await writeWallpaperIfDue({
      everyMinutes: 60,
      lastAt: START,
      now: START + 59 * MINUTE,
      write,
      onFailure: vi.fn(),
    });
    expect(write).not.toHaveBeenCalled();
    expect(after).toBe(START);
  });

  it("holds the floor whatever the stored number says", async () => {
    const write = vi.fn(async () => true);
    await writeWallpaperIfDue({
      everyMinutes: 1,
      lastAt: START,
      now: START + (WALLPAPER_FLOOR_MINUTES - 1) * MINUTE,
      write,
      onFailure: vi.fn(),
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("spends the slot on a failure, and says so once", async () => {
    // A machine that refused once refuses every time. Told every fifteen
    // minutes, a reader switches the app off rather than the feature.
    const onFailure = vi.fn();
    const after = await writeWallpaperIfDue({
      everyMinutes: 60,
      lastAt: 0,
      now: START,
      write: async () => {
        throw new Error("the folder is gone");
      },
      onFailure,
    });
    expect(after).toBe(START);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toBeInstanceOf(Error);

    // And nothing more until the gap has passed.
    const write = vi.fn(async () => true);
    await writeWallpaperIfDue({
      everyMinutes: 60,
      lastAt: after,
      now: START + 30 * MINUTE,
      write,
      onFailure,
    });
    expect(write).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  wallpaperDue,
  WALLPAPER_EVERY,
  WALLPAPER_FLOOR_MINUTES,
} from "./wallpaper";

/**
 * How often a picture may go on somebody's desktop.
 *
 * The thing this guards is not the desktop, it is the service behind it. A
 * wallpaper refreshing every minute is a loop asking a public radar service
 * for a frame every minute, for ever, behind a spreadsheet nobody is looking
 * at.
 */

const NOW = Date.parse("2026-09-02T13:00:00.000Z");
const MINUTE = 60_000;

describe("when another picture is due", () => {
  it("is never, when the reader has not asked for one", () => {
    expect(wallpaperDue(0, 0, NOW)).toBe(false);
    expect(wallpaperDue(0, NOW - 1e9, NOW)).toBe(false);
  });

  it("waits the gap the reader chose", () => {
    expect(wallpaperDue(60, NOW - 59 * MINUTE, NOW)).toBe(false);
    expect(wallpaperDue(60, NOW - 60 * MINUTE, NOW)).toBe(true);
  });

  it("holds the floor whatever it is asked for", () => {
    // A stored number from an older build, or from a file somebody edited,
    // must not be able to ask for a picture a minute.
    for (const asked of [1, 2, 5, 14, -30]) {
      expect(
        wallpaperDue(asked, NOW - (WALLPAPER_FLOOR_MINUTES - 1) * MINUTE, NOW),
        String(asked),
      ).toBe(false);
    }
    expect(wallpaperDue(1, NOW - WALLPAPER_FLOOR_MINUTES * MINUTE, NOW)).toBe(
      true,
    );
  });

  it("offers nothing under the floor", () => {
    for (const every of WALLPAPER_EVERY) {
      if (every === 0) continue;
      expect(every, String(every)).toBeGreaterThanOrEqual(
        WALLPAPER_FLOOR_MINUTES,
      );
    }
  });
});

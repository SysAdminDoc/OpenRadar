import { describe, expect, it } from "vitest";
import { observedMsFrom } from "./tray";
import { frameAgeMinutes } from "./radar";
import type { RadarFrame } from "./radar";

/**
 * How old the small window says the picture is.
 *
 * The bug this holds shut: a frame carries its time in seconds, which is what
 * every radar service publishes, and the small window subtracts it from
 * `Date.now()`. Handing one over unmultiplied made a four minute old picture
 * read as twenty-nine million minutes old, on every open, for every reader.
 * Both sides are plain numbers, so nothing but this catches it.
 */

const NOW = Date.parse("2026-09-02T13:00:00.000Z");

function frameAt(minutesAgo: number): RadarFrame {
  return {
    providerId: "mrms",
    time: Math.floor((NOW - minutesAgo * 60_000) / 1000),
    tileUrl: "https://example.com/{z}/{x}/{y}.png",
    tileSize: 256,
    maxZoom: 8,
    attribution: "NOAA",
  };
}

/** What the small window itself does with the number it is handed. */
function asTheWindowReadsIt(observedMs: number | null): number | null {
  if (observedMs === null) return null;
  return Math.max(0, Math.round((NOW - observedMs) / 60_000));
}

describe("the age handed to the small window", () => {
  it("agrees with the age the workspace shows for the same frame", () => {
    for (const minutes of [0, 1, 4, 17, 120]) {
      const frame = frameAt(minutes);
      expect(
        asTheWindowReadsIt(observedMsFrom(frame)),
        `${minutes} minutes`,
      ).toBe(frameAgeMinutes(frame, NOW));
    }
  });

  it("reads a four minute old picture as four minutes, not millions", () => {
    expect(asTheWindowReadsIt(observedMsFrom(frameAt(4)))).toBe(4);
  });

  it("says nothing rather than nought when there is no frame", () => {
    expect(observedMsFrom(null)).toBeNull();
    expect(observedMsFrom(undefined)).toBeNull();
  });
});

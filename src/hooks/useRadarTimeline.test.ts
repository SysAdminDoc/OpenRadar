import { describe, expect, it } from "vitest";
import { framesWithinLoop, nextSelection } from "./useRadarTimeline";
import type { RadarFrame } from "../lib/radar";

function frames(times: number[]): RadarFrame[] {
  return times.map((time) => ({
    providerId: "ridge",
    time,
    tileUrl: `https://example.test/${time}`,
    tileSize: 256,
    maxZoom: 12,
    attribution: "NOAA",
  }));
}

const base = 1788000000;
const minute = 60;

describe("loop window", () => {
  it("keeps only the frames inside the chosen loop length", () => {
    const all = frames([
      base,
      base + 30 * minute,
      base + 90 * minute,
      base + 120 * minute,
    ]);
    expect(framesWithinLoop(all, 120).map((frame) => frame.time)).toEqual(
      all.map((frame) => frame.time),
    );
    expect(framesWithinLoop(all, 60).map((frame) => frame.time)).toEqual([
      base + 90 * minute,
      base + 120 * minute,
    ]);
    expect(framesWithinLoop([], 60)).toEqual([]);
  });
});

describe("playhead across a refresh", () => {
  const previous = frames([base, base + 2 * minute, base + 4 * minute]);
  const incoming = frames([
    base + 2 * minute,
    base + 4 * minute,
    base + 6 * minute,
  ]);

  it("keeps a scrubbed frame that the refresh still carries", () => {
    expect(nextSelection(previous, base + 2 * minute, incoming, false)).toBe(
      base + 2 * minute,
    );
  });

  it("follows the newest frame while playing", () => {
    expect(nextSelection(previous, base + 2 * minute, incoming, true)).toBe(
      base + 6 * minute,
    );
  });

  it("follows the newest frame when the user was already on the newest", () => {
    expect(nextSelection(previous, base + 4 * minute, incoming, false)).toBe(
      base + 6 * minute,
    );
  });

  it("falls back to the newest frame when the old one aged out", () => {
    expect(nextSelection(previous, base, incoming, false)).toBe(
      base + 6 * minute,
    );
  });

  it("selects the newest frame on the first load", () => {
    expect(nextSelection([], null, incoming, false)).toBe(base + 6 * minute);
    expect(nextSelection([], null, [], false)).toBeNull();
  });
});

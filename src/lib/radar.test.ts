import { describe, expect, it } from "vitest";
import { animationIntervalMs, formatFrameTime, frameAgeMinutes } from "./radar";
import type { RadarFrame } from "./providers/types";

const frame: RadarFrame = {
  providerId: "ridge",
  time: 1788068400,
  tileUrl: "https://example.test/tile",
  tileSize: 256,
  maxZoom: 12,
  attribution: "NOAA",
};

describe("radar timing", () => {
  it("maps the observed speed range to bounded frame timing", () => {
    expect(animationIntervalMs(-0.8)).toBe(1800);
    expect(animationIntervalMs(0.5)).toBe(350);
    expect(animationIntervalMs(10)).toBe(350);
  });

  it("reports whole minutes of age and never a negative one", () => {
    expect(frameAgeMinutes(frame, frame.time * 1000 + 8 * 60_000)).toBe(8);
    expect(frameAgeMinutes(frame, frame.time * 1000 - 60_000)).toBe(0);
  });

  it("falls back to a waiting label with no frame", () => {
    expect(formatFrameTime(undefined)).toBe("Waiting for radar");
    expect(formatFrameTime(frame)).toMatch(/\d/);
  });
});

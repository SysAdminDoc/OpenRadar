import { describe, expect, it } from "vitest";
import {
  FORECAST_SMOKE_OPACITY,
  forecastSmokeCorners,
  forecastSmokeLabel,
  forecastSmokeValid,
  sameInstant,
  swatchOpacity,
  type SmokeField,
} from "./forecastSmoke";
import type { RadarFrame } from "./providers/types";

function frame(leadMinutes: number, forecast = true): RadarFrame {
  return {
    providerId: "hrrr",
    time: 0,
    tileUrl: "",
    tileSize: 256,
    maxZoom: 9,
    attribution: "",
    ...(forecast
      ? { forecast: { initUtc: "2026-08-30T05:00:00Z", leadMinutes } }
      : {}),
  };
}

const FIELD: SmokeField = {
  init: "2026-08-30T05:00:00+00:00",
  leadHours: 3,
  valid: "2026-08-30T08:00:00+00:00",
  west: -134.1,
  south: 21.1,
  east: -60.9,
  north: 52.6,
  columns: 1200,
  rows: 663,
  maxUgm3: 42,
  ramp: [{ at: 3, color: "#fde68a", alpha: 128 }],
  image: "data:image/png;base64,",
};

describe("which hour stands for a frame", () => {
  it("takes the nearest whole hour and never the cycle's own", () => {
    // Quarter-hour frames against hourly fields. The first three frames
    // round down to the analysis hour, which is a picture of the past, so
    // they take the first forecast hour instead.
    expect(forecastSmokeValid(frame(15))).toBe("2026-08-30T06:00:00Z");
    expect(forecastSmokeValid(frame(30))).toBe("2026-08-30T06:00:00Z");
    expect(forecastSmokeValid(frame(45))).toBe("2026-08-30T06:00:00Z");
    expect(forecastSmokeValid(frame(60))).toBe("2026-08-30T06:00:00Z");
    expect(forecastSmokeValid(frame(75))).toBe("2026-08-30T06:00:00Z");
    expect(forecastSmokeValid(frame(90))).toBe("2026-08-30T07:00:00Z");
    expect(forecastSmokeValid(frame(390))).toBe("2026-08-30T12:00:00Z");
  });

  it("has no hour for an observed frame", () => {
    expect(forecastSmokeValid(frame(0, false))).toBeNull();
    expect(forecastSmokeValid(undefined)).toBeNull();
  });
});

describe("what the map and the legend are handed", () => {
  it("pins the picture clockwise from the top left", () => {
    expect(forecastSmokeCorners(FIELD)).toEqual([
      [-134.1, 52.6],
      [-60.9, 52.6],
      [-60.9, 21.1],
      [-134.1, 21.1],
    ]);
  });

  it("draws a swatch as solid as its step is on the map", () => {
    // The picture is painted with a per-step alpha and drawn at the lane's
    // opacity. A swatch that ignored either would be a colour the map never
    // shows.
    expect(swatchOpacity({ at: 3, color: "#fde68a", alpha: 128 })).toBeCloseTo(
      (128 / 255) * FORECAST_SMOKE_OPACITY,
    );
    expect(
      swatchOpacity({ at: 250, color: "#581c1c", alpha: 255 }),
    ).toBeCloseTo(FORECAST_SMOKE_OPACITY);
    expect(swatchOpacity({ at: 0, color: "#000", alpha: 999 })).toBeCloseTo(
      FORECAST_SMOKE_OPACITY,
    );
  });

  it("names the cycle, the lead and the cycle's age", () => {
    const now = Date.parse("2026-08-30T07:30:00Z");
    expect(forecastSmokeLabel(FIELD, now)).toBe(
      "HRRR 05Z +3 h · cycle 2 h old",
    );
  });

  it("matches an hour however the two sides write it", () => {
    // The page asks with a Z and the native side answers with +00:00. A
    // string comparison would refetch every hour it already had.
    expect(
      sameInstant("2026-08-30T08:00:00Z", "2026-08-30T08:00:00+00:00"),
    ).toBe(true);
    expect(sameInstant("2026-08-30T08:00:00Z", "2026-08-30T09:00:00Z")).toBe(
      false,
    );
    expect(sameInstant("not a time", "not a time")).toBe(false);
  });
});

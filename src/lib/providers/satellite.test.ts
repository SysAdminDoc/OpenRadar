import { describe, expect, it } from "vitest";
import {
  SATELLITE_LATENCY_SECONDS,
  SATELLITE_STEP_SECONDS,
  satelliteFrameTime,
  satelliteTileUrl,
} from "./satellite";

const now = Date.parse("2026-08-30T08:05:00Z") / 1000;

describe("satellite frame time", () => {
  it("snaps an older frame back to its published slot", () => {
    const frame = Date.parse("2026-08-30T06:47:00Z") / 1000;
    expect(satelliteFrameTime(frame, now)).toBe(
      Date.parse("2026-08-30T06:40:00Z") / 1000,
    );
  });

  it("never asks for a slot the archive has not published", () => {
    const frame = Date.parse("2026-08-30T08:04:00Z") / 1000;
    const resolved = satelliteFrameTime(frame, now);
    expect(resolved).toBeLessThanOrEqual(now - SATELLITE_LATENCY_SECONDS);
    expect(resolved % SATELLITE_STEP_SECONDS).toBe(0);
    expect(new Date(resolved * 1000).toISOString()).toBe(
      "2026-08-30T07:20:00.000Z",
    );
  });

  it("addresses one image with a whole-second timestamp", () => {
    expect(satelliteTileUrl(Date.parse("2026-08-30T07:20:00Z") / 1000)).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  SINGLE_SITE_MIN_ZOOM,
  isLevel2Product,
  isSingleSiteViewport,
  sweepAgeMinutes,
  sweepCorners,
  type SweepImage,
} from "./level2";

const sweep: SweepImage = {
  station: "KDMX",
  siteName: "Des Moines, IA",
  productId: "reflectivity",
  paletteApplied: false,
  dealiased: false,
  product: "Reflectivity",
  unit: "dBZ",
  elevationDegrees: 0.48,
  tilts: [0.48, 0.87, 1.31],
  tiltIndex: 0,
  collected: "2026-08-30T09:21:59+00:00",
  west: -96.5,
  south: 39.6,
  east: -91.0,
  north: 43.8,
  image: "data:image/png;base64,AAAA",
  volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
};

describe("single site handover", () => {
  it("takes over only once the view is close in", () => {
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM)).toBe(true);
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM + 2)).toBe(true);
    expect(isSingleSiteViewport(SINGLE_SITE_MIN_ZOOM - 0.01)).toBe(false);
    expect(isSingleSiteViewport(4.55)).toBe(false);
  });

  it("accepts only the products the native side decodes", () => {
    expect(isLevel2Product("reflectivity")).toBe(true);
    expect(isLevel2Product("velocity")).toBe(true);
    expect(isLevel2Product("composite")).toBe(false);
    expect(isLevel2Product(undefined)).toBe(false);
  });
});

describe("placing a sweep on the map", () => {
  it("gives the corners clockwise from the top left", () => {
    expect(sweepCorners(sweep)).toEqual([
      [-96.5, 43.8],
      [-91.0, 43.8],
      [-91.0, 39.6],
      [-96.5, 39.6],
    ]);
  });

  it("ages a sweep from when it was collected, not when it arrived", () => {
    const now = Date.parse("2026-08-30T09:28:59+00:00");
    expect(sweepAgeMinutes(sweep, now)).toBe(7);
    // A clock behind the volume must not report a negative age.
    expect(sweepAgeMinutes(sweep, Date.parse("2026-08-30T09:00:00Z"))).toBe(0);
    expect(sweepAgeMinutes({ ...sweep, collected: "nonsense" }, now)).toBe(0);
  });
});

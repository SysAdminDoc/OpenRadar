import { describe, expect, it } from "vitest";
import {
  SINGLE_SITE_MIN_ZOOM,
  beamHeightFeet,
  isLevel2Product,
  isSingleSiteViewport,
  sweepAgeMinutes,
  sweepCorners,
  sweepSite,
  type SweepImage,
} from "./level2";

const sweep: SweepImage = {
  station: "KDMX",
  siteName: "Des Moines, IA",
  productId: "reflectivity",
  paletteApplied: false,
  dealiased: false,
  stormMotion: null,
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

describe("how high the beam is", () => {
  it("climbs the way the four-thirds earth model says", () => {
    // The published figure for the lowest tilt: about a mile and a half up at
    // a hundred kilometres out. It is why the same couplet at the same tilt
    // means something different at the edge of the range than near the site.
    expect(beamHeightFeet(100, 0.5)).toBeCloseTo(1.461 * 3280.84, 0);
    // At the radar it is on the ground, whatever the tilt.
    expect(beamHeightFeet(0, 0.5)).toBeCloseTo(0, 6);
    // Higher tilt, higher beam, at the same distance.
    expect(beamHeightFeet(100, 3.5)).toBeGreaterThan(beamHeightFeet(100, 0.5));
    // And further out is higher still, even at the same tilt, because the
    // earth curves away underneath it.
    expect(beamHeightFeet(200, 0.5)).toBeGreaterThan(
      2 * beamHeightFeet(100, 0.5),
    );
    // Nonsense in, nothing out.
    expect(beamHeightFeet(Number.NaN, 0.5)).toBe(0);
    expect(beamHeightFeet(-10, 0.5)).toBe(0);
  });

  it("reads the site back off the extent its sweep was drawn to", () => {
    // The extent is the circle around the site, so its middle is the site,
    // which is the only place the range to a clicked point can be measured
    // from.
    expect(
      sweepSite({
        ...sweep,
        west: -96.5,
        east: -91.0,
        south: 39.6,
        north: 43.8,
      }),
    ).toEqual({ lon: -93.75, lat: 41.7 });
  });
});

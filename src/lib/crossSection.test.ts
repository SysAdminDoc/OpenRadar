import { describe, expect, it } from "vitest";
import {
  distancePosition,
  distanceTicks,
  heightPosition,
  heightTicks,
  type CrossSection,
} from "./crossSection";

function sliceOf(distanceKm: number, topKm = 18): CrossSection {
  return {
    station: "KDMX",
    siteName: "Des Moines, IA",
    productId: "reflectivity",
    product: "Reflectivity",
    unit: "dBZ",
    paletteApplied: false,
    highContrast: false,
    dealiased: false,
    from: [-94, 41.7],
    to: [-93, 41.7],
    distanceKm,
    topKm,
    lowestCut: 0.48,
    highestCut: 4.3,
    tilts: [0.48, 0.87, 1.31, 1.8, 4.3],
    collected: "2026-08-30T09:21:59.000Z",
    volume: "v",
    width: 720,
    height: 260,
    image: "data:image/png;base64,",
    source: { kind: "recent", label: "NOAA NEXRAD Level II", url: null },
  };
}

describe("placing a label on a slice", () => {
  it("spaces distance across the picture", () => {
    const slice = sliceOf(80);
    expect(distancePosition(slice, 0)).toBe(0);
    expect(distancePosition(slice, 80)).toBe(100);
    expect(distancePosition(slice, 40)).toBeCloseTo(50, 5);
    // A label off the end of the line has nowhere to sit.
    expect(distancePosition(slice, 120)).toBeNull();
    expect(distancePosition(slice, -1)).toBeNull();
  });

  it("spaces height up the picture", () => {
    const slice = sliceOf(80);
    expect(heightPosition(slice, 0)).toBe(0);
    expect(heightPosition(slice, 18)).toBe(100);
    expect(heightPosition(slice, 9)).toBeCloseTo(50, 5);
    expect(heightPosition(slice, 25)).toBeNull();
  });

  it("has nowhere to put a label on a line of no length", () => {
    // Two clicks in the same place. The picture is empty and the axis must
    // not divide by nothing.
    const nothing = sliceOf(0);
    expect(distancePosition(nothing, 0)).toBeNull();
    expect(distanceTicks(nothing)).toEqual([]);
  });
});

describe("which values a slice is worth labelling at", () => {
  it("keeps the labels to a handful whatever the line's length", () => {
    for (const km of [3, 12, 47, 120, 230, 460]) {
      const ticks = distanceTicks(sliceOf(km));
      expect(ticks.length).toBeGreaterThan(1);
      expect(ticks.length).toBeLessThanOrEqual(7);
      expect(ticks[0]).toBe(0);
      // Every one of them is somewhere on the picture.
      for (const tick of ticks) {
        expect(distancePosition(sliceOf(km), tick)).not.toBeNull();
      }
    }
  });

  it("steps the height axis in threes to the top", () => {
    expect(heightTicks(sliceOf(80))).toEqual([0, 3, 6, 9, 12, 15, 18]);
  });
});

import { describe, expect, it } from "vitest";
import {
  barbParts,
  fastestMs,
  hodographPoint,
  knots,
  type VwpColumn,
  type VwpLevel,
} from "./vwp";

function level(over: Partial<VwpLevel> = {}): VwpLevel {
  return {
    heightKm: 1,
    speedMs: null,
    fromDegrees: null,
    elevationDegrees: null,
    rangeKm: null,
    residualMs: null,
    symmetryMs: null,
    refused: null,
    ...over,
  };
}

describe("what a wind barb is made of", () => {
  it("counts pennants, barbs and the half, at the nearest five knots", () => {
    // The convention every weather chart uses and none of them writes down.
    expect(barbParts(0)).toEqual({ pennants: 0, full: 0, half: false });
    expect(barbParts(5)).toEqual({ pennants: 0, full: 0, half: true });
    expect(barbParts(10)).toEqual({ pennants: 0, full: 1, half: false });
    expect(barbParts(15)).toEqual({ pennants: 0, full: 1, half: true });
    expect(barbParts(50)).toEqual({ pennants: 1, full: 0, half: false });
    expect(barbParts(65)).toEqual({ pennants: 1, full: 1, half: true });
    expect(barbParts(105)).toEqual({ pennants: 2, full: 0, half: true });
  });

  it("rounds to the nearest five before it counts anything", () => {
    // 12 knots is a single full barb, not one and a bit of one.
    expect(barbParts(12)).toEqual({ pennants: 0, full: 1, half: false });
    expect(barbParts(13)).toEqual({ pennants: 0, full: 1, half: true });
    // And a negative speed is not a wind blowing backwards.
    expect(barbParts(-4)).toEqual({ pennants: 0, full: 0, half: false });
  });
});

describe("where a level sits on a hodograph", () => {
  it("plots where the wind is going, not where it came from", () => {
    // A southwesterly is up and to the right. Getting this backwards draws
    // every shear vector the wrong way, which reads as a plausible storm
    // going in the opposite direction.
    const point = hodographPoint(level({ speedMs: 10, fromDegrees: 225 }));
    expect(point?.east).toBeCloseTo(7.07, 1);
    expect(point?.north).toBeCloseTo(7.07, 1);

    // A due northerly blows toward the south.
    const northerly = hodographPoint(level({ speedMs: 10, fromDegrees: 0 }));
    expect(northerly?.east).toBeCloseTo(0, 5);
    expect(northerly?.north).toBeCloseTo(-10, 5);

    // A due westerly blows toward the east.
    const westerly = hodographPoint(level({ speedMs: 10, fromDegrees: 270 }));
    expect(westerly?.east).toBeCloseTo(10, 5);
    expect(westerly?.north).toBeCloseTo(0, 5);
  });

  it("has nothing to plot for a level with no wind on it", () => {
    expect(hodographPoint(level({ refused: "residual" }))).toBeNull();
  });
});

describe("scaling a hodograph", () => {
  it("takes the widest wind across every column", () => {
    const column = (speeds: Array<number | null>): VwpColumn => ({
      volume: "KDMX20260501_200000_V06",
      collected: null,
      levels: speeds.map((speedMs) => level({ speedMs, fromDegrees: 270 })),
    });
    expect(fastestMs([column([4, 9, null]), column([null, 21])])).toBe(21);
    // Nothing measured anywhere is nothing to scale to, and a zero has to
    // come back rather than an infinity or a NaN.
    expect(fastestMs([column([null, null])])).toBe(0);
    expect(fastestMs([])).toBe(0);
  });
});

describe("knots", () => {
  it("converts from the metres a second the radar reads in", () => {
    expect(knots(10)).toBeCloseTo(19.44, 2);
  });
});

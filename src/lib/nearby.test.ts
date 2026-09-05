import { bearingDegrees } from "./geo";
import { afterEach, describe, expect, it } from "vitest";
import {
  NEARBY_LIMIT,
  compassPoint,
  nearbyCells,
  nearbySummary,
  warningsOver,
} from "./nearby";
import type { StormCell } from "./cells";
import type { OverlayData } from "./overlays";
import { setUnits } from "./units";
import { ensureLanguage, setLanguage } from "../i18n";

/** Oklahoma City, which is where the fixtures below are hung off. */
const HERE = { lon: -97.5, lat: 35.5 };

function cell(overrides: Partial<StormCell> & { id: string }): StormCell {
  return {
    latitude: 35.5,
    longitude: -97.5,
    rangeKm: 0,
    azimuthDegrees: 0,
    directionDegrees: 45,
    speedMs: 15,
    forecast: [],
    past: [],
    ...overrides,
  };
}

function polygon(
  ring: Array<[number, number]>,
  properties: Record<string, unknown> = {},
): OverlayData["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { headline: "Tornado Warning", capId: "one", ...properties },
  };
}

function collection(features: OverlayData["features"]): OverlayData {
  return { type: "FeatureCollection", features };
}

/** A square a degree on a side with the fixture point in the middle of it. */
const AROUND_HERE: Array<[number, number]> = [
  [-98, 35],
  [-97, 35],
  [-97, 36],
  [-98, 36],
  [-98, 35],
];

afterEach(() => {
  setUnits("imperial");
  setLanguage("en");
});

describe("bearings", () => {
  it("reads north as zero and east as ninety", () => {
    expect(bearingDegrees(HERE, { lon: -97.5, lat: 36.5 })).toBeCloseTo(0, 1);
    expect(bearingDegrees(HERE, { lon: -96.5, lat: 35.5 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(HERE, { lon: -97.5, lat: 34.5 })).toBeCloseTo(180, 1);
    expect(bearingDegrees(HERE, { lon: -98.5, lat: 35.5 })).toBeCloseTo(270, 0);
  });

  it("names each eighth of the compass, and wraps at both ends", () => {
    expect(compassPoint(0)).toBe("north");
    expect(compassPoint(45)).toBe("northeast");
    expect(compassPoint(225)).toBe("southwest");
    // 359 is north, not northwest: the rounding has to wrap rather than clamp.
    expect(compassPoint(359)).toBe("north");
    expect(compassPoint(-45)).toBe("northwest");
    expect(compassPoint(720)).toBe("north");
  });
});

describe("the storms near a place", () => {
  it("puts the nearest first whatever order they arrive in", () => {
    const far = cell({ id: "FAR", latitude: 37 });
    const near = cell({ id: "NEAR", latitude: 35.6 });
    const middle = cell({ id: "MID", latitude: 36 });
    const found = nearbyCells([far, near, middle], HERE);
    expect(found.map((one) => one.id)).toEqual(["NEAR", "MID", "FAR"]);
    expect(found[0].miles).toBeLessThan(found[1].miles);
  });

  it("stops at four, because a list read aloud has to be held in the head", () => {
    const many = Array.from({ length: 12 }, (_, at) =>
      cell({ id: `C${at}`, latitude: 35.6 + at * 0.1 }),
    );
    expect(nearbyCells(many, HERE)).toHaveLength(NEARBY_LIMIT);
  });

  it("says where it is, where it is going, and how fast", () => {
    const [said] = nearbyCells(
      [
        cell({
          id: "A1",
          latitude: 35.5,
          longitude: -98.2,
          directionDegrees: 90,
          speedMs: 20,
        }),
      ],
      HERE,
    );
    expect(said.sentence).toContain("A1");
    expect(said.sentence).toContain("west");
    expect(said.sentence).toContain("Moving east");
    expect(said.sentence).toContain("45 mph");
  });

  it("says a storm is new rather than inventing a track for it", () => {
    const [said] = nearbyCells(
      [cell({ id: "B2", directionDegrees: null, speedMs: null })],
      HERE,
    );
    expect(said.sentence).toContain("no track yet");
    expect(said.sentence).not.toContain("Moving");
  });

  it("mentions rotation only for the cells the radar found it in", () => {
    const found = nearbyCells(
      [cell({ id: "A1" }), cell({ id: "B2", latitude: 35.7 })],
      HERE,
      { rotating: new Set(["A1"]) },
    );
    expect(found[0].sentence).toContain("rotation");
    expect(found[1].sentence).not.toContain("rotation");
  });

  it("speaks the reader's own units rather than always miles an hour", () => {
    setUnits("metric");
    const [said] = nearbyCells(
      [cell({ id: "A1", latitude: 36.5, speedMs: 20 })],
      HERE,
    );
    expect(said.sentence).toContain("km/h");
    expect(said.sentence).toContain("km");
    expect(said.sentence).not.toContain("mph");
  });

  it("speaks the reader's own language", async () => {
    await ensureLanguage("es");
    setLanguage("es");
    const [said] = nearbyCells([cell({ id: "A1", latitude: 36.5 })], HERE);
    expect(said.sentence).toContain("norte");
  });
});

describe("the warnings over a place", () => {
  it("keeps the ones whose polygon holds the place and drops the rest", () => {
    const over = polygon(AROUND_HERE, { capId: "over" });
    const beside = polygon(
      [
        [-90, 35],
        [-89, 35],
        [-89, 36],
        [-90, 36],
        [-90, 35],
      ],
      { capId: "beside", headline: "Flood Warning" },
    );
    const found = warningsOver(collection([over, beside]), HERE);
    expect(found.map((one) => one.id)).toEqual(["over"]);
  });

  it("holds the order the collection arrived in, which is worst first", () => {
    const worst = polygon(AROUND_HERE, {
      capId: "worst",
      headline: "Tornado Warning",
    });
    const lesser = polygon(AROUND_HERE, {
      capId: "lesser",
      headline: "Severe Thunderstorm Warning",
    });
    const found = warningsOver(collection([worst, lesser]), HERE);
    expect(found.map((one) => one.id)).toEqual(["worst", "lesser"]);
  });

  it("reads a MultiPolygon's parts as one warning", () => {
    const split: OverlayData["features"][number] = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-90, 35],
              [-89, 35],
              [-89, 36],
              [-90, 36],
              [-90, 35],
            ],
          ],
          [AROUND_HERE],
        ],
      },
      properties: { headline: "Flood Warning", capId: "split" },
    };
    expect(warningsOver(collection([split]), HERE)).toHaveLength(1);
  });

  it("carries the office's damage tag and how long the warning runs", () => {
    const expires = Date.UTC(2026, 3, 27, 22, 30);
    const found = warningsOver(
      collection([polygon(AROUND_HERE, { impact: "considerable", expires })]),
      HERE,
    );
    expect(found[0].sentence).toContain("considerable damage");
    expect(found[0].sentence).toContain("In force until");
  });

  it("says nothing about an expiry it was not given", () => {
    const found = warningsOver(collection([polygon(AROUND_HERE)]), HERE);
    expect(found[0].sentence).toBe("Tornado Warning.");
  });

  it("answers an empty question with an empty list rather than throwing", () => {
    expect(warningsOver(null, HERE)).toEqual([]);
    expect(warningsOver(collection([]), HERE)).toEqual([]);
  });
});

describe("the line a screen reader hears", () => {
  it("leads with the warnings and adds only the nearest storm", () => {
    const warnings = warningsOver(collection([polygon(AROUND_HERE)]), HERE);
    const cells = nearbyCells(
      [cell({ id: "A1", latitude: 35.6 }), cell({ id: "B2", latitude: 36.4 })],
      HERE,
    );
    const said = nearbySummary(warnings, cells, "Home");
    expect(said.indexOf("Tornado Warning")).toBeLessThan(said.indexOf("A1"));
    expect(said).not.toContain("B2");
  });

  it("says so plainly when there is nothing to say", () => {
    expect(nearbySummary([], [], "Home")).toBe("Nothing near Home right now.");
  });
});

import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  cellFeatures,
  minutesUntilArrival,
  rotatingCells,
  soonestArrival,
  type CellReport,
  type StormCell,
} from "./cells";

/** A cell at a place, going a way, at a speed. */
function cell(overrides: Partial<StormCell> = {}): StormCell {
  return {
    id: "Y6",
    latitude: 35.0,
    longitude: -97.0,
    rangeKm: 50,
    azimuthDegrees: 180,
    directionDegrees: 90,
    speedMs: 10,
    forecast: [],
    past: [],
    ...overrides,
  };
}

const DES_MOINES = { lat: 41.7, lon: -93.7 };

describe("when a storm gets here", () => {
  it("counts only the part of the motion pointing at the place", () => {
    // Due west of the watched place, moving due east at ten metres a second.
    // A degree of longitude at 41.7 north is about 83 kilometres.
    const coming = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 90,
      speedMs: 10,
    });
    const minutes = minutesUntilArrival(coming, DES_MOINES);
    expect(minutes).not.toBeNull();
    // 83 km at 10 m/s is a little under two and a half hours.
    expect(minutes!).toBeGreaterThan(120);
    expect(minutes!).toBeLessThan(150);
  });

  it("says nothing for a storm that is going away", () => {
    // The same storm, turned round. Reporting how long it would take if it
    // came back is inventing a forecast the algorithm did not make.
    const leaving = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 270,
    });
    expect(minutesUntilArrival(leaving, DES_MOINES)).toBeNull();
  });

  it("says nothing for a storm going past rather than at", () => {
    const across = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 0,
    });
    expect(minutesUntilArrival(across, DES_MOINES)).toBeNull();
  });

  it("takes longer when the storm is only half aimed at the place", () => {
    // Forty-five degrees off is a component of about seven tenths, so the
    // same storm takes about half again as long.
    const straight = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 90,
    });
    const angled = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 45,
    });
    const one = minutesUntilArrival(straight, DES_MOINES)!;
    const other = minutesUntilArrival(angled, DES_MOINES)!;
    expect(other / one).toBeGreaterThan(1.3);
    expect(other / one).toBeLessThan(1.5);
  });

  it("says nothing for a cell the algorithm gave no motion", () => {
    // A cell it has only just found has no track to work one out from.
    expect(
      minutesUntilArrival(
        cell({ directionDegrees: null, speedMs: null }),
        DES_MOINES,
      ),
    ).toBeNull();
    expect(minutesUntilArrival(cell({ speedMs: 0 }), DES_MOINES)).toBeNull();
  });

  it("picks the soonest of the ones actually coming", () => {
    const report: CellReport = {
      station: "KDMX",
      siteLatitude: 41.7,
      siteLongitude: -93.7,
      observed: "2026-08-30T19:53:11+00:00",
      cells: [
        // Far away and coming.
        cell({ id: "A1", latitude: 41.7, longitude: -96.0 }),
        // Near and coming: this one.
        cell({ id: "B2", latitude: 41.7, longitude: -94.2 }),
        // Nearer still, and going the other way.
        cell({
          id: "C3",
          latitude: 41.7,
          longitude: -93.9,
          directionDegrees: 270,
        }),
      ],
      mesocyclones: [],
    };
    const soonest = soonestArrival(report, DES_MOINES);
    expect(soonest?.cell.id).toBe("B2");
  });

  it("has nothing to say without a watched place", () => {
    expect(soonestArrival(null, DES_MOINES)).toBeNull();
  });
});

describe("a bearing between two places", () => {
  it("points the way a compass would", () => {
    expect(
      bearingDegrees({ lat: 41, lon: -93 }, { lat: 42, lon: -93 }),
    ).toBeCloseTo(0, 1);
    expect(
      bearingDegrees({ lat: 41, lon: -93 }, { lat: 41, lon: -92 }),
    ).toBeCloseTo(90, 0);
    expect(
      bearingDegrees({ lat: 41, lon: -93 }, { lat: 40, lon: -93 }),
    ).toBeCloseTo(180, 1);
  });
});

describe("what the map is given", () => {
  const report: CellReport = {
    station: "KDMX",
    siteLatitude: 41.7,
    siteLongitude: -93.7,
    observed: "2026-08-30T19:53:11+00:00",
    cells: [
      cell({
        id: "Y6",
        latitude: 41.7,
        longitude: -93.7,
        past: [{ latitude: 41.6, longitude: -94.1 }],
        forecast: [
          { latitude: 41.75, longitude: -93.6 },
          { latitude: 41.8, longitude: -93.4 },
        ],
      }),
    ],
    mesocyclones: [
      // Two kilometres from the cell, which is inside the same storm.
      { latitude: 41.72, longitude: -93.7, radiusKm: 4, kind: "mesocyclone" },
    ],
  };

  it("draws one line through the whole track", () => {
    const drawn = cellFeatures(report, new Set()) as {
      features: Array<{
        geometry: { type: string; coordinates: number[][] };
        properties: Record<string, unknown>;
      }>;
    };
    const track = drawn.features.find(
      (feature) => feature.properties.kind === "track",
    );
    expect(track).toBeDefined();
    // Where it has been, where it is, where it is going: four points on one
    // line rather than three sets of dots.
    expect(track!.geometry.type).toBe("LineString");
    expect(track!.geometry.coordinates).toHaveLength(4);
  });

  it("names each forecast dot by how far ahead it is", () => {
    const drawn = cellFeatures(report, new Set()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    const ahead = drawn.features
      .filter((feature) => feature.properties.kind === "forecast")
      .map((feature) => feature.properties.minutes);
    expect(ahead).toEqual([15, 30]);
  });

  it("puts a rotation on the storm it is inside and not on a distant one", () => {
    expect([...rotatingCells(report)]).toEqual(["Y6"]);

    const far: CellReport = {
      ...report,
      mesocyclones: [
        // A hundred kilometres away, which is a different storm entirely.
        { latitude: 42.6, longitude: -93.7, radiusKm: 4, kind: "mesocyclone" },
      ],
    };
    expect([...rotatingCells(far)]).toEqual([]);
  });
});

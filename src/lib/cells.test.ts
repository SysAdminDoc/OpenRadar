import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  cellFeatures,
  closestApproach,
  minutesUntilArrival,
  rotatingCells,
  soonestArrival,
  unmatchedRotations,
  type CellReport,
  type StormCell,
} from "./cells";
import { haversineMiles, type GeoPoint } from "./geo";

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

/**
 * Where a storm actually is after so many minutes, walked one step at a time
 * along a great circle. Built here, from the bearing and the speed, so the
 * assertions below do not lean on the same reasoning they are checking.
 */
function walk(cell: StormCell, minutes: number) {
  const EARTH_KM = 6371.0088;
  const km = ((cell.speedMs ?? 0) * 60 * minutes) / 1000;
  const angular = km / EARTH_KM;
  const bearing = ((cell.directionDegrees ?? 0) * Math.PI) / 180;
  const lat1 = (cell.latitude * Math.PI) / 180;
  const lon1 = (cell.longitude * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/** How near the storm gets, and when, found by walking rather than by algebra. */
function walkedApproach(cell: StormCell, place: GeoPoint) {
  let best = { minutes: 0, km: Infinity };
  for (let minutes = 0; minutes <= 240; minutes += 0.25) {
    const at = walk(cell, minutes);
    const km = haversineMiles(at, place) * 1.609344;
    if (km < best.km) best = { minutes, km };
  }
  return best;
}

describe("when a storm gets here", () => {
  it("answers the moment it is nearest, not a projection of the distance", () => {
    // The sum this replaced divided the whole distance by the part of the
    // speed pointing this way, which answers "when has it gone that far along
    // its own track". For a storm forty kilometres off at forty-five degrees
    // that said forty-seven minutes; it is nearest at about twenty-four, and
    // never gets within twenty-eight kilometres.
    for (const off of [0, 10, 20, 30]) {
      const storm = cell({
        latitude: 41.7,
        longitude: -94.2,
        directionDegrees: 90 + off,
        speedMs: 20,
      });
      const found = closestApproach(storm, DES_MOINES);
      expect(found, `${off} degrees off`).not.toBeNull();
      const walked = walkedApproach(storm, DES_MOINES);
      expect(found!.minutes, `${off}: when`).toBeCloseTo(walked.minutes, 0);
      expect(found!.distanceKm, `${off}: how near`).toBeCloseTo(walked.km, 0);
    }
  });

  it("decides by how near it passes, not by the angle", () => {
    // A storm five kilometres away at sixty-one degrees off passes within
    // four and a half. One a hundred kilometres away at fifty-nine passes
    // eighty-eight away. An angle cannot tell those apart; a distance can.
    const near = cell({
      latitude: 41.7,
      longitude: -93.76,
      directionDegrees: 90 + 61,
      speedMs: 15,
    });
    const far = cell({
      latitude: 41.7,
      longitude: -94.9,
      directionDegrees: 90 + 59,
      speedMs: 15,
    });
    expect(closestApproach(near, DES_MOINES)!.distanceKm).toBeLessThan(10);
    expect(closestApproach(far, DES_MOINES)!.distanceKm).toBeGreaterThan(50);

    expect(minutesUntilArrival(near, DES_MOINES)).not.toBeNull();
    expect(minutesUntilArrival(far, DES_MOINES)).toBeNull();
  });

  it("says nothing for a storm that is going away", () => {
    const leaving = cell({
      latitude: 41.7,
      longitude: -94.7,
      directionDegrees: 270,
    });
    expect(minutesUntilArrival(leaving, DES_MOINES)).toBeNull();
    expect(closestApproach(leaving, DES_MOINES)).toBeNull();
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
    // And nothing a corrupt product could put in it either.
    expect(minutesUntilArrival(cell({ speedMs: NaN }), DES_MOINES)).toBeNull();
    expect(
      minutesUntilArrival(cell({ speedMs: Infinity }), DES_MOINES),
    ).toBeNull();
    expect(
      minutesUntilArrival(cell({ directionDegrees: NaN }), DES_MOINES),
    ).toBeNull();
  });

  it("takes the age of the volume off the answer", () => {
    // The cells say where things were when the volume was taken, and a volume
    // is minutes old by the time anybody reads it.
    const observed = Date.UTC(2026, 7, 30, 19, 53);
    const report: CellReport = {
      station: "KDMX",
      siteLatitude: 41.7,
      siteLongitude: -93.7,
      observed: new Date(observed).toISOString(),
      cells: [
        cell({
          id: "Y6",
          latitude: 41.7,
          longitude: -94.2,
          directionDegrees: 90,
          speedMs: 15,
        }),
      ],
      mesocyclones: [],
    };

    const fresh = soonestArrival(report, DES_MOINES, observed)!;
    const stale = soonestArrival(report, DES_MOINES, observed + 8 * 60_000)!;
    expect(fresh.minutes - stale.minutes).toBeCloseTo(8, 5);
    // And it never counts backwards past now.
    const ancient = soonestArrival(
      report,
      DES_MOINES,
      observed + 600 * 60_000,
    )!;
    expect(ancient.minutes).toBe(0);
  });

  it("picks the soonest of the ones actually coming", () => {
    const observed = Date.UTC(2026, 7, 30, 19, 53);
    const report: CellReport = {
      station: "KDMX",
      siteLatitude: 41.7,
      siteLongitude: -93.7,
      observed: new Date(observed).toISOString(),
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
    expect(soonestArrival(report, DES_MOINES, observed)?.cell.id).toBe("B2");
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

  it("names both storms a circulation could be inside", () => {
    // A squall line has cells ten kilometres apart. Picking the nearest alone
    // credits the rotation to whichever centroid happens to be marginally
    // closer, which is a hundred metres of arithmetic deciding which storm the
    // reader is told is rotating.
    const line: CellReport = {
      ...report,
      cells: [
        cell({ id: "A1", latitude: 41.7, longitude: -93.76 }),
        cell({ id: "A2", latitude: 41.7, longitude: -93.64 }),
      ],
      mesocyclones: [
        { latitude: 41.7, longitude: -93.7, radiusKm: 3, kind: "mesocyclone" },
      ],
    };
    expect([...rotatingCells(line)].sort()).toEqual(["A1", "A2"]);
  });

  it("keeps a circulation the tracking algorithm found no storm for", () => {
    // The two products are published on their own schedules and the tracker
    // does not find every storm a circulation sits in. Dropping those meant a
    // radar reporting six mesocyclones and a panel saying it was tracking no
    // storms at all.
    const orphan: CellReport = {
      ...report,
      cells: [],
      mesocyclones: [
        { latitude: 42.4, longitude: -93.7, radiusKm: 4, kind: "mesocyclone" },
      ],
    };
    expect(unmatchedRotations(orphan)).toHaveLength(1);
    const drawn = cellFeatures(orphan, new Set()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(
      drawn.features.filter((one) => one.properties.kind === "rotation"),
    ).toHaveLength(1);
    // And one that does belong to a storm is not drawn twice.
    expect(unmatchedRotations(report)).toHaveLength(0);
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

import { describe, expect, it } from "vitest";
import {
  nightPolygon,
  solarElevation,
  solarPosition,
  subsolarLongitude,
} from "./terminator";

/**
 * Where it is dark, checked against the sky rather than against itself.
 *
 * Every number here comes from somewhere outside this file: the solstices and
 * equinoxes, the equation of time's own well-known extremes, and the fact that
 * the sun is up at midday and down at midnight wherever you stand. A test that
 * only compared this code to itself would pass on any consistent nonsense, and
 * shading the lit half of the world is exactly the sort of nonsense that is
 * consistent.
 */

const noon = (iso: string) => Date.parse(iso);

describe("where the sun is", () => {
  it("stands over the tropics at the solstices and the equator at the equinoxes", () => {
    // The obliquity of the ecliptic, 23.44 degrees, is what the tropics are.
    const june = solarPosition(noon("2026-06-21T12:00:00Z")).declination;
    expect(june).toBeGreaterThan(23.3);
    expect(june).toBeLessThan(23.5);

    const december = solarPosition(noon("2026-12-21T12:00:00Z")).declination;
    expect(december).toBeLessThan(-23.3);
    expect(december).toBeGreaterThan(-23.5);

    // Within a day of the equinox the sun is within half a degree of the
    // equator, which is as close as a fixed date gets.
    for (const equinox of ["2026-03-20T12:00:00Z", "2026-09-22T12:00:00Z"]) {
      expect(Math.abs(solarPosition(noon(equinox)).declination)).toBeLessThan(
        0.5,
      );
    }
  });

  it("runs ahead of and behind the clock by the amounts the analemma has", () => {
    // The equation of time's two extremes: about fourteen minutes behind in
    // February and about sixteen ahead at the start of November.
    const february = solarPosition(noon("2026-02-11T12:00:00Z")).equationOfTime;
    expect(february).toBeLessThan(-13);
    expect(february).toBeGreaterThan(-15);

    const november = solarPosition(noon("2026-11-03T12:00:00Z")).equationOfTime;
    expect(november).toBeGreaterThan(15);
    expect(november).toBeLessThan(17);

    // And it passes through zero four times a year, twice of them here.
    for (const crossing of ["2026-04-15T12:00:00Z", "2026-09-01T12:00:00Z"]) {
      expect(
        Math.abs(solarPosition(noon(crossing)).equationOfTime),
      ).toBeLessThan(1.5);
    }
  });

  it("stands over the meridian at noon UTC, give or take the equation of time", () => {
    // Sixteen minutes of clock is four degrees of longitude, so this is the
    // widest the offset ever gets.
    const at = subsolarLongitude(noon("2026-09-05T12:00:00Z"));
    expect(Math.abs(at)).toBeLessThan(5);

    // Six hours later it has run a quarter of the way round, westward.
    const later = subsolarLongitude(noon("2026-09-05T18:00:00Z"));
    expect(later).toBeGreaterThan(-95);
    expect(later).toBeLessThan(-85);
  });

  it("stays inside the half-open range, whatever hour it is asked about", () => {
    // A longitude of 183 draws a polygon that crosses the antimeridian the
    // long way round: a band of night over the whole Pacific.
    for (let hour = 0; hour < 24; hour += 1) {
      const at = subsolarLongitude(
        noon(`2026-09-05T${String(hour).padStart(2, "0")}:00:00Z`),
      );
      expect(at, `${hour}Z`).toBeGreaterThanOrEqual(-180);
      expect(at, `${hour}Z`).toBeLessThanOrEqual(180);
    }
  });

  it("is up at midday and down at midnight, wherever you stand", () => {
    // Des Moines, at its own local noon and its own local midnight.
    const midday = solarElevation(noon("2026-09-05T18:00:00Z"), 41.6, -93.6);
    const midnight = solarElevation(noon("2026-09-05T06:00:00Z"), 41.6, -93.6);
    expect(midday).toBeGreaterThan(40);
    expect(midnight).toBeLessThan(-40);
  });

  it("keeps the poles lit and dark for their own half of the year", () => {
    // The midnight sun, and the polar night on the same day at the other end.
    const at = noon("2026-06-21T00:00:00Z");
    expect(solarElevation(at, 89, 0)).toBeGreaterThan(0);
    expect(solarElevation(at, -89, 0)).toBeLessThan(0);
  });
});

describe("the shape drawn over the dark half", () => {
  it("closes over the pole that has no sun on it", () => {
    // In the northern summer the south pole is the dark one. Closing over the
    // north instead shades the lit half of the world, which is the one way
    // this can be wrong and still look like a terminator.
    const june = nightPolygon(noon("2026-06-21T12:00:00Z"));
    const southerly = june.geometry.coordinates[0].some(
      ([, latitude]) => latitude === -90,
    );
    expect(southerly).toBe(true);

    const december = nightPolygon(noon("2026-12-21T12:00:00Z"));
    expect(
      december.geometry.coordinates[0].some(([, latitude]) => latitude === 90),
    ).toBe(true);
  });

  it("covers the places where the sun is down and not the ones where it is up", () => {
    const at = noon("2026-09-05T06:00:00Z");
    const ring = nightPolygon(at).geometry.coordinates[0];
    // Walk the edge and check each vertex is the horizon: the sun should sit
    // within a fraction of a degree of it all the way round.
    for (const [longitude, latitude] of ring) {
      if (Math.abs(latitude) === 90) continue;
      expect(
        Math.abs(solarElevation(at, latitude, longitude)),
        `${longitude},${latitude}`,
      ).toBeLessThan(0.5);
    }
  });

  it("goes all the way round and closes", () => {
    const ring = nightPolygon(noon("2026-09-05T12:00:00Z")).geometry
      .coordinates[0];
    expect(ring[0][0]).toBe(-180);
    expect(ring.at(-1)).toEqual(ring[0]);
    // Every longitude, at the step the edge is walked at.
    expect(ring.length).toBeGreaterThan(360);
  });
});

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCounties, resetCounties } from "./counties";

afterEach(() => {
  resetCounties();
  vi.restoreAllMocks();
});

describe("the outlines the app ships with", () => {
  const path = join(process.cwd(), "public", "counties.json");

  it("stays small enough to bundle", () => {
    // A megabyte is the whole budget for something switched off by default
    // and drawn as reference geography. The build script refuses past this
    // too; this is the half that fails if somebody commits a file the script
    // did not produce.
    expect(statSync(path).size).toBeLessThanOrEqual(1024 * 1024);
  });

  it("holds the country's outlines and says whose they are", () => {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      features: Array<{
        properties: { source: string };
        geometry: { type: string; coordinates: number[][][] };
      }>;
    };
    expect(parsed.features).toHaveLength(1);
    const [feature] = parsed.features;
    expect(feature.geometry.type).toBe("MultiLineString");
    // Three thousand-odd counties. Fewer than three thousand outlines is not
    // the country, whatever else it is.
    expect(feature.geometry.coordinates.length).toBeGreaterThan(3000);
    // The credit travels with the data rather than living only in a ledger
    // somebody has to remember to look at.
    expect(feature.properties.source).toContain("Census");

    // Every ring is a ring, and every point is on the planet.
    for (const ring of feature.geometry.coordinates) {
      expect(ring.length).toBeGreaterThan(2);
      for (const [lon, lat] of ring) {
        expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe("reading them", () => {
  it("reads the file once and keeps it", async () => {
    // A megabyte parsed on every switch of a checkbox.
    const fetching = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response('{"type":"FeatureCollection","features":[]}'),
      );
    await loadCounties();
    await loadCounties();
    expect(fetching).toHaveBeenCalledTimes(1);
  });

  it("does not remember a read that failed", async () => {
    // Remembered, the switch works once and then draws nothing for the life
    // of the window, with no way for the reader to ask again.
    const fetching = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(
        new Response('{"type":"FeatureCollection","features":[]}'),
      );
    await expect(loadCounties()).rejects.toThrow();
    await expect(loadCounties()).resolves.toBeTruthy();
    expect(fetching).toHaveBeenCalledTimes(2);
  });
});

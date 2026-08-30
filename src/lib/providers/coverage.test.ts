import { describe, expect, it } from "vitest";
import { nowcoastProvider } from "./nowcoast";
import { ridgeProvider } from "./ridge";
import { mrmsProvider } from "./mrms";
import type { RadarProvider } from "./types";

/**
 * Which source answers for a place, and whether it has anything to draw there.
 *
 * A provider that claims coverage it does not have is worse than one that
 * claims none: the chain stops at the first source that says yes, so a
 * too-wide box means the map shows nothing at all rather than falling through
 * to something that would have worked.
 */
function covers(
  provider: Pick<RadarProvider, "coverage">,
  lon: number,
  lat: number,
): boolean {
  return provider.coverage.some(
    (box) =>
      lon >= box.west &&
      lon <= box.east &&
      lat >= box.south &&
      lat <= box.north,
  );
}

const PLACES: Array<[string, number, number]> = [
  ["Des Moines", -93.6, 41.6],
  ["Oklahoma City", -97.5, 35.5],
  ["Miami", -80.2, 25.8],
  ["Seattle", -122.3, 47.6],
  ["Anchorage", -149.9, 61.2],
  ["Honolulu", -157.9, 21.3],
  ["San Juan", -66.1, 18.4],
  ["Guam", 144.8, 13.5],
  ["London", -0.1, 51.5],
  ["Sydney", 151.2, -33.9],
];

function where(provider: Pick<RadarProvider, "coverage">) {
  return Object.fromEntries(
    PLACES.map(([name, lon, lat]) => [name, covers(provider, lon, lat)]),
  );
}

describe("what each radar source says it can draw", () => {
  it("keeps RIDGE II to the lower forty-eight", () => {
    // The mosaic is the CONUS land extent. A wider box would claim the Gulf,
    // Cuba and the Bahamas, where it has nothing at all.
    const found = where(ridgeProvider);
    expect(found["Des Moines"]).toBe(true);
    expect(found["Oklahoma City"]).toBe(true);
    expect(found["Seattle"]).toBe(true);
    expect(found["Anchorage"]).toBe(false);
    expect(found["Honolulu"]).toBe(false);
    expect(found["San Juan"]).toBe(false);
    expect(found["Guam"]).toBe(false);
    expect(found["London"]).toBe(false);
  });

  it("lets nowCOAST answer for the places RIDGE II cannot", () => {
    // This is the whole reason nowCOAST is in the chain twice over: it is the
    // failover for the lower forty-eight and the only source offshore.
    const found = where(nowcoastProvider);
    expect(found["Des Moines"]).toBe(true);
    expect(found["Anchorage"]).toBe(true);
    expect(found["Honolulu"]).toBe(true);
    expect(found["San Juan"]).toBe(true);
    expect(found["Guam"]).toBe(true);
    // And still nothing outside the country's radar network.
    expect(found["London"]).toBe(false);
    expect(found["Sydney"]).toBe(false);
  });

  it("gives every offshore place somebody to ask", () => {
    // Anywhere the United States has radar has to be answered by something,
    // or the map falls through the whole chain to a personal-use tier.
    for (const name of ["Anchorage", "Honolulu", "San Juan", "Guam"]) {
      const [, lon, lat] = PLACES.find(([place]) => place === name)!;
      expect(
        covers(ridgeProvider, lon, lat) ||
          covers(nowcoastProvider, lon, lat) ||
          covers(mrmsProvider, lon, lat),
        name,
      ).toBe(true);
    }
  });

  it("writes every box the right way round", () => {
    // A box with its west past its east, or its south past its north, matches
    // nothing and would silently take a source out of the chain.
    for (const provider of [ridgeProvider, nowcoastProvider, mrmsProvider]) {
      for (const box of provider.coverage) {
        expect(box.west, provider.id).toBeLessThan(box.east);
        expect(box.south, provider.id).toBeLessThan(box.north);
        expect(box.west).toBeGreaterThanOrEqual(-180);
        expect(box.east).toBeLessThanOrEqual(180);
        expect(box.south).toBeGreaterThanOrEqual(-90);
        expect(box.north).toBeLessThanOrEqual(90);
      }
    }
  });

  it("gives each source a budget it could actually spend", () => {
    // A limit of nothing would refuse every tile and draw an empty map with no
    // error, which is the hardest kind of failure to notice.
    for (const provider of [ridgeProvider, nowcoastProvider, mrmsProvider]) {
      expect(provider.tileBudgetLimit, provider.id).toBeGreaterThan(0);
      expect(provider.discoveryBudgetLimit, provider.id).toBeGreaterThan(0);
      expect(provider.budgetWindowMs, provider.id).toBeGreaterThan(0);
    }
  });

  it("names a host that matches the address it fetches from", () => {
    // The host is what the native cache and the content policy are keyed on.
    // A mismatch means every request is refused at a boundary rather than at
    // the service, and the layer disappears with nothing said.
    for (const provider of [ridgeProvider, nowcoastProvider]) {
      expect(provider.host, provider.id).toBeTruthy();
      expect(provider.attributionUrl, provider.id).toContain(provider.host);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { nowcoastProvider } from "./nowcoast";
import { ridgeProvider } from "./ridge";
import { mrmsProvider } from "./mrms";
import { coverageKey } from "./index";
import { covers, type RadarProvider } from "./types";

// The national grids are decoded natively, so a browser preview never reaches
// them and the whole question of which one is being watched does not arise.
// The bug this file covers only exists on the desktop, so that is what is
// measured here.
vi.mock("../settings", async (original) => ({
  ...(await original<typeof import("../settings")>()),
  isDesktopRuntime: () => true,
}));

/**
 * Which source answers for a place, and whether it has anything to draw there.
 *
 * A provider that claims coverage it does not have is worse than one that
 * claims none: the chain stops at the first source that says yes, so a
 * too-wide box means the map shows nothing at all rather than falling through
 * to something that would have worked.
 *
 * This used to define its own copy of `covers` rather than import the real
 * one, so it went on passing with the real one replaced by `return true` and
 * with MRMS claiming the whole globe.
 */

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

function where(provider: RadarProvider) {
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

  it("keeps the national grids to the places they are published for", () => {
    // Five regions, none of them abroad. A provider claiming more than it has
    // is worse than one claiming none: the chain stops at the first source
    // that says yes, so a box over London means an empty map there rather
    // than falling through to something that would have drawn it.
    const found = where(mrmsProvider);
    expect(found["Anchorage"]).toBe(true);
    expect(found["Honolulu"]).toBe(true);
    expect(found["San Juan"]).toBe(true);
    expect(found["Guam"]).toBe(true);
    expect(found["Oklahoma City"]).toBe(true);
    expect(found["London"]).toBe(false);
    expect(found["Sydney"]).toBe(false);
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

describe("what a refetch is triggered by", () => {
  // A timeline is refetched when this string changes and at no other time.
  const PLACES: Array<[string, number, number]> = [
    ["Oklahoma City", -97.5, 35.5],
    ["Anchorage", -149.9, 61.2],
    ["Honolulu", -157.9, 21.3],
    ["Hagatna", 144.75, 13.47],
    ["San Juan", -66.1, 18.4],
  ];

  it("tells the five national grids apart", () => {
    // They are separate grids at separate resolutions on separate keys, and
    // the same chain of providers answers for all of them. Without the region
    // in the key, panning from Honolulu to Anchorage refetched nothing and the
    // map went on asking for /HAWAII/ tiles over Alaska, which come back
    // empty for as long as the loop lives.
    const keys = PLACES.map(([, lon, lat]) => coverageKey(lon, lat));
    expect(new Set(keys).size).toBe(PLACES.length);
    for (const [place, lon, lat] of PLACES) {
      expect(coverageKey(lon, lat), place).toContain("mrms/");
    }
  });

  it("changes between every pair of them", () => {
    for (const [fromName, fromLon, fromLat] of PLACES) {
      for (const [toName, toLon, toLat] of PLACES) {
        if (fromName === toName) continue;
        expect(
          coverageKey(fromLon, fromLat),
          `${fromName} to ${toName}`,
        ).not.toBe(coverageKey(toLon, toLat));
      }
    }
  });

  it("does not change for a pan inside one grid", () => {
    // The other half of it: a refetch on every pan would re-list the bucket
    // for a frame list that has not changed.
    expect(coverageKey(-97.5, 35.5)).toBe(coverageKey(-93.6, 41.6));
    expect(coverageKey(-97.5, 35.5)).toBe(coverageKey(-80.2, 25.8));
  });

  it("still separates places served by different providers", () => {
    // Winnipeg is GeoMet, London is RainViewer, Oklahoma City is the mosaic.
    const winnipeg = coverageKey(-97.1, 49.9);
    const london = coverageKey(-0.1, 51.5);
    const oklahoma = coverageKey(-97.5, 35.5);
    expect(new Set([winnipeg, london, oklahoma]).size).toBe(3);
  });
});

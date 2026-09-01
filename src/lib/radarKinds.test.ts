import { describe, expect, it } from "vitest";
import {
  isTdwrStation,
  radarCapabilities,
  supportedProduct,
  TDWR_LONG_RANGE_KM,
  TDWR_RANGE_KM,
  TDWR_SITES,
  WSR88D_RANGE_KM,
} from "./radarKinds";
import { LEVEL2_PRODUCTS } from "./level2";

describe("which radars are terminal radars", () => {
  it("knows the forty-seven from the official list, by id", () => {
    expect(TDWR_SITES).toHaveLength(47);
    const ids = new Set(TDWR_SITES.map((site) => site.id));
    expect(ids.size).toBe(47);
    for (const site of TDWR_SITES) {
      expect(site.id).toMatch(/^T[A-Z]{3}$/);
      expect(site.latitude).toBeGreaterThan(17);
      expect(site.latitude).toBeLessThan(50);
      expect(site.longitude).toBeLessThan(-60);
      expect(site.name.length).toBeGreaterThan(0);
      expect(site.state).toHaveLength(2);
    }
    expect(isTdwrStation("TDAL")).toBe(true);
    expect(isTdwrStation("tdal")).toBe(true);
    expect(isTdwrStation("KTLX")).toBe(false);
    expect(isTdwrStation("TXXX")).toBe(false);
    expect(isTdwrStation(null)).toBe(false);
  });
});

describe("what a radar can be asked for", () => {
  it("gives a WSR-88D every Level II product and its full reach", () => {
    const wsr = radarCapabilities("KDMX");
    expect(wsr.radar).toBe("WSR-88D");
    expect(wsr.rangeKm).toBe(WSR88D_RANGE_KM);
    expect(wsr.longRangeKm).toBeNull();
    // Everything in the list except the one product that is a terminal
    // radar's alone.
    expect(wsr.products).toEqual(
      LEVEL2_PRODUCTS.map((product) => product.id).filter(
        (id) => id !== "long-range-reflectivity",
      ),
    );
    expect(wsr.products).toContain("differential-reflectivity");
    // Following the map is a WSR-88D too: the nearest-site search only ever
    // hands one of those over.
    expect(radarCapabilities(null).radar).toBe("WSR-88D");
  });

  it("gives a terminal radar reflectivity and velocity and its shorter reach", () => {
    const tdwr = radarCapabilities("TDAL");
    expect(tdwr.radar).toBe("TDWR");
    expect(tdwr.products).toEqual([
      "reflectivity",
      "velocity",
      "long-range-reflectivity",
    ]);
    expect(tdwr.rangeKm).toBe(TDWR_RANGE_KM);
    expect(tdwr.longRangeKm).toBe(TDWR_LONG_RANGE_KM);
    expect(tdwr.products).not.toContain("spectrum-width");
    expect(tdwr.products).not.toContain("correlation-coefficient");
  });

  it("asks a radar only for what it has, and reflectivity otherwise", () => {
    expect(supportedProduct("TDAL", "velocity")).toBe("velocity");
    expect(supportedProduct("TDAL", "long-range-reflectivity")).toBe(
      "long-range-reflectivity",
    );
    expect(supportedProduct("TDAL", "spectrum-width")).toBe("reflectivity");
    expect(supportedProduct("TDAL", "differential-reflectivity")).toBe(
      "reflectivity",
    );
    expect(supportedProduct("KDMX", "long-range-reflectivity")).toBe(
      "reflectivity",
    );
    expect(supportedProduct("KDMX", "spectrum-width")).toBe("spectrum-width");
    expect(supportedProduct(null, "velocity")).toBe("velocity");
  });
});

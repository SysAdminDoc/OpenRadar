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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { level2Source } from "../test/rustSource";

describe("how far each radar reaches, on both sides", () => {
  it("says the same three distances the native side draws with", () => {
    // These three used to be a copy nothing compared. Then they became the
    // key of the disc record, so a wrong one hands one product's ground to
    // another and the box is measured against a circle nobody is drawing.
    // The tests beside this one compare each constant to itself: they say
    // `radarCapabilities` returns the constant, not that the constant is
    // right, so doubling a WSR-88D's reach to 460 left the whole suite green.
    //
    // Both are 230 kilometres because the same circle is drawn twice, once
    // on each side of the boundary. Read out of the source rather than
    // trusted, the way the raster size and the loop clamp are.
    const level2 = level2Source();
    const tdwr = readFileSync(
      join(process.cwd(), "src-tauri", "src", "tdwr.rs"),
      "utf8",
    ).replace(/\/\/.*/g, "");
    const said = (source: string, name: string, kind: string) => {
      // `String.raw`, because a template literal eats the backslash: written
      // plainly, `[\d._]` reaches the engine as `[d._]` and matches nothing
      // with a digit in it, which is every number this is here to read.
      const found = new RegExp(
        String.raw`const ${name}: ${kind} = ([\d._]+);`,
      ).exec(source);
      expect(found, `${name} is gone from the native side`).not.toBeNull();
      return Number(found![1].replace(/_/g, ""));
    };
    expect(said(level2, "MAX_RANGE_KM", "f64")).toBe(WSR88D_RANGE_KM);
    expect(said(tdwr, "BASE_RANGE_KM", "f64")).toBe(TDWR_RANGE_KM);
    expect(said(tdwr, "LONG_RANGE_KM", "f64")).toBe(TDWR_LONG_RANGE_KM);
  });
});

describe("which radars are terminal radars", () => {
  it("knows the forty-five from the official list, by id", () => {
    // Forty-five, not the forty-seven NCEI's historical station file carries:
    // TJBQ and TJRV answer 404 at the station endpoint and have published no
    // product in a year, so they are not radars a reader can hold.
    expect(TDWR_SITES).toHaveLength(45);
    const ids = new Set(TDWR_SITES.map((site) => site.id));
    expect(ids.size).toBe(45);
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

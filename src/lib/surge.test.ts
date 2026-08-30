import { describe, expect, it } from "vitest";
import {
  SURGE_CATEGORIES,
  SURGE_RAMP,
  isSurgeCategory,
  surgeCategoryKey,
  surgeTileUrl,
} from "./surge";
import { en } from "../i18n/en";

describe("the storm surge risk picture", () => {
  it("asks for a bounding box the map can fill in", () => {
    const url = surgeTileUrl(3);
    // MapLibre substitutes this token per tile. Encoded, the service would be
    // asked for a bounding box named after the token and answer with nothing.
    expect(url).toContain("bbox={bbox-epsg-3857}");
    expect(url).not.toContain("%7Bbbox");
    expect(url).toContain("f=image");
    expect(url).toContain("transparent=true");
    expect(url.startsWith("https://mapservices.weather.noaa.gov/")).toBe(true);
  });

  it("draws every coast NOAA mapped for that strength", () => {
    // One category is a picture per region, so naming only the first would
    // leave Puerto Rico, Hawaii, and Guam blank on a map that claims to cover
    // them.
    const one = new URL(surgeTileUrl(1)).searchParams.get("layers")!;
    expect(one.startsWith("show:")).toBe(true);
    expect(one.slice(5).split(",").length).toBe(8);

    // And a category no coast was mapped at does not name a layer from the
    // one below it: Southern California stops at two, Hawaii at four.
    const five = new URL(surgeTileUrl(5)).searchParams.get("layers")!;
    expect(five.slice(5).split(",").length).toBe(6);
  });

  it("names a different set of layers for each category", () => {
    const seen = new Set<string>();
    for (const category of SURGE_CATEGORIES) {
      const layers = new URL(surgeTileUrl(category)).searchParams.get(
        "layers",
      )!;
      expect(seen.has(layers), `category ${category} repeats a set`).toBe(
        false,
      );
      seen.add(layers);
    }
    expect(seen.size).toBe(5);
  });

  it("has a name for every category and every band of water", () => {
    for (const category of SURGE_CATEGORIES) {
      expect(
        en[surgeCategoryKey(category)],
        `category ${category}`,
      ).toBeTruthy();
    }
    for (const [, key] of SURGE_RAMP) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
    }
  });

  it("takes only a real category", () => {
    expect(isSurgeCategory(1)).toBe(true);
    expect(isSurgeCategory(5)).toBe(true);
    expect(isSurgeCategory(0)).toBe(false);
    expect(isSurgeCategory(6)).toBe(false);
    expect(isSurgeCategory("3")).toBe(false);
    expect(isSurgeCategory(null)).toBe(false);
  });
});

const live = process.env.OPENRADAR_LIVE ? describe : describe.skip;

live("against the National Hurricane Center itself", () => {
  it("draws water over the Louisiana coast for every category", async () => {
    // A box over Barataria Bay, where the surge maps have plenty to say.
    const bbox = "-10080000,3430000,-10000000,3500000";
    for (const category of SURGE_CATEGORIES) {
      const url = surgeTileUrl(category).replace("{bbox-epsg-3857}", bbox);
      const response = await fetch(url);
      expect(response.status, `category ${category}`).toBe(200);
      expect(response.headers.get("content-type")).toContain("image");
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A PNG, and one with something in it: an empty tile from this service
      // comes back well under a kilobyte.
      expect(bytes.slice(0, 4)).toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );
      expect(
        bytes.length,
        `category ${category} came back empty`,
      ).toBeGreaterThan(2000);
    }
  }, 60_000);
});

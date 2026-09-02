import { describe, expect, it } from "vitest";
import {
  SATELLITE_LATENCY_SECONDS,
  SATELLITE_PRODUCTS,
  SATELLITE_STEP_SECONDS,
  satelliteFrameTime,
  satelliteProduct,
  satelliteTileUrl,
} from "./satellite";

const now = Date.parse("2026-08-30T08:05:00Z") / 1000;
const LIVE = process.env.OPENRADAR_LIVE === "1";

describe("satellite frame time", () => {
  it("snaps an older frame back to its published slot", () => {
    const frame = Date.parse("2026-08-30T06:47:00Z") / 1000;
    expect(satelliteFrameTime(frame, now)).toBe(
      Date.parse("2026-08-30T06:40:00Z") / 1000,
    );
  });

  it("never asks for a slot the archive has not published", () => {
    const frame = Date.parse("2026-08-30T08:04:00Z") / 1000;
    const resolved = satelliteFrameTime(frame, now);
    expect(resolved).toBeLessThanOrEqual(now - SATELLITE_LATENCY_SECONDS);
    expect(resolved % SATELLITE_STEP_SECONDS).toBe(0);
    expect(new Date(resolved * 1000).toISOString()).toBe(
      "2026-08-30T07:10:00.000Z",
    );
  });

  it("addresses one image with a whole-second timestamp", () => {
    expect(satelliteTileUrl(Date.parse("2026-08-30T07:20:00Z") / 1000)).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
    );
  });
});

describe("the two views of the same satellite", () => {
  it("addresses the infrared band at its own layer and matrix set", () => {
    // Band 13 is published one zoom shallower than GeoColor, which is why a
    // switch rebuilds the source rather than pointing it somewhere else.
    expect(
      satelliteTileUrl(Date.parse("2026-08-30T07:20:00Z") / 1000, "clean-ir"),
    ).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",
    );
    expect(satelliteProduct("clean-ir").maxZoom).toBe(6);
    expect(satelliteProduct("geocolor").maxZoom).toBe(7);
  });

  it("falls back to the daylight picture for a product it does not have", () => {
    // A settings file from a build with a product this one has never heard of
    // draws something rather than nothing.
    expect(
      satelliteProduct("brand-new" as (typeof SATELLITE_PRODUCTS)[number]["id"])
        .id,
    ).toBe("geocolor");
    expect(
      satelliteTileUrl(
        Date.parse("2026-08-30T07:20:00Z") / 1000,
        "brand-new" as (typeof SATELLITE_PRODUCTS)[number]["id"],
      ),
    ).toContain("GOES-East_ABI_GeoColor");
  });

  it("keeps one timeline for both", () => {
    // Same service, same ten-minute cadence, same hold-back: switching the
    // product must not move any frame the timeline is showing.
    const frame = Date.parse("2026-08-30T06:47:00Z") / 1000;
    const slot = satelliteFrameTime(frame, now);
    for (const product of SATELLITE_PRODUCTS) {
      const url = satelliteTileUrl(slot, product.id);
      expect(url).toContain("2026-08-30T06:40:00Z");
      expect(url).toContain(product.layer);
      expect(url.endsWith("/{z}/{y}/{x}.png")).toBe(true);
    }
  });

  it("says what each one is, and says which is a measurement", () => {
    for (const product of SATELLITE_PRODUCTS) {
      expect(product.key.startsWith("satellite.")).toBe(true);
      expect(product.legendKey.startsWith("satellite.")).toBe(true);
    }
    // The infrared band carries a scale, and the legend has to say so:
    // reading a temperature off GeoColor is reading one off a rendering.
    expect(satelliteProduct("clean-ir").legendKey).toBe(
      "satellite.cleanIrLegend",
    );
  });
});

describe.runIf(LIVE)("against the live service", () => {
  // Both products, at a slot the hold-back says is published, through the
  // same address the map builds.
  it.each(SATELLITE_PRODUCTS.map((product) => product.id))(
    "%s answers with an image",
    async (id) => {
      const slot = satelliteFrameTime(
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
      );
      const url = satelliteTileUrl(slot, id)
        .replace("{z}", "4")
        .replace("{y}", "6")
        .replace("{x}", "4");
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/");
      const bytes = await response.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(1000);
    },
    30_000,
  );
});

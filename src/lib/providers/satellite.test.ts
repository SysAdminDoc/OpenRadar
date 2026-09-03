import { describe, expect, it } from "vitest";
import {
  SATELLITE_BANDS,
  SATELLITE_LATENCY_SECONDS,
  SATELLITE_STEP_SECONDS,
  SPACECRAFT,
  bandFor,
  publishes,
  satelliteBand,
  satelliteBands,
  satelliteFrameTime,
  satelliteProduct,
  satelliteProductId,
  satelliteTileUrl,
  spacecraftFor,
  type SatelliteBandId,
  type SatelliteProductId,
} from "./satellite";

const now = Date.parse("2026-08-30T08:05:00Z") / 1000;
const LIVE = process.env.OPENRADAR_LIVE === "1";

/** Every satellite paired with every band it actually publishes. */
const EVERY_PRODUCT: SatelliteProductId[] = SPACECRAFT.flatMap((spacecraft) =>
  SATELLITE_BANDS.filter((band) => publishes(spacecraft, band)).map((band) =>
    satelliteProductId(spacecraft, band),
  ),
);

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

describe("which satellite is looking at a longitude", () => {
  it("hands over at the midpoint between the two GOES", () => {
    // Half way between 75.2 west and 137.2 west. A reader in Seattle watching
    // the Pacific through GOES-East is looking at the edge of a disk from
    // over Brazil, which is the whole reason this exists.
    expect(spacecraftFor(-80)).toBe("east");
    expect(spacecraftFor(-106)).toBe("east");
    expect(spacecraftFor(-106.5)).toBe("west");
    expect(spacecraftFor(-122.3)).toBe("west"); // Seattle
    expect(spacecraftFor(-80.2)).toBe("east"); // Miami
  });

  it("hands over to Himawari across the Pacific", () => {
    expect(spacecraftFor(-170)).toBe("west");
    expect(spacecraftFor(-179)).toBe("himawari");
    expect(spacecraftFor(139.7)).toBe("himawari"); // Tokyo
    expect(spacecraftFor(151.2)).toBe("himawari"); // Sydney
  });

  it("answers for a longitude somebody wrapped the long way round", () => {
    // A camera that has been dragged twice round the globe holds a longitude
    // outside the usual range, and picking a satellite from it unwrapped
    // would put GOES-East over Japan.
    expect(spacecraftFor(-122.3 + 360)).toBe("west");
    expect(spacecraftFor(139.7 - 360)).toBe("himawari");
    expect(spacecraftFor(-80.2 - 720)).toBe("east");
  });
});

describe("the bands each satellite carries", () => {
  it("addresses every one at its own layer and matrix set", () => {
    // A layer asked for in a matrix set it is not published in answers 400 for
    // every tile, which draws nothing and says nothing.
    const url = (id: SatelliteProductId) =>
      satelliteTileUrl(Date.parse("2026-08-30T07:20:00Z") / 1000, id);
    expect(url("east:clean-ir")).toContain(
      "GOES-East_ABI_Band13_Clean_Infrared/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level6",
    );
    expect(url("west:geocolor")).toContain(
      "GOES-West_ABI_GeoColor/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level7",
    );
    expect(url("west:fire-temp")).toContain("GOES-West_ABI_FireTemp");
    expect(url("east:dust")).toContain("GOES-East_ABI_Dust");
    expect(url("east:air-mass")).toContain(
      "GOES-East_ABI_Air_Mass/default/2026-08-30T07:20:00Z/GoogleMapsCompatible_Level6",
    );
    // Himawari's visible band is 3, not 2.
    expect(url("himawari:red-visible")).toContain(
      "Himawari_AHI_Band3_Red_Visible_1km",
    );
    expect(url("east:red-visible")).toContain(
      "GOES-East_ABI_Band2_Red_Visible_1km",
    );
  });

  it("gives Himawari the three bands it has and nothing else", () => {
    // GIBS publishes no GeoColor, dust or fire temperature for Himawari on
    // this endpoint. Asking for one anyway drew a layer that 404s every tile.
    expect(publishes("himawari", "geocolor")).toBe(false);
    expect(publishes("himawari", "dust")).toBe(false);
    expect(publishes("himawari", "fire-temp")).toBe(false);
    expect(publishes("himawari", "clean-ir")).toBe(true);
    expect(publishes("himawari", "air-mass")).toBe(true);
    expect(publishes("himawari", "red-visible")).toBe(true);
    for (const band of SATELLITE_BANDS) {
      expect(publishes("east", band), `east ${band}`).toBe(true);
      expect(publishes("west", band), `west ${band}`).toBe(true);
    }
  });

  it("draws the one band everything has when the choice is not there", () => {
    // A reader who picked GeoColor over the Gulf and panned to Japan gets the
    // infrared band, which works at night and exists on all three, rather
    // than an empty layer.
    expect(bandFor("himawari", "geocolor")).toBe("clean-ir");
    expect(bandFor("himawari", "dust")).toBe("clean-ir");
    expect(bandFor("himawari", "air-mass")).toBe("air-mass");
    expect(bandFor("east", "geocolor")).toBe("geocolor");
    expect(satelliteProductId("himawari", "fire-temp")).toBe(
      "himawari:clean-ir",
    );
    expect(satelliteTileUrl(now, "himawari:geocolor")).toContain(
      "Himawari_AHI_Band13_Clean_Infrared",
    );
  });

  it("falls back to the daylight picture for a product it does not have", () => {
    // A settings file from a build with a band this one has never heard of
    // draws something rather than nothing.
    expect(satelliteProduct("nonsense" as SatelliteProductId).id).toBe(
      "east:geocolor",
    );
    expect(satelliteProduct("mars:geocolor" as SatelliteProductId).id).toBe(
      "east:geocolor",
    );
    expect(satelliteProduct("west:brand-new" as SatelliteProductId).id).toBe(
      "west:geocolor",
    );
  });

  it("keeps one timeline for all of them", () => {
    // Same service, same ten-minute cadence, same hold-back: switching the
    // band or crossing a satellite boundary must not move any frame.
    const frame = Date.parse("2026-08-30T06:47:00Z") / 1000;
    const slot = satelliteFrameTime(frame, now);
    for (const id of EVERY_PRODUCT) {
      const url = satelliteTileUrl(slot, id);
      expect(url).toContain("2026-08-30T06:40:00Z");
      expect(url).toContain(satelliteProduct(id).layer);
      expect(url.endsWith("/{z}/{y}/{x}.png")).toBe(true);
    }
  });

  it("says what each one is, and says which is a measurement", () => {
    for (const band of satelliteBands()) {
      expect(band.key.startsWith("satellite.")).toBe(true);
      expect(band.legendKey.startsWith("satellite.")).toBe(true);
      expect(band.detailKey.startsWith("satellite.")).toBe(true);
    }
    // The infrared band carries a scale, and the legend has to say so:
    // reading a temperature off GeoColor is reading one off a rendering.
    expect(satelliteBand("clean-ir").legendKey).toBe("satellite.cleanIrLegend");
    // And every band has its own words, rather than several sharing one.
    const legends = new Set(satelliteBands().map((band) => band.legendKey));
    expect(legends.size).toBe(SATELLITE_BANDS.length);
  });

  it("names a product the same way whichever direction it is built", () => {
    for (const id of EVERY_PRODUCT) {
      const product = satelliteProduct(id);
      expect(satelliteProductId(product.spacecraft, product.band)).toBe(id);
    }
  });
});

describe.runIf(LIVE)("against the live service", () => {
  // Every satellite and band pair, at a slot the hold-back says is published,
  // through the same address the map builds.
  it.each(EVERY_PRODUCT)(
    "%s answers with an image",
    async (id: SatelliteProductId) => {
      const slot = satelliteFrameTime(
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000),
      );
      // A tile over each satellite's own disk rather than one fixed tile:
      // zoom 2, which is four tiles across the world.
      const product = satelliteProduct(id);
      const x =
        product.spacecraft === "himawari"
          ? 3
          : product.spacecraft === "west"
            ? 0
            : 1;
      const url = satelliteTileUrl(slot, id)
        .replace("{z}", "2")
        .replace("{y}", "1")
        .replace("{x}", String(x));
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/");
      const bytes = await response.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(500);
    },
    30_000,
  );

  it("has a band on every satellite the chooser can land on", async () => {
    // The chooser never asks for a pair that is not published, so this is the
    // claim the fallback rests on: whatever longitude a reader is over and
    // whatever band they picked, something is there.
    for (const spacecraft of SPACECRAFT) {
      for (const wanted of SATELLITE_BANDS) {
        const id = satelliteProductId(spacecraft, wanted as SatelliteBandId);
        expect(publishes(spacecraft, satelliteProduct(id).band)).toBe(true);
      }
    }
  });
});

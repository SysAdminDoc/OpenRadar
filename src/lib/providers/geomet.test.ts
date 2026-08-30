import { describe, expect, it } from "vitest";
import { RAIN_RATE_RAMP, RAIN_RATE_STOPS, geometProvider } from "./geomet";
import { providerChain } from "./index";
import { covers } from "./types";

describe("Canadian coverage", () => {
  it("claims Canada", () => {
    for (const [lon, lat, place] of [
      [-79.4, 43.7, "Toronto"],
      [-123.1, 49.3, "Vancouver"],
      [-63.6, 44.6, "Halifax"],
      [-113.5, 53.5, "Edmonton"],
    ] as Array<[number, number, string]>) {
      expect(covers(geometProvider, lon, lat), place).toBe(true);
    }
  });

  it("leaves the rest of the world alone", () => {
    expect(covers(geometProvider, 2.35, 48.85)).toBe(false);
    expect(covers(geometProvider, -157.8, 21.3)).toBe(false);
    expect(covers(geometProvider, -30, 45)).toBe(false);
  });
});

describe("who serves which viewport", () => {
  it("hands Canada to GeoMet rather than to a personal-use feed", () => {
    for (const [lon, lat, place] of [
      [-113.5, 53.5, "Edmonton"],
      [-123.1, 49.3, "Vancouver"],
      [-97.1, 49.9, "Winnipeg"],
      [-75.7, 45.4, "Ottawa"],
      [-73.6, 45.5, "Montreal"],
      [-63.6, 44.6, "Halifax"],
      [-52.7, 47.6, "St John's"],
    ] as Array<[number, number, string]>) {
      expect(
        providerChain(lon, lat).map((entry) => entry.id),
        place,
      ).toEqual(["geomet"]);
    }
  });

  it("leaves the Windsor to Toronto strip on the American mosaic", () => {
    // No rectangle separates southern Ontario from Michigan and Ohio, and the
    // mosaic covers it, so that corridor keeps what it has.
    expect(providerChain(-79.4, 43.7).map((entry) => entry.id)).toContain(
      "ridge",
    );
  });

  it("still gives the United States to NOAA", () => {
    // GeoMet's own box reaches over the northern states, and must not take
    // them from the mosaics.
    const seattle = providerChain(-122.3, 47.6).map((p) => p.id);
    expect(seattle).toContain("ridge");
    expect(seattle).not.toContain("geomet");
    expect(providerChain(-93.7, 41.7).map((p) => p.id)).toContain("ridge");
  });

  it("falls to RainViewer where neither reaches", () => {
    expect(providerChain(2.35, 48.85).map((p) => p.id)).toEqual(["rainviewer"]);
    expect(providerChain(139.7, 35.7).map((p) => p.id)).toEqual(["rainviewer"]);
  });
});

describe("the rain rate scale", () => {
  it("climbs from a drizzle to a downpour", () => {
    expect(RAIN_RATE_RAMP[0][0]).toBe(0.1);
    expect(RAIN_RATE_RAMP.at(-1)![0]).toBe(200);
    expect(
      RAIN_RATE_RAMP.every(
        (stop, at) => at === 0 || stop[0] > RAIN_RATE_RAMP[at - 1][0],
      ),
    ).toBe(true);
    expect(
      RAIN_RATE_RAMP.every(([, color]) => /^#[0-9a-f]{6}$/.test(color)),
    ).toBe(true);
  });

  it("labels stops that are on the scale", () => {
    for (const stop of RAIN_RATE_STOPS) {
      expect(stop).toBeGreaterThanOrEqual(RAIN_RATE_RAMP[0][0]);
      expect(stop).toBeLessThanOrEqual(RAIN_RATE_RAMP.at(-1)![0]);
    }
  });
});

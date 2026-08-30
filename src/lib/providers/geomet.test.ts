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
      [-75.7, 50.5, "northern Quebec"],
      [-63.6, 46.2, "Prince Edward Island"],
      [-52.7, 47.6, "St John's"],
    ] as Array<[number, number, string]>) {
      const chain = providerChain(lon, lat).map((entry) => entry.id);
      expect(chain[0], place).toBe("geomet");
    }
  });

  it("keeps something behind GeoMet rather than nothing", () => {
    // A service outage or a tripped budget over Canada should mean a worse
    // picture, not a blank map.
    expect(providerChain(-113.5, 53.5).map((entry) => entry.id)).toEqual([
      "geomet",
      "rainviewer",
    ]);
  });

  it("never takes a piece of the United States", () => {
    // The two places a box drawn to the forty-ninth parallel gets wrong: the
    // Alaska Panhandle runs down the coast east of the hundred and
    // forty-first meridian, and Minnesota's Northwest Angle is north of the
    // parallel. Both were inside the first version of these boxes.
    for (const [lon, lat, place] of [
      [-131.65, 55.34, "Ketchikan"],
      [-134.42, 58.3, "Juneau"],
      [-135.33, 57.05, "Sitka"],
      [-95.05, 49.34, "Angle Inlet"],
    ] as Array<[number, number, string]>) {
      expect(
        providerChain(lon, lat).map((entry) => entry.id),
        place,
      ).not.toContain("geomet");
    }

    // Every one of these is inside a box drawn generously enough to hold the
    // Canadian side of the same border.
    for (const [lon, lat, place] of [
      [-122.3, 47.6, "Seattle"],
      [-93.7, 41.7, "Des Moines"],
      [-68.8, 44.8, "Bangor, Maine"],
      [-70.3, 43.7, "Portland, Maine"],
      [-73.2, 44.5, "Burlington, Vermont"],
      [-71.5, 43.2, "Concord, New Hampshire"],
      [-92.1, 46.8, "Duluth, Minnesota"],
      [-87.4, 46.5, "Marquette, Michigan"],
      [-73.5, 44.7, "Plattsburgh, New York"],
      [-83.0, 42.3, "Detroit"],
    ] as Array<[number, number, string]>) {
      const chain = providerChain(lon, lat).map((entry) => entry.id);
      expect(chain, place).not.toContain("geomet");
      // MRMS leads on the desktop and RIDGE in a browser preview; either way
      // an American viewport gets an American mosaic.
      expect(["mrms", "ridge"], place).toContain(chain[0]);
    }
  });

  it("keeps RainViewer behind GeoMet outside the claimed boxes too", () => {
    // The Pacific west of Vancouver Island: GeoMet claims it, the American
    // mosaics stop short of it, and it is south of the parallel the claimed
    // boxes start at. It reaches GeoMet through coverage rather than through
    // the Canadian rule, and that path needs a fallback as much as the other.
    expect(providerChain(-132, 48).map((entry) => entry.id)).toEqual([
      "geomet",
      "rainviewer",
    ]);
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

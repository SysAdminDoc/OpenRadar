import { describe, expect, it } from "vitest";
import {
  FLOOD_CATEGORIES,
  gaugeUrl,
  parseGauges,
  riverGaugesOverlay,
} from "./rivers";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** One row in the shape the service answers with, taken from a real response. */
function gauge(over: Record<string, unknown> = {}) {
  return {
    lid: "DESI4",
    name: "Des Moines River at Des Moines SE 6th St",
    rfc: { abbreviation: "NCRFC", name: "North Central River Forecast Center" },
    wfo: { abbreviation: "DMX", name: "Des Moines" },
    state: { abbreviation: "IA", name: "Iowa" },
    latitude: 41.5785833,
    longitude: -93.6056111,
    pedts: { observed: "HGIRP", forecast: "HGIFE" },
    status: {
      observed: {
        primary: 9.25,
        primaryUnit: "ft",
        secondary: 0.989,
        secondaryUnit: "kcfs",
        floodCategory: "no_flooding",
        validTime: "2026-09-01T22:00:00Z",
      },
      forecast: {
        primary: -999,
        primaryUnit: "",
        secondary: -999,
        secondaryUnit: "",
        floodCategory: "fcst_not_current",
        validTime: "0001-01-01T00:00:00Z",
      },
    },
    ...over,
  };
}

function properties(payload: unknown) {
  const parsed = parseGauges(payload);
  return parsed.features.map((feature) => feature.properties);
}

describe("reading the gauges", () => {
  it("keeps what a gauge measured and where it is", () => {
    const [row] = properties({ gauges: [gauge()] });
    expect(row.lid).toBe("DESI4");
    expect(row.stage).toBe(9.25);
    expect(row.stageUnit).toBe("ft");
    expect(row.observedAt).toBe(Date.parse("2026-09-01T22:00:00Z"));
    expect(row.observedCategory).toBe("none");
    expect(row.office).toBe("DMX");
    expect(row.url).toBe("https://water.noaa.gov/gauges/DESI4");
    const [feature] = parseGauges({ gauges: [gauge()] }).features;
    expect(feature.geometry).toEqual({
      type: "Point",
      coordinates: [-93.6056111, 41.5785833],
    });
  });

  it("reads the service's sentinels as nothing rather than as readings", () => {
    // -999 is how NWPS says it has no forecast, and the year one is how it
    // says there is no time. Drawing either would put a river a thousand feet
    // underground on the map.
    const [row] = properties({ gauges: [gauge()] });
    expect(row.forecastStage).toBeNull();
    expect(row.forecastAt).toBeNull();
    expect(row.forecastCategory).toBeNull();
  });

  it("drops a gauge with nothing to say and one with nowhere to be", () => {
    const silent = gauge({
      status: {
        observed: {
          primary: -999,
          floodCategory: "obs_not_current",
          validTime: "0001-01-01T00:00:00Z",
        },
        forecast: {
          primary: -999,
          floodCategory: "fcst_not_current",
          validTime: "0001-01-01T00:00:00Z",
        },
      },
    });
    const nowhere = gauge({ lid: "XXXX1", latitude: 0, longitude: 0 });
    const nameless = gauge({ lid: "" });
    expect(properties({ gauges: [silent, nowhere, nameless] })).toHaveLength(0);
    // And an answer that is not an answer at all.
    expect(parseGauges({}).features).toHaveLength(0);
    expect(parseGauges({ gauges: "soon" }).features).toHaveLength(0);
    expect(parseGauges(null).features).toHaveLength(0);
  });

  it("survives a service that renames or drops the fields around the value", () => {
    // The shape has moved before. What matters is that a row keeps whatever
    // it still has rather than the whole layer going dark.
    const changed = {
      lid: "CEDI4",
      name: "Cedar River at Cedar Rapids",
      latitude: 41.98,
      longitude: -91.67,
      status: {
        observed: { primary: 6.4, validTime: "2026-09-01T21:00:00Z" },
      },
    };
    const [row] = properties({ gauges: [changed] });
    expect(row.stage).toBe(6.4);
    expect(row.stageUnit).toBe("");
    expect(row.office).toBe("");
    expect(row.observedCategory).toBeNull();
    // No category from either side is not a flood; it is a river with no
    // stages defined, and the map draws it as the calm colour.
    expect(row.category).toBe("none");
    expect(row.rising).toBe(false);
  });

  it("colours a gauge by the worse of what it reads and what is expected", () => {
    const rising = gauge({
      lid: "RISE1",
      status: {
        observed: {
          primary: 21.2,
          primaryUnit: "ft",
          floodCategory: "action",
          validTime: "2026-09-01T22:00:00Z",
        },
        forecast: {
          primary: 27.5,
          primaryUnit: "ft",
          floodCategory: "moderate",
          validTime: "2026-09-03T12:00:00Z",
        },
      },
    });
    const falling = gauge({
      lid: "FALL1",
      status: {
        observed: {
          primary: 25.0,
          primaryUnit: "ft",
          floodCategory: "minor",
          validTime: "2026-09-01T22:00:00Z",
        },
        forecast: {
          primary: 19.0,
          primaryUnit: "ft",
          floodCategory: "no_flooding",
          validTime: "2026-09-03T12:00:00Z",
        },
      },
    });
    const [worse, better] = properties({ gauges: [rising, falling] });
    // Worst first, so the dot that matters is drawn on top.
    expect(worse.lid).toBe("RISE1");
    expect(worse.category).toBe("moderate");
    expect(worse.rising).toBe(true);
    expect(better.lid).toBe("FALL1");
    // A river coming down is still in minor flood now, and the map says the
    // worse of the two rather than the more comforting one.
    expect(better.category).toBe("minor");
    expect(better.rising).toBe(false);
  });

  it("ranks the categories worst first", () => {
    expect([...FLOOD_CATEGORIES]).toEqual([
      "major",
      "moderate",
      "minor",
      "action",
      "none",
    ]);
  });
});

describe("what the panel says about one", () => {
  it("tells the measurement and the forecast apart, with a time on each", () => {
    const [row] = parseGauges({
      gauges: [
        gauge({
          status: {
            observed: {
              primary: 21.2,
              primaryUnit: "ft",
              floodCategory: "action",
              validTime: "2026-09-01T22:00:00Z",
            },
            forecast: {
              primary: 27.5,
              primaryUnit: "ft",
              floodCategory: "moderate",
              validTime: "2026-09-03T12:00:00Z",
            },
          },
        }),
      ],
    }).features;
    const said = riverGaugesOverlay.describe(row.properties);
    expect(said.title).toContain("Des Moines River");
    expect(said.url).toBe(gaugeUrl("DESI4"));
    const text = said.lines.join(" | ");
    expect(text).toContain("21.20 ft");
    expect(text).toContain("27.50 ft");
    // Measured and forecast are separate lines with their own words, so a
    // reader cannot mistake one for the other.
    expect(said.lines[0].toLowerCase()).toContain("observed");
    expect(said.lines[1].toLowerCase()).toContain("forecast");
    expect(text.toLowerCase()).toContain("moderate");
    expect(text).toContain("DMX");
  });

  it("says plainly when there is no forecast rather than leaving a gap", () => {
    const [row] = parseGauges({ gauges: [gauge()] }).features;
    const said = riverGaugesOverlay.describe(row.properties);
    expect(said.lines[1].toLowerCase()).toContain("no current forecast");
    expect(said.lines.join(" ")).not.toContain("-999");
  });
});

describe("what the layer asks for", () => {
  it("stays off the map until the view is close enough to read", () => {
    expect(riverGaugesOverlay.minZoom).toBeGreaterThanOrEqual(6);
    expect(riverGaugesOverlay.host).toBe("api.water.noaa.gov");
    // Ten minutes against a fifteen minute publishing cycle.
    expect(riverGaugesOverlay.refreshMs).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("asks in degrees, which the service does not assume", async () => {
    let asked = "";
    const fetched = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ gauges: [gauge()] }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;
    try {
      const data = await riverGaugesOverlay.fetchData({
        west: -94.5,
        south: 41,
        east: -93,
        north: 42.2,
      });
      expect(data.features).toHaveLength(1);
    } finally {
      globalThis.fetch = fetched;
    }
    // Without the reference the service reads the box as mercator metres and
    // answers with an empty list, which looks like a quiet day rather than a
    // broken query.
    expect(asked).toContain("srid=EPSG_4326");
    expect(asked).toContain("bbox.xmin=-94.5000");
    expect(asked).toContain("bbox.ymax=42.2000");
  });

  it("says which service failed rather than a bare status", async () => {
    const fetched = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 503,
      }) as unknown as Response) as typeof globalThis.fetch;
    try {
      await expect(
        riverGaugesOverlay.fetchData({
          west: -94.5,
          south: 41,
          east: -93,
          north: 42.2,
        }),
      ).rejects.toThrow(/503/);
    } finally {
      globalThis.fetch = fetched;
    }
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("answers a box over Iowa with gauges that have a place and a reading", async () => {
    const data = await riverGaugesOverlay.fetchData({
      west: -94.5,
      south: 41,
      east: -93,
      north: 42.2,
    });
    // The Des Moines and Raccoon rivers run through this box and are gauged
    // heavily, so an empty answer means the query shape has moved rather than
    // the rivers having gone.
    expect(data.features.length).toBeGreaterThan(0);
    for (const feature of data.features) {
      expect(feature.geometry.type).toBe("Point");
      const [lon, lat] = feature.geometry.coordinates as number[];
      expect(lon).toBeGreaterThan(-96);
      expect(lon).toBeLessThan(-91);
      expect(lat).toBeGreaterThan(40);
      expect(lat).toBeLessThan(43);
      expect(String(feature.properties.lid)).toMatch(/^[A-Z0-9]{4,5}$/);
      // Whatever else is missing, a drawn gauge has a reading in one
      // direction or the other.
      expect(
        feature.properties.stage !== null ||
          feature.properties.forecastStage !== null,
      ).toBe(true);
      expect(FLOOD_CATEGORIES).toContain(feature.properties.category);
    }
  }, 30_000);
});

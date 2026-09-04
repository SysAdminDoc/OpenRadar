import { describe, expect, it, vi } from "vitest";
import { en } from "../../i18n/en";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  REPLAY_RADIUS_DEGREES,
  REPORT_HOURS,
  parseReports,
  replayReportsUrl,
  stormReportsOverlay,
  parseServiceReports,
  serviceReportsUrl,
} from "./reports";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** One report, in the shape the feed answers with. */
function report(over: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-99.8, 45.37] },
    properties: {
      wfo: "ABR",
      type: "H",
      magf: 1.5,
      typetext: "HAIL",
      city: "9 SW Bowdle",
      state: "SD",
      st: "SD",
      source: "Public",
      unit: "Inch",
      remark: "Hail was a variety of sizes.",
      valid: "2026-08-29T22:50:00Z",
      ...over,
    },
  };
}

describe("what people on the ground saw", () => {
  it("keeps the measurement and the unit it was made in", () => {
    // An inch of hail and sixty miles an hour of wind are both a magnitude,
    // and only the unit says which. Guessing it from the report type would put
    // inches on a gust.
    const [feature] = parseReports({ features: [report()] }).features;
    expect(feature.properties.magnitude).toBe(1.5);
    expect(feature.properties.unit).toBe("Inch");
    expect(feature.properties.kind).toBe("hail");
    expect(feature.properties.label).toBe("HAIL");
  });

  it("colours a report by what it is about", () => {
    const kinds = parseReports({
      features: [
        report({ type: "H" }),
        report({ type: "G" }),
        report({ type: "W" }),
        report({ type: "F" }),
        // A type the feed has and this does not name is still a report.
        report({ type: "S", typetext: "SNOW" }),
      ],
    }).features.map((feature) => feature.properties.kind);

    expect(kinds).toEqual(["hail", "wind", "tornado", "flood", "other"]);
  });

  it("draws the newest report on top where two land together", () => {
    const times = parseReports({
      features: [
        report({ valid: "2026-08-30T02:00:00Z" }),
        report({ valid: "2026-08-29T22:50:00Z" }),
        report({ valid: "2026-08-30T00:15:00Z" }),
      ],
    }).features.map((feature) => feature.properties.at);

    // A GeoJSON source draws its features in order, so last is on top.
    expect(times).toEqual([...(times as number[])].sort((a, b) => a - b));
  });

  it("drops a record with no time or no place on the map", () => {
    const parsed = parseReports({
      features: [
        report({ valid: "not a time" }),
        { type: "Feature", geometry: { type: "Polygon" }, properties: {} },
        { type: "Feature", properties: report().properties },
        report(),
      ],
    });
    expect(parsed.features).toHaveLength(1);
  });

  it("survives a report with nothing measured", () => {
    // Wind damage is reported without a number, which is not the same as zero.
    const [feature] = parseReports({
      features: [
        report({ type: "D", typetext: "TSTM WND DMG", magf: null, unit: null }),
      ],
    }).features;
    expect(feature.properties.magnitude).toBeNull();
    expect(feature.properties.unit).toBe("");
  });
});

describe.runIf(LIVE)("against the live weather service", () => {
  it("reads today's reports from the second source, in its own shape", async () => {
    // The fallback is only ever reached when the first source is down, which
    // is exactly when nobody is watching it, so it needs a contract of its
    // own. A field renamed here would otherwise show up as an empty layer on
    // the day the archive goes out.
    const answer = await fetch(serviceReportsUrl(), {
      headers: { Accept: "application/json" },
    });
    expect(answer.ok).toBe(true);
    const data = parseServiceReports(await answer.json());
    // The country sees reports every day, and this layer holds the last
    // twenty-four hours of them.
    expect(data.features.length).toBeGreaterThan(0);
    for (const feature of data.features) {
      expect(feature.geometry.type).toBe("Point");
      expect(String(feature.properties.color)).toMatch(/^#[0-9a-f]{6}$/i);
      // The two fields the parse would silently lose if they were renamed:
      // a time read the archive's way is NaN, and a type read as a letter
      // makes every report "other".
      expect(Number(feature.properties.at)).toBeGreaterThan(0);
      expect(String(feature.properties.label).length).toBeGreaterThan(0);
    }
    // And at least one of them is something the map has a colour for, rather
    // than everything falling to the catch-all.
    expect(
      data.features.some((feature) => feature.properties.kind !== "other"),
    ).toBe(true);
  }, 30_000);
});

describe.runIf(LIVE)("against the live feed", () => {
  it("reads the last day of reports", async () => {
    const data = await stormReportsOverlay.fetchData(
      {
        west: -125,
        south: 24,
        east: -66,
        north: 50,
      },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // The country sees reports every day; an empty answer means the query
    // shape is wrong rather than the weather being quiet.
    expect(data.features.length).toBeGreaterThan(0);
    const oldest = Math.min(
      ...data.features.map((feature) => Number(feature.properties.at)),
    );
    // Nothing older than the window that was asked for, with an hour of slack
    // for reports filed late.
    expect(Date.now() - oldest).toBeLessThan((REPORT_HOURS + 1) * 3_600_000);
    for (const feature of data.features) {
      expect(String(feature.properties.color)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(feature.geometry.type).toBe("Point");
    }
  }, 30_000);
});

describe("the reports that came in during a replayed window", () => {
  const bounds = { west: -90, south: 32, east: -86, north: 36 };
  const window = {
    from: Date.UTC(2011, 3, 27, 18),
    to: Date.UTC(2011, 3, 27, 23),
  };

  it("asks the archive by point and window, in the unit the parameter names", () => {
    // There is a `radius_miles` beside it and a bare `radius` is accepted
    // and ignored, which is how a request comes back with the wrong reports
    // and no error.
    const url = replayReportsUrl(bounds, window);
    expect(url).toContain("radius_degrees=");
    expect(url).not.toMatch(/[?&]radius=/);
    expect(url).toContain("lon=-88.000");
    expect(url).toContain("lat=34.000");
    expect(url).toContain("begints=2011-04-27T18%3A00%3A00.000Z");
    expect(url).toContain("endts=2011-04-27T23%3A00%3A00.000Z");
  });

  it("bounds the radius at both ends", () => {
    // A reader zoomed out to the hemisphere is not asking for every report
    // in it, and one zoomed into a county still wants the ones around them.
    const wide = replayReportsUrl(
      { west: -170, south: -60, east: 170, north: 60 },
      window,
    );
    expect(wide).toContain(
      `radius_degrees=${REPLAY_RADIUS_DEGREES.most.toFixed(2)}`,
    );
    const tight = replayReportsUrl(
      { west: -93.8, south: 41.6, east: -93.6, north: 41.8 },
      window,
    );
    expect(tight).toContain(
      `radius_degrees=${REPLAY_RADIUS_DEGREES.least.toFixed(2)}`,
    );
  });

  it("reads the archive's own name for a magnitude", () => {
    // The live feed calls it `magf` and the archive calls it `magnitude`.
    // Reading only the live name put no size on any archived hail report.
    const read = parseReports({
      features: [
        {
          geometry: { type: "Point", coordinates: [-88, 34] },
          properties: {
            valid: "2011-04-27T20:10:00Z",
            type: "H",
            magnitude: 2.75,
            typetext: "HAIL",
            unit: "INCH",
          },
        },
      ],
    });
    expect(read.features[0].properties.magnitude).toBe(2.75);
  });

  it("still says nothing about a report that claimed no number", () => {
    const read = parseReports({
      features: [
        {
          geometry: { type: "Point", coordinates: [-88, 34] },
          properties: {
            valid: "2011-04-27T20:10:00Z",
            type: "D",
            magnitude: null,
            magf: null,
            typetext: "TSTM WND DMG",
          },
        },
      ],
    });
    expect(read.features[0].properties.magnitude).toBeNull();
  });

  it("asks again for a different replay and not for the same one", () => {
    const same = stormReportsOverlay.variant?.({
      ...DEFAULT_OVERLAY_CHOICES,
      replay: window,
    });
    expect(
      stormReportsOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        replay: { ...window },
      }),
    ).toBe(same);
    expect(
      stormReportsOverlay.variant?.({ ...DEFAULT_OVERLAY_CHOICES }),
    ).not.toBe(same);
  });
});

describe("when the usual source for storm reports does not answer", () => {
  const bounds = { west: -104, south: 30, east: -90, north: 42 };

  /** One report, in the shape the weather service's own map service sends. */
  const serviceFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-97.17, 44.91] },
    properties: {
      descript: "Tornado",
      magnitude: "",
      units: "",
      lsr_validtime: 1788511200000,
      loc_desc: "3 W Watertown",
      state: "SD",
      remarks: "Brief touchdown, no damage.",
      wfo: "Aberdeen SD",
    },
  };

  function answering(iem: boolean) {
    return (async (url: string) => {
      const forService = String(url).includes("mapservices.weather.noaa.gov");
      if (!forService && !iem) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: forService
            ? [serviceFeature]
            : [
                {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [-93, 41] },
                  properties: {
                    valid: "2026-09-03T20:10:00Z",
                    type: "H",
                    magf: 1.75,
                    typetext: "HAIL",
                    unit: "INCH",
                  },
                },
              ],
        }),
      } as Response;
    }) as unknown as typeof fetch;
  }

  it("draws the reports from the weather service instead, and says so", async () => {
    // One source for a layer means a quiet afternoon and a host that is down
    // look identical, which is what two chasers hit mid-storm on 2026-09-03.
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(answering(false));
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.features).toHaveLength(1);
      expect(data.features[0].properties.kind).toBe("tornado");
      expect(data.partial).toBe(en["reports.fromService"]);
      // Both were asked, in that order.
      const asked = fetched.mock.calls.map((call) => String(call[0]));
      expect(asked[0]).toContain("mesonet.agron.iastate.edu");
      expect(asked[1]).toContain("mapservices.weather.noaa.gov");
    } finally {
      fetched.mockRestore();
    }
  });

  it("does not ask the second one at all while the first answers", async () => {
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(answering(true));
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.features).toHaveLength(1);
      expect(data.features[0].properties.kind).toBe("hail");
      expect(data.partial).toBeUndefined();
      const asked = fetched.mock.calls.map((call) => String(call[0]));
      expect(asked.some((url) => url.includes("mapservices"))).toBe(false);
    } finally {
      fetched.mockRestore();
    }
  });

  it("leaves the replayed day alone, which has its own archive", async () => {
    // The archive answers for a past window and the service's layer holds the
    // last twenty-four hours. Falling back would draw today's reports over
    // somebody else's afternoon, which is the claim the replay exists to
    // avoid making.
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(answering(false));
    try {
      await expect(
        stormReportsOverlay.fetchData(bounds, undefined, {
          ...DEFAULT_OVERLAY_CHOICES,
          replay: {
            from: Date.UTC(2011, 3, 27, 18),
            to: Date.UTC(2011, 3, 27, 23),
          },
        }),
      ).rejects.toThrow();
      const asked = fetched.mock.calls.map((call) => String(call[0]));
      expect(asked.some((url) => url.includes("mapservices"))).toBe(false);
    } finally {
      fetched.mockRestore();
    }
  });

  it("reads the service's own field names, which are not the archive's", async () => {
    // Nothing but the geometry is shared: the type is written out rather than
    // lettered, the magnitude is a string, and the time is epoch milliseconds,
    // where `Date.parse` gives NaN and would drop every report.
    const read = parseServiceReports({ features: [serviceFeature] });
    expect(read.features).toHaveLength(1);
    const said = read.features[0].properties;
    expect(said.at).toBe(1788511200000);
    expect(said.label).toBe("Tornado");
    expect(said.city).toBe("3 W Watertown");
    expect(said.source).toBe("Aberdeen SD");
    // Blank rather than zero: most wind damage is reported without a number,
    // and `Number("")` is 0, which would put a size on a report that claimed
    // none.
    expect(said.magnitude).toBeNull();
  });

  it("keeps a magnitude the service did send", () => {
    const read = parseServiceReports({
      features: [
        {
          ...serviceFeature,
          properties: {
            ...serviceFeature.properties,
            descript: "Marine Tstm Wind",
            magnitude: "41",
            units: "mph",
          },
        },
      ],
    });
    expect(read.features[0].properties.magnitude).toBe(41);
    expect(read.features[0].properties.unit).toBe("mph");
    expect(read.features[0].properties.kind).toBe("wind");
  });
});

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

  it("brings back the newest reports the service is holding", async () => {
    // The failure this exists for drew no error and lost no field: asked
    // for nothing in particular, the layer answered in object-id order and
    // stopped at the record count, so the newest hour was the part left out.
    // On 2026-09-04 the layer held 854 rows, the first 500 ended at 14:12Z,
    // and the newest report it had was 15:37Z.
    const asked = await fetch(serviceReportsUrl(), {
      headers: { Accept: "application/json" },
    });
    expect(asked.ok).toBe(true);
    const drawn = parseServiceReports(await asked.json());
    expect(drawn.features.length).toBeGreaterThan(0);
    const newestDrawn = Math.max(
      ...drawn.features.map((one) => Number(one.properties.at)),
    );

    // What the service says its newest row is, asked in a way that does not
    // depend on the ordering under test. Reading it back through the same
    // query with a count of one would fall to object-id order beside the
    // thing it is checking, and both would be wrong together: ArcGIS ignores
    // a query parameter it does not support rather than refusing it, which
    // is exactly the failure this contract exists to catch.
    const url = new URL(serviceReportsUrl());
    url.searchParams.delete("orderByFields");
    url.searchParams.delete("resultRecordCount");
    url.searchParams.delete("resultOffset");
    url.searchParams.delete("outFields");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("f", "json");
    url.searchParams.set(
      "outStatistics",
      JSON.stringify([
        {
          statisticType: "max",
          onStatisticField: "lsr_validtime",
          outStatisticFieldName: "newest",
        },
      ]),
    );
    const top = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    expect(top.ok).toBe(true);
    const held = (await top.json()) as {
      features?: { attributes?: { newest?: number } }[];
    };
    const newestHeld = Number(held.features?.[0]?.attributes?.newest);
    expect(Number.isFinite(newestHeld)).toBe(true);
    expect(newestDrawn).toBe(newestHeld);
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

  it("asks for the newest reports first, over the window the archive covers", () => {
    // Measured against the live service on 2026-09-04: the layer held 854
    // rows, the unordered first 500 of them ended at 14:12Z, and the newest
    // report it had was 15:37Z. An ArcGIS layer asked for nothing in
    // particular answers in object-id order, so the hour a reader opens this
    // for was the hour that got left out.
    const url = new URL(serviceReportsUrl());
    // The row id breaks a tie the time cannot: reports cluster on the
    // minute, and a tie split across two pages that each order it their own
    // way drops one report and repeats another.
    expect(url.searchParams.get("orderByFields")).toBe(
      "lsr_validtime DESC,objectid DESC",
    );
    const where = url.searchParams.get("where") ?? "";
    const said = /lsr_validtime >= TIMESTAMP '([\d-]+ [\d:]+)'/.exec(where);
    expect(said, `the window is not bounded: ${where}`).not.toBeNull();
    // The day the archive answers for, and up to an hour more: the boundary
    // is rounded down so the address stays the same within an hour.
    const from = Date.parse(`${said?.[1].replace(" ", "T")}Z`);
    const back = (Date.now() - from) / 3_600_000;
    expect(back).toBeGreaterThanOrEqual(REPORT_HOURS);
    expect(back).toBeLessThan(REPORT_HOURS + 1);
  });

  it("asks the same question twice within the hour", () => {
    // The address is the native cache's key. One carrying the current second
    // is a key nothing can hit again: every refresh would write entries that
    // are dead on arrival, push real tiles out of the budget, and leave the
    // offline view with no copy of this layer at all.
    expect(serviceReportsUrl()).toBe(serviceReportsUrl());
    const where = new URL(serviceReportsUrl()).searchParams.get("where") ?? "";
    // Whole hours only, which is what makes that true.
    expect(where).toMatch(/ \d{2}:00:00'$/);
  });

  it("counts an offset off in whole pages", () => {
    // The offset is what a second page is, and one that did not move would
    // fetch the same five hundred reports six times.
    expect(new URL(serviceReportsUrl()).searchParams.get("resultOffset")).toBe(
      "0",
    );
    const second = new URL(serviceReportsUrl(500));
    expect(second.searchParams.get("resultOffset")).toBe("500");
    expect(second.searchParams.get("resultRecordCount")).toBe("500");
  });

  it("reads the words the service actually publishes, abbreviations and all", () => {
    // The distinct values the two live feeds held on 2026-09-04. The ones
    // that make up most of a severe day are abbreviated, a match on the whole
    // word "wind" caught only the marine one, and a match that then forgot
    // the plural would drop the sustained-wind reports the same way.
    const wind = [
      "Tstm Wnd Gst",
      "Tstm Wnd Dmg",
      "Non-Tstm Wnd Gst",
      "Non-Tstm Wnd Dmg",
      "Marine Tstm Wind",
      "High Sust Winds",
      "Strong Winds",
      "Gusts",
    ];
    for (const said of wind) {
      const read = parseServiceReports({
        features: [
          {
            ...serviceFeature,
            properties: { ...serviceFeature.properties, descript: said },
          },
        ],
      });
      expect(read.features[0].properties.kind, said).toBe("wind");
    }
    const others: Record<string, string> = {
      Hail: "hail",
      "Flash Flood": "flood",
      Flood: "flood",
      Tornado: "tornado",
      "Funnel Cloud": "tornado",
      Waterspout: "tornado",
      Landspout: "tornado",
      Fog: "other",
      Rain: "other",
      Lightning: "other",
      "Debris Flow": "other",
      Landslide: "other",
    };
    for (const [said, kind] of Object.entries(others)) {
      const read = parseServiceReports({
        features: [
          {
            ...serviceFeature,
            properties: { ...serviceFeature.properties, descript: said },
          },
        ],
      });
      expect(read.features[0].properties.kind, said).toBe(kind);
    }
  });

  it("gives a funnel and a waterspout the same colours the archive does", () => {
    // The two feeds are read by different code and were free to disagree.
    // They did: the same funnel cloud came out in the full tornado colour
    // from one source and the lighter one from the other.
    const words = (said: string) =>
      parseServiceReports({
        features: [
          {
            ...serviceFeature,
            properties: { ...serviceFeature.properties, descript: said },
          },
        ],
      }).features[0].properties.color;
    const letter = (type: string) =>
      parseReports({
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-97, 44] },
            properties: { valid: "2026-09-04T12:00:00Z", type },
          },
        ],
      }).features[0].properties.color;
    // Each pair is the same event as the two feeds spell it, read off both
    // live feeds on 2026-09-04. The last two were the ones still disagreeing
    // after the colours were shared: the letter table had no row for
    // sustained or marine wind, so the weather service drew them amber and
    // the archive drew the same report grey.
    const pairs: Array<[string, string]> = [
      ["Funnel Cloud", "C"],
      ["Waterspout", "W"],
      ["Landspout", "W"],
      ["Tornado", "T"],
      ["Hail", "H"],
      ["Tstm Wnd Gst", "G"],
      ["Tstm Wnd Dmg", "D"],
      ["Non-Tstm Wnd Gst", "N"],
      ["Non-Tstm Wnd Dmg", "O"],
      ["Flash Flood", "F"],
      ["Flood", "E"],
      ["High Sust Winds", "A"],
      ["Marine Tstm Wind", "M"],
    ];
    for (const [said, type] of pairs) {
      expect(words(said), `${said} against ${type}`).toBe(letter(type));
    }
  });

  it("draws six hundred reports across two pages when the service holds them", async () => {
    // The window the archive answers for runs to more than one page of the
    // service on any busy day: 500 rows covered twelve of the twenty-four
    // hours on 2026-09-04.
    const page = (offset: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...serviceFeature,
        properties: {
          ...serviceFeature.properties,
          objectid: offset + index,
          lsr_validtime: 1788511200000 - (offset + index) * 60_000,
        },
      }));
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
    ) => {
      const said = String(url);
      if (!said.includes("mapservices.weather.noaa.gov")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      const offset = Number(
        new URL(said).searchParams.get("resultOffset") ?? 0,
      );
      const count = offset === 0 ? 500 : 100;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: page(offset, count),
          exceededTransferLimit: offset === 0,
        }),
      } as Response;
    }) as unknown as typeof fetch);
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.features).toHaveLength(600);
    } finally {
      fetched.mockRestore();
    }
  });

  it("counts a report the service repeated across two pages only once", async () => {
    // A report filed between the two requests shifts every row down one, so
    // the second page begins with the row the first one ended on.
    const row = (objectid: number) => ({
      ...serviceFeature,
      properties: {
        ...serviceFeature.properties,
        objectid,
        lsr_validtime: 1788511200000 - objectid * 60_000,
      },
    });
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
    ) => {
      const said = String(url);
      if (!said.includes("mapservices.weather.noaa.gov")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      const offset = new URL(said).searchParams.get("resultOffset");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: offset === "0" ? [row(1), row(2)] : [row(2), row(3)],
          exceededTransferLimit: offset === "0",
        }),
      } as Response;
    }) as unknown as typeof fetch);
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.features).toHaveLength(3);
    } finally {
      fetched.mockRestore();
    }
  });

  it("keeps asking while the service says it is holding more", async () => {
    // Five hundred rows covered twelve hours of the twenty-four the archive
    // answers for on 2026-09-04, so one ask stops half way through the
    // window with no sign that it did.
    const offsets: string[] = [];
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
    ) => {
      const said = String(url);
      if (!said.includes("mapservices.weather.noaa.gov")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      const offset =
        new URL(said).searchParams.get("resultOffset") ?? "missing";
      offsets.push(offset);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [
            {
              ...serviceFeature,
              properties: {
                ...serviceFeature.properties,
                // Older with every page, which is what newest-first means.
                lsr_validtime: 1788511200000 - offsets.length * 60_000,
              },
            },
          ],
          // Two pages held back, then the service is done.
          exceededTransferLimit: offsets.length < 3,
        }),
      } as Response;
    }) as unknown as typeof fetch);
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(offsets).toEqual(["0", "500", "1000"]);
      expect(data.features).toHaveLength(3);
      // Oldest first, so the newest report is drawn on top: the sort has to
      // see every page rather than running once per page.
      const times = data.features.map((one) => Number(one.properties.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    } finally {
      fetched.mockRestore();
    }
  });

  it("keeps the pages that landed when a later one fails", async () => {
    // The reader is already on the second source because the first is down,
    // and the newest reports are the ones already in hand. Throwing them
    // away over an older page would leave the map empty.
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation((async (
      url: string,
    ) => {
      const said = String(url);
      if (!said.includes("mapservices.weather.noaa.gov")) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }
      if (new URL(said).searchParams.get("resultOffset") !== "0") {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          features: [serviceFeature],
          exceededTransferLimit: true,
        }),
      } as Response;
    }) as unknown as typeof fetch);
    try {
      const data = await stormReportsOverlay.fetchData(
        bounds,
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.features).toHaveLength(1);
      expect(data.partial).toBe(en["reports.fromService"]);
    } finally {
      fetched.mockRestore();
    }
  });

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

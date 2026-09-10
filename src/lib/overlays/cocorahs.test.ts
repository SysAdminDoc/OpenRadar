import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  COCORAHS_MIN_ZOOM,
  COCORAHS_REFRESH_MS,
  COCORAHS_STATES,
  cocorahsOverlay,
  forgetCocorahs,
  newestPerStation,
  parseDaily,
  parseHail,
  reportWindow,
  statesIn,
} from "./cocorahs";
import { setUnits } from "../units";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * The daily export, in the shape the service answered with on 2026-09-09.
 *
 * Its own spelling of "success" included: the status field is misspelled in
 * the service and reading it would be reading a typo, so nothing here does.
 */
const DAILY = {
  status: "sucess",
  data: {
    reports: [
      {
        id: "baf82ee3-f3c3-47a0-8b25-e77762bbb8f1",
        st_num: "IA-IA-13",
        st_name: "Parnell 0.1 SSW",
        obs_date: "2026-09-09",
        obs_time: "04:37 AM",
        lat: 41.582387,
        lng: -92.005416,
        totalpcpn: 2.85,
      },
      // The same gauge read again later the same morning, which is one
      // measurement corrected rather than two things that happened.
      {
        id: "00000000-0000-0000-0000-000000000001",
        st_num: "IA-IA-13",
        st_name: "Parnell 0.1 SSW",
        obs_date: "2026-09-09",
        obs_time: "09:15 AM",
        lat: 41.582387,
        lng: -92.005416,
        totalpcpn: 3.02,
      },
      {
        id: "02a67e9d-f011-479e-bceb-a02907b170ae",
        st_num: "IA-FL-8",
        st_name: "Charles City 1.2 ESE",
        obs_date: "2026-09-09",
        obs_time: "04:54 AM",
        lat: 43.062371,
        lng: -92.653,
        totalpcpn: 0.38,
      },
      // A station whose number is not the county-coded shape. The service
      // carries plenty of these, so nothing may read a state out of one.
      {
        id: "1f2a82a8-8bbe-4263-bac1-ddc687d26b5a",
        st_num: "jeff012",
        st_name: "DeWitt 4.6 SSW",
        obs_date: "2026-09-09",
        obs_time: "10:30 AM",
        lat: 40.3318,
        lng: -96.9568,
        totalpcpn: 0.92,
      },
    ],
  },
};

/**
 * The hail export, verbatim off the live service for Colorado on 2026-06-01.
 *
 * It arrives as this table whatever `Format` says, which is the thing the
 * roadmap item's evidence had wrong. The last row is not the service's: it is
 * the same shape with a comma inside the damage description, which is the
 * field most likely to carry one and the reason nothing past it is read.
 */
const HAIL = `ObservationDate,ObservationTime,EntryDateTime,StationNumber,StationName,Latitude,Longitude,SmallestSize,AverageSize,LargestSize,DurationMinutes,DurationAccuracy,Timing,StoneConsistency,MoreRainThanHail,HailStarted,LargestHailStarted,MoreRainThanHail,Damage,AngleOfImpact,NumberOfStonesOnPad,DistanceBtwnStonesOnPad,DepthOnGround,DateTimeStamp
2026-06-01, 01:00 PM, 2026-06-02 07:54 AM, CO-BO-435, Longmont 3.0 SW, 40.1404, -105.149, 0.250, NA, 0.750, 20, 2min, Intermittent, Hard, True, After rain, After smaller hail, True, no damage, 10-20, , , , 2026-06-02 01:54 PM
2026-06-01, 05:00 PM, 2026-06-01 05:16 PM, CO-EP-376, Black Forest 3.0 NE, 39.07591, -104.62778, NA, NA, 1.000, 1, 3min, , Mixed|White Ice, False, , , False, shredded leaves, , , , , 2026-06-01 11:16 PM
2026-06-01, 02:10 PM, 2026-06-01 02:40 PM, CO-DG-176, Highlands Ranch 0.6 SSE, 39.5462, -104.9655, 0.100, 0.250, 0.500, 11, 1min, , Hard, False, After rain, After smaller hail, False, dented the car, broke a skylight, , , , , 2026-06-01 08:40 PM
`;

beforeEach(() => {
  forgetCocorahs();
  setUnits("imperial");
});
afterEach(() => {
  forgetCocorahs();
  setUnits("imperial");
});

describe("what people measured in their own gardens", () => {
  it("asks only for states it has a box for, and for none outside them", () => {
    // Iowa and its neighbours, which is what a screen over Des Moines
    // overlaps once the framework has padded it.
    const iowa = statesIn({ west: -94, south: 41, east: -92, north: 42.5 });
    expect(iowa).toContain("IA");
    expect(iowa).not.toContain("TX");

    // Northern Ontario, clear of the border. The service does not know `ON`
    // and does not say so: it answers an unrecognised code with the entire
    // national feed, 2.7 MB of it, so a view up there has to produce no code
    // at all. Southern Ontario is a different question and gets Michigan,
    // which is right: the gauges across the river are real ones.
    expect(
      statesIn({ west: -82, south: 47.5, east: -78, north: 49.5 }),
    ).toEqual([]);
    // And the middle of the Pacific.
    expect(statesIn({ west: -150, south: 5, east: -140, north: 10 })).toEqual(
      [],
    );
  });

  it("has one box per state and no two the same", () => {
    const codes = COCORAHS_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const state of COCORAHS_STATES) {
      expect(state.west, state.code).toBeLessThan(state.east);
      expect(state.south, state.code).toBeLessThan(state.north);
      // Nothing in this network is in the eastern hemisphere, and a box that
      // crossed the antimeridian would make `statesIn` answer nonsense.
      expect(state.west, state.code).toBeGreaterThanOrEqual(-180);
      expect(state.east, state.code).toBeLessThan(0);
    }
  });

  it("asks for yesterday and today, in the service's own date order", () => {
    // Nine in the morning UTC is the evening before in Hawaii and the small
    // hours on the east coast, so both dates have to be in the window.
    const { start, end } = reportWindow(Date.parse("2026-09-10T09:00:00Z"));
    expect(start).toBe("09/09/2026");
    expect(end).toBe("09/10/2026");
    // Across a month boundary, where writing the arithmetic by hand goes
    // wrong.
    expect(reportWindow(Date.parse("2026-03-01T02:00:00Z"))).toEqual({
      start: "02/28/2026",
      end: "03/01/2026",
    });
  });

  it("reads a daily report without reading a state out of the station", () => {
    const features = parseDaily(DAILY);
    expect(features).toHaveLength(4);
    const [first] = features;
    expect(first.geometry.coordinates).toEqual([-92.005416, 41.582387]);
    expect(first.properties.station).toBe("IA-IA-13");
    expect(first.properties.inches).toBe(2.85);
    expect(first.properties.kind).toBe("daily");
    // The station whose number is a word rather than a county code is read
    // like any other.
    expect(features[3].properties.station).toBe("jeff012");
  });

  it("reads a hail report, and drops nothing over a comma in the damage", () => {
    const features = parseHail(HAIL);
    expect(features).toHaveLength(3);
    const [first] = features;
    expect(first.properties.kind).toBe("hail");
    expect(first.properties.station).toBe("CO-BO-435");
    expect(first.geometry.coordinates).toEqual([-105.149, 40.1404]);
    expect(first.properties.largestInches).toBe(0.75);
    // `NA` is what the service writes where an observer answered nothing.
    // Read as a number it is `NaN`; read as zero it is a report of no hail,
    // which is not what somebody filing a hail report meant.
    expect(first.properties.averageInches).toBeNull();
    expect(first.properties.minutes).toBe(20);
    expect(first.properties.consistency).toBe("Hard");

    // The row with a comma inside the free text still lands where it should,
    // because nothing past the last measured column is read positionally.
    const commaed = features[2];
    expect(commaed.properties.station).toBe("CO-DG-176");
    expect(commaed.geometry.coordinates).toEqual([-104.9655, 39.5462]);
    expect(commaed.properties.largestInches).toBe(0.5);
  });

  it("draws one dot per gauge, and every hail report", () => {
    const kept = newestPerStation([...parseDaily(DAILY), ...parseHail(HAIL)]);
    const gauges = kept.filter((one) => one.properties.kind === "daily");
    expect(gauges).toHaveLength(3);
    // The later reading of the same gauge is the one drawn: a gauge read at
    // 4:37 and again at 9:15 is one measurement corrected.
    const parnell = gauges.find((one) => one.properties.station === "IA-IA-13");
    expect(parnell?.properties.inches).toBe(3.02);
    // Hail is an event rather than a running total, so two in a day are two
    // things that happened.
    expect(kept.filter((one) => one.properties.kind === "hail")).toHaveLength(
      3,
    );
  });

  it("asks each state once an hour however far the reader pans", () => {
    // The acceptance the layer was written to. The framework re-runs the
    // fetch whenever the view leaves the box the last answer was asked for,
    // which over one state is the same state again.
    const asked: string[] = [];
    const held = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => DAILY,
        text: async () => HAIL,
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const over = { west: -93.5, south: 41.4, east: -93.0, north: 41.8 };
      const nearby = { west: -93.2, south: 41.5, east: -92.7, north: 41.9 };
      return (async () => {
        await cocorahsOverlay.fetchData(over, undefined, {
          ...DEFAULT_OVERLAY_CHOICES,
        });
        const first = asked.length;
        // Two requests for the one state: the rain and the hail.
        expect(first).toBe(2);
        expect(asked[0]).toContain("State=IA");
        expect(asked[0]).toContain("ReportType=Daily");
        expect(asked[1]).toContain("ReportType=Hail");

        await cocorahsOverlay.fetchData(nearby, undefined, {
          ...DEFAULT_OVERLAY_CHOICES,
        });
        expect(asked).toHaveLength(first);
      })();
    } finally {
      globalThis.fetch = held;
    }
  });

  it("asks for nothing at all where the network does not reach", async () => {
    const asked: string[] = [];
    const held = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      throw new Error("nothing should have been asked for");
    }) as typeof fetch;
    try {
      const data = await cocorahsOverlay.fetchData(
        { west: -82, south: 47.5, east: -78, north: 49.5 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(asked).toEqual([]);
      expect(data.features).toEqual([]);
    } finally {
      globalThis.fetch = held;
    }
  });

  it("names the station and never a person", () => {
    // The item asks for this in as many words, and the feed makes it easy to
    // get wrong: the field beside the station number is called `st_name` and
    // in most volunteer networks that would be who the volunteer is. Here it
    // is where the gauge is, and nothing else in the answer is a person.
    const [gauge] = parseDaily(DAILY);
    const said = cocorahsOverlay.describe(gauge.properties);
    expect(said.title).toContain("IA-IA-13");
    expect(said.lines.join(" ")).toContain("Parnell 0.1 SSW");
    expect(said.lines.join(" ")).toContain("2.85");
    // The observer's own clock, said to be theirs: the service publishes a
    // local date and a local time with no zone on either.
    expect(said.lines.join(" ")).toContain("04:37 AM");
    expect(said.lines.at(-1)).toMatch(/observer/i);

    const [hail] = parseHail(HAIL);
    const stone = cocorahsOverlay.describe(hail.properties);
    expect(stone.title).toContain("CO-BO-435");
    expect(stone.lines.join(" ")).toContain("0.75");
    expect(stone.lines.join(" ")).toContain("20 minutes");
  });

  it("says a rain total and a stone in the reader's own units", () => {
    const [gauge] = parseDaily(DAILY);
    setUnits("metric");
    const metric = cocorahsOverlay.describe(gauge.properties);
    // 2.85 inches is 72.4 mm, and the millimetre is what everybody outside
    // the United States reads a rain total in. The separator is the
    // catalogue's rather than the unit setting's, which is why this reads as
    // a point: a Spanish reader gets a comma from the same call.
    expect(metric.lines.join(" ")).toContain("72.4 mm");
    expect(metric.lines.join(" ")).not.toContain("2.85");
  });

  it("stays inside the rate the item names, and asks per state", () => {
    expect(cocorahsOverlay.refreshMs).toBe(COCORAHS_REFRESH_MS);
    expect(COCORAHS_REFRESH_MS).toBe(60 * 60_000);
    expect(cocorahsOverlay.minZoom).toBe(COCORAHS_MIN_ZOOM);
    // Not `global`: the whole network is 2.7 MB and this layer asks for the
    // states on screen.
    expect(cocorahsOverlay.global).toBeFalsy();
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still answers per state, in the two shapes this reads", async () => {
    forgetCocorahs();
    const data = await cocorahsOverlay.fetchData(
      { west: -94, south: 41, east: -92.5, north: 42 },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // Twenty thousand observers, so somebody in Iowa reported in the last two
    // days whatever the weather did.
    expect(data.features.length).toBeGreaterThan(0);
    expect(data.partial).toBeUndefined();
    for (const feature of data.features) {
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
      expect(typeof feature.properties.station).toBe("string");
    }
    // A total that reads as a number, which is the field the whole layer is
    // about. A station can report without one, so this asks that some of
    // them carried one rather than that all did.
    expect(
      data.features.some(
        (one) =>
          one.properties.kind === "daily" &&
          typeof one.properties.inches === "number",
      ),
    ).toBe(true);
  }, 60_000);

  it("still answers an unknown state with the whole country", async () => {
    // The reason the state list is closed. If this ever stops being true the
    // guard could be relaxed, and if it is still true a code that slipped
    // into the list wrongly would pull megabytes without failing anything.
    const response = await fetch(
      "https://data.cocorahs.org/export/exportreports.aspx" +
        "?Format=json&ReportType=Daily&State=ON&Date=09/09/2026",
    );
    const body = (await response.json()) as {
      data?: { reports?: unknown[] };
    };
    const reports = body.data?.reports ?? [];
    expect(reports.length).toBeGreaterThan(5000);
  }, 120_000);

  it("still answers the hail report as a table, whatever Format says", async () => {
    const response = await fetch(
      "https://data.cocorahs.org/export/exportreports.aspx" +
        "?Format=json&ReportType=Hail&State=CO&StartDate=06/01/2026&EndDate=06/01/2026",
    );
    const body = await response.text();
    // The header this parser reads its columns off. If the service ever
    // honours `Format=json` here, or moves a column, this is what says so.
    // Split the way the parser splits: the live table arrives with
    // carriage returns and the fixture here does not.
    expect(body.split(/\r?\n/)[0]).toBe(HAIL.split("\n")[0]);
    const features = parseHail(body);
    expect(features.length).toBeGreaterThan(0);
    expect(
      features.every((one) => typeof one.properties.station === "string"),
    ).toBe(true);
  }, 60_000);

  it("has a box around every state that contains that state's gauges", async () => {
    // The one thing in this file that cannot be checked without the service:
    // a box written a degree too far east leaves a reader looking at real
    // gauges and shown none, with nothing to say why.
    for (const state of COCORAHS_STATES) {
      const response = await fetch(
        "https://data.cocorahs.org/export/exportreports.aspx" +
          `?Format=json&ReportType=Daily&State=${state.code}&Date=09/09/2026`,
      );
      const features = parseDaily(await response.json());
      // Every state had somebody reporting on that day; a state that
      // suddenly has nobody is worth knowing about too.
      expect(features.length, state.code).toBeGreaterThan(0);
      for (const feature of features) {
        const [lon, lat] = feature.geometry.coordinates as [number, number];
        const where = `${state.code} ${feature.properties.station} at ${lat}, ${lon}`;
        expect(lon, where).toBeGreaterThanOrEqual(state.west);
        expect(lon, where).toBeLessThanOrEqual(state.east);
        expect(lat, where).toBeGreaterThanOrEqual(state.south);
        expect(lat, where).toBeLessThanOrEqual(state.north);
      }
    }
  }, 600_000);
});

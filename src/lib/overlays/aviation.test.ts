import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import { AVIATION_REFRESH_MS, PIREP_LIMIT, aviationOverlay } from "./aviation";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * A convective SIGMET, in the shape the Aviation Weather Center answered with
 * on 2026-09-10. Trimmed to one ring; every property is the service's own.
 */
const SIGMET = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        icaoId: "KKCI",
        airSigmetType: "SIGMET",
        alphaChar: "W",
        hazard: "CONVECTIVE",
        seriesId: "10W",
        validTimeFrom: "2026-09-10T06:55:00.000Z",
        validTimeTo: "2026-09-10T08:55:00.000Z",
        severity: 5,
        altitudeHi1: 34000,
        altitudeLow1: null,
        rawAirSigmet: "CONVECTIVE SIGMET 10W\nVALID UNTIL 0855Z\nNM AZ",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-112.323, 32.815],
            [-110.539, 32.871],
            [-110.0, 31.5],
            [-112.323, 32.815],
          ],
        ],
      },
    },
  ],
};

/**
 * Two G-AIRMETs, in the shapes the service actually answers with.
 *
 * The freezing level is the odd one out: it is the only hazard carrying
 * `level`, and it arrives as a line. Turbulence and icing are areas carrying
 * `base` and `top` in hundreds of feet, with the severity that is the whole
 * content of a turbulence area. A fixture with only the first of those is why
 * the second went unread.
 */
const GAIRMET = {
  type: "FeatureCollection",
  num: 2,
  features: [
    {
      type: "Feature",
      properties: {
        product: "ZULU",
        hazard: "FZLVL",
        tag: "1C",
        issueTime: "2026-09-10T02:45:00.000Z",
        validTime: "2026-09-10T06:00:00.000Z",
        forecast: 3,
        level: "160",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [-106.63, 25.09],
          [-107.04, 24.69],
        ],
      },
    },
    {
      type: "Feature",
      properties: {
        product: "TANGO",
        hazard: "TURB-HI",
        validTime: "2026-09-10T09:00:00.000Z",
        forecast: 3,
        severity: "MOD",
        base: "290",
        top: "410",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-100, 40],
            [-98, 40],
            [-98, 42],
            [-100, 40],
          ],
        ],
      },
    },
  ],
};

/**
 * A pilot report, in the shape the mapping service answers with. Its field
 * names were read off the live service, which is also the one that has any:
 * the Aviation Weather Center's own pilot report endpoint answered with an
 * empty collection across the whole country over twenty-four hours.
 */
const PIREP = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-37.2, 59.35] },
      properties: {
        observation_time: 1789023900000,
        altitude_ft_msl: 39000,
        aircraft_ref: "LOT2PA",
        turbulence_intensity: null,
        icing_intensity: null,
        raw_text: "ARP TWY63 5355N02112W 0705 F370 DOGAL MS49 255/136 KT",
      },
    },
  ],
};

/**
 * A centre weather advisory, in the shape the service answers with.
 *
 * `base` and `top` are feet, which the service's own field aliases say and
 * which the earlier fixture here got wrong: it invented flight-level shaped
 * values so that multiplying by a hundred produced the right answer, and the
 * assertion beneath it agreed with the bug. The values below are a live
 * record's, and its own text says FL440 beside a `top` of 44000.
 */
const CWA = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95, 40],
            [-94, 40],
            [-94, 41],
            [-95, 40],
          ],
        ],
      },
      properties: {
        cwsu: "ZMA",
        cwaid: "5",
        hazard: "TS",
        // The stamps arrive as the service writes them, which is a string
        // with an offset on it rather than an epoch.
        validtimef: "2026/09/09 23:50:00+00",
        validtimet: "2026/09/10 01:50:00+00",
        base: null,
        top: "44000",
        cwatext: "ZMA CWA 503. TOPS EST FL440. EXP LTL CHG THRU PD.",
      },
    },
  ],
};

/** The four the layer asks for, answered in the order it asks. */
function serve(answers: unknown[]) {
  let at = 0;
  return async () => {
    const body = answers[at];
    at += 1;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  };
}

describe("what the air is doing to aircraft", () => {
  it("draws each of the four with its own valid times", async () => {
    const held = globalThis.fetch;
    globalThis.fetch = serve([SIGMET, GAIRMET, CWA, PIREP]) as typeof fetch;
    try {
      const data = await aviationOverlay.fetchData(
        { west: -180, south: -90, east: 180, north: 90 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.partial).toBeUndefined();
      const kinds = data.features.map((one) => one.properties.kind);
      expect(kinds).toEqual(["sigmet", "gairmet", "gairmet", "cwa", "pirep"]);

      const [sigmet, gairmet, turbulence, cwa, pirep] = data.features;
      expect(sigmet.properties.hazard).toBe("CONVECTIVE");
      expect(sigmet.properties.validFrom).toBe(
        Date.parse("2026-09-10T06:55:00.000Z"),
      );
      expect(sigmet.properties.validTo).toBe(
        Date.parse("2026-09-10T08:55:00.000Z"),
      );
      expect(sigmet.properties.highFeet).toBe(34000);

      // The freezing level comes as a line, which is why the layer draws
      // lines at all. Its level is written in hundreds of feet and it is a
      // contour rather than a ceiling: an area reaching up to sixteen
      // thousand feet is a different statement.
      expect(gairmet.geometry.type).toBe("LineString");
      expect(gairmet.properties.contourFeet).toBe(16000);
      expect(gairmet.properties.highFeet).toBeNull();

      // Turbulence is an area between two flight levels, and the severity is
      // the whole of what it says.
      expect(turbulence.properties.hazard).toBe("TURB-HI");
      expect(turbulence.properties.severity).toBe("MOD");
      expect(turbulence.properties.lowFeet).toBe(29000);
      expect(turbulence.properties.highFeet).toBe(41000);
      expect(turbulence.properties.contourFeet).toBeNull();

      // A centre advisory's base and top are already feet. Its own text says
      // FL440 and the field carries 44000; reading that as a flight level and
      // multiplying put the top of a thunderstorm 833 miles up.
      expect(cwa.properties.highFeet).toBe(44000);
      expect(cwa.properties.lowFeet).toBeNull();
      expect(cwa.properties.validTo).toBe(
        Date.parse("2026-09-10T01:50:00.000Z"),
      );

      // The two the item names for a pilot report.
      expect(pirep.properties.highFeet).toBe(39000);
      expect(pirep.properties.raw).toContain("F370");
    } finally {
      globalThis.fetch = held;
    }
  });

  it("says which product went missing rather than drawing the rest as complete", async () => {
    const held = globalThis.fetch;
    let at = 0;
    globalThis.fetch = (async () => {
      const body = [SIGMET, GAIRMET, CWA, PIREP][at];
      const failing = at === 1;
      at += 1;
      return {
        ok: !failing,
        status: failing ? 503 : 200,
        json: async () => body,
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const data = await aviationOverlay.fetchData(
        { west: -180, south: -90, east: 180, north: 90 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      // Losing the turbulence and icing grid must not read as clear air,
      // which on this layer is the difference between nothing there and
      // nobody answering.
      expect(data.partial).toContain("G-AIRMET");
      expect(data.features).toHaveLength(3);
      expect(
        data.features.every((one) => one.properties.kind !== "gairmet"),
      ).toBe(true);
    } finally {
      globalThis.fetch = held;
    }
  });

  it("says on every popup that it is not for flight planning", () => {
    // The acceptance asks for it, and a note somebody has to go and find is
    // not the same thing. Every kind carries it, including the pilot report
    // that is somebody else's observation rather than a forecast.
    for (const kind of ["sigmet", "gairmet", "cwa", "pirep"]) {
      const said = aviationOverlay.describe({
        kind,
        title: "SIGMET",
        hazard: "CONVECTIVE",
        validFrom: Date.parse("2026-09-10T06:55:00.000Z"),
        validTo: Date.parse("2026-09-10T08:55:00.000Z"),
        lowFeet: null,
        highFeet: 34000,
        raw: null,
      });
      expect(said.lines.at(-1)).toMatch(/flight planning/i);
    }
  });

  it("says a pilot report is at an altitude rather than up to one", () => {
    // A pilot report is somebody at that height saying what it was like
    // there. Read as a ceiling the popup said the turbulence ran from the
    // ground to thirty-nine thousand feet, which is a claim about the whole
    // column that nobody made.
    const said = aviationOverlay.describe({
      kind: "pirep",
      title: "PIREP",
      hazard: null,
      validFrom: Date.parse("2026-09-10T06:55:00.000Z"),
      validTo: null,
      lowFeet: null,
      highFeet: 39000,
      raw: "ARP UAL930 F390",
    });
    const lines = said.lines.join(" ");
    expect(lines).toContain("39,000 ft");
    expect(lines).not.toMatch(/up to/i);
  });

  it("keeps a floor that arrived without a ceiling", () => {
    // Both fields are independently absent on these products, and there was
    // no branch for a base without a top: the altitude was dropped with
    // nothing said, so a hazard from eight thousand feet up read as a hazard
    // at no particular height.
    const said = aviationOverlay.describe({
      kind: "cwa",
      title: "ZMA CWA 503",
      hazard: "TS",
      validFrom: null,
      validTo: null,
      lowFeet: 8000,
      highFeet: null,
      raw: null,
    });
    expect(said.lines.join(" ")).toContain("8,000 ft");
  });

  it("asks four times for the whole country, well inside the rate limit", () => {
    // One per minute per product is the ceiling the item names. Four
    // requests every five minutes is a fifth of that, and `global` is what
    // says a pan is not a reason to ask again.
    expect(aviationOverlay.global).toBe(true);
    expect(aviationOverlay.refreshMs).toBe(AVIATION_REFRESH_MS);
    const perMinutePerProduct = 1 / (AVIATION_REFRESH_MS / 60_000);
    expect(perMinutePerProduct).toBeLessThan(1);
    expect(PIREP_LIMIT).toBe(400);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still answers with the hazard areas this reads", async () => {
    const data = await aviationOverlay.fetchData(
      { west: -180, south: -90, east: 180, north: 90 },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // Something is always in the air over the country: SIGMETs, the
    // three-hourly grid, or reports from people flying through it. An empty
    // answer from all four means the shapes moved rather than the sky being
    // quiet.
    expect(data.features.length).toBeGreaterThan(0);
    for (const feature of data.features) {
      expect(typeof feature.properties.kind).toBe("string");
      expect(feature.geometry).toBeTruthy();
    }
    // The grid is issued around the clock, so this one can insist.
    const grid = data.features.filter(
      (one) => one.properties.kind === "gairmet",
    );
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.every((one) => typeof one.properties.hazard === "string")).toBe(
      true,
    );

    // Every altitude this draws has to be an altitude. The contract used to
    // check only that features arrived, which is why a centre advisory read
    // as flight levels and multiplied by a hundred shipped saying the top of
    // a thunderstorm was 833 miles up. Nothing in these products is above the
    // Karman line or below the sea.
    for (const feature of data.features) {
      for (const key of ["lowFeet", "highFeet", "contourFeet"]) {
        const feet = feature.properties[key];
        if (typeof feet !== "number") continue;
        const said = `${String(feature.properties.kind)} ${key} is ${feet} ft`;
        expect(feet, said).toBeGreaterThanOrEqual(-1000);
        expect(feet, said).toBeLessThanOrEqual(100_000);
      }
    }

    // And the turbulence and icing areas, which are what this layer is turned
    // on for, have to carry the altitudes and the severity a forecaster put on
    // them rather than only the freezing level contours doing so.
    const areas = grid.filter((one) =>
      ["TURB-HI", "TURB-LO", "ICE"].includes(String(one.properties.hazard)),
    );
    if (areas.length > 0) {
      expect(
        areas.some((one) => typeof one.properties.highFeet === "number"),
      ).toBe(true);
      expect(
        areas.some((one) => typeof one.properties.severity === "string"),
      ).toBe(true);
    }

    // The mapping service is the other half of this layer and the contract
    // never touched it. Its two products answer around the clock.
    const charted = data.features.filter((one) =>
      ["cwa", "pirep"].includes(String(one.properties.kind)),
    );
    expect(charted.length).toBeGreaterThan(0);
  });
});

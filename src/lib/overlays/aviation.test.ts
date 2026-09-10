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

/** A G-AIRMET, which carries the freezing level as a line rather than an area. */
const GAIRMET = {
  type: "FeatureCollection",
  num: 1,
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

/** A centre weather advisory, on the field names the service defines. */
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
        cwsu: "ZKC",
        cwaid: "1",
        hazard: "TS",
        validtimef: 1789023900000,
        validtimet: 1789031100000,
        base: 40,
        top: 350,
        cwatext: "ISOLD TS MOV LTL. TOPS TO FL350.",
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
      expect(kinds).toEqual(["sigmet", "gairmet", "cwa", "pirep"]);

      const [sigmet, gairmet, cwa, pirep] = data.features;
      expect(sigmet.properties.hazard).toBe("CONVECTIVE");
      expect(sigmet.properties.validFrom).toBe(
        Date.parse("2026-09-10T06:55:00.000Z"),
      );
      expect(sigmet.properties.validTo).toBe(
        Date.parse("2026-09-10T08:55:00.000Z"),
      );
      expect(sigmet.properties.highFeet).toBe(34000);

      // The freezing level comes as a line, which is why the layer draws
      // lines at all, and its level is written in hundreds of feet.
      expect(gairmet.geometry.type).toBe("LineString");
      expect(gairmet.properties.highFeet).toBe(16000);

      // A centre advisory's base and top are flight levels for the same
      // reason, so 40 and 350 are 4,000 and 35,000 feet.
      expect(cwa.properties.lowFeet).toBe(4000);
      expect(cwa.properties.highFeet).toBe(35000);
      expect(cwa.properties.validTo).toBe(1789031100000);

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
  });
});

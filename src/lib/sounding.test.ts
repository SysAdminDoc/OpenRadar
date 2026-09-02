import { describe, expect, it } from "vitest";
import {
  SOUNDING_SITES,
  forecastUrl,
  launchHour,
  nearestSite,
  parseForecastSounding,
  parseRaob,
  parseRaobTime,
  raobUrl,
  observedSounding,
  forecastSounding,
} from "./sounding";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** The shape the service answers with, taken from a real response. */
const RAOB = {
  profiles: [
    {
      station: "KOAX",
      valid: "08/31/2026 00:00:00",
      profile: [
        // The service publishes the whole ladder and fills in what the
        // balloon reported, so the top of a real list is mostly nulls.
        {
          pres: 1000,
          hght: 52,
          tmpc: null,
          dwpc: null,
          drct: null,
          sknt: null,
        },
        { pres: 967, hght: 350, tmpc: 31.6, dwpc: 21.6, drct: 180, sknt: 6 },
        { pres: 958, hght: 434.88, tmpc: 30.3, dwpc: 19.3, drct: 190, sknt: 9 },
        { pres: 850, hght: 1520, tmpc: 21.2, dwpc: 16.4, drct: 205, sknt: 14 },
        { pres: 700, hght: 3160, tmpc: 9.4, dwpc: 3.1, drct: 230, sknt: 22 },
        { pres: 500, hght: 5880, tmpc: -7.5, dwpc: -18, drct: 250, sknt: 35 },
        // Humidity sensors ice up: a level with a temperature and no
        // dewpoint is still a level.
        { pres: 300, hght: 9620, tmpc: -38.1, dwpc: null, drct: 265, sknt: 62 },
      ],
    },
  ],
  generated_at: "2026-09-02T01:48:31Z",
};

describe("reading an observed sounding", () => {
  it("keeps the levels the balloon actually reported", () => {
    const sounding = parseRaob(RAOB);
    expect(sounding).not.toBeNull();
    if (!sounding) return;
    expect(sounding.kind).toBe("observed");
    // Six of the seven: the 1000 hPa row has nothing in it.
    expect(sounding.levels).toHaveLength(6);
    expect(sounding.levels[0].pressure).toBe(967);
    expect(sounding.levels[0].temperature).toBe(31.6);
    expect(sounding.levels[0].windKnots).toBe(6);
    // Deepest first, whatever order the service used.
    const pressures = sounding.levels.map((level) => level.pressure);
    expect([...pressures].sort((a, b) => b - a)).toEqual(pressures);
  });

  it("reads the service's own timestamp as the UTC it is", () => {
    // `08/31/2026 00:00:00` with no zone marker. Read as local time it puts a
    // midnight balloon six hours out, which is a different sounding.
    expect(parseRaobTime("08/31/2026 00:00:00")).toBe(
      Date.parse("2026-08-31T00:00:00Z") / 1000,
    );
    expect(parseRaobTime("12/01/2026 12:00:00")).toBe(
      Date.parse("2026-12-01T12:00:00Z") / 1000,
    );
    expect(parseRaobTime("nonsense")).toBeNull();
    expect(parseRaobTime(null)).toBeNull();
    // The parsed sounding carries it.
    expect(parseRaob(RAOB)?.valid).toBe(
      Date.parse("2026-08-31T00:00:00Z") / 1000,
    );
  });

  it("keeps a level whose humidity sensor gave nothing", () => {
    const sounding = parseRaob(RAOB);
    const top = sounding?.levels.at(-1);
    expect(top?.pressure).toBe(300);
    // The moisture curve stops rather than the level vanishing, so the
    // temperature trace stays whole.
    expect(top?.dewpoint).toBe(top?.temperature);
  });

  it("has nothing to draw from an empty or broken answer", () => {
    expect(parseRaob({ profiles: [] })).toBeNull();
    expect(parseRaob({})).toBeNull();
    expect(parseRaob(null)).toBeNull();
    // A profile too thin to be a sounding is not one.
    expect(
      parseRaob({
        profiles: [
          {
            station: "KOAX",
            valid: "08/31/2026 00:00:00",
            profile: [{ pres: 1000, hght: 52, tmpc: 20, dwpc: 15 }],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("which balloon, and when", () => {
  it("asks the site nearest the reader", () => {
    // Des Moines, which is closest to the Omaha and Valley launch site.
    const near = nearestSite(41.6, -93.6);
    expect(near?.site.id).toBe("KOAX");
    expect(near?.km).toBeLessThan(250);
    // And somewhere with its own site.
    expect(nearestSite(35.2, -97.4)?.site.id).toBe("KOUN");
  });

  it("asks for an hour a balloon actually went up in", () => {
    // Nobody launches at 17Z, and the service holds nothing for it.
    const evening = Date.parse("2026-08-31T17:30:00Z") / 1000;
    expect(launchHour(evening)).toBe(Date.parse("2026-08-31T12:00:00Z") / 1000);
    const morning = Date.parse("2026-08-31T05:00:00Z") / 1000;
    expect(launchHour(morning)).toBe(Date.parse("2026-08-31T00:00:00Z") / 1000);
    expect(raobUrl("KOAX", evening)).toContain("ts=2026-08-31T12%3A00%3A00Z");
    expect(raobUrl("KOAX", evening)).toContain("station=KOAX");
  });

  it("carries a real site list", () => {
    expect(SOUNDING_SITES.length).toBeGreaterThan(60);
    for (const site of SOUNDING_SITES) {
      expect(site.id).toMatch(/^[A-Z0-9]{4}$/);
      expect(site.state).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(site.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(site.longitude)).toBeLessThanOrEqual(180);
      expect(site.name.length).toBeGreaterThan(1);
    }
  });
});

/** The shape Open-Meteo answers with, for two hours and two levels. */
const MODEL = {
  latitude: 41.6,
  longitude: -93.6,
  hourly: {
    time: ["2026-09-02T00:00", "2026-09-02T01:00"],
    temperature_1000hPa: [35.9, 34.1],
    dew_point_1000hPa: [20.2, 20.0],
    wind_speed_1000hPa: [7.2, 8.1],
    wind_direction_1000hPa: [180, 190],
    geopotential_height_1000hPa: [84, 80],
    temperature_850hPa: [21.0, 20.4],
    dew_point_850hPa: [15.0, 14.8],
    wind_speed_850hPa: [18, 20],
    wind_direction_850hPa: [200, 205],
    geopotential_height_850hPa: [1500, 1495],
    temperature_700hPa: [9.0, 8.6],
    dew_point_700hPa: [1.0, 0.8],
    wind_speed_700hPa: [25, 27],
    wind_direction_700hPa: [230, 235],
    geopotential_height_700hPa: [3130, 3125],
    temperature_500hPa: [-8.0, -8.2],
    dew_point_500hPa: [-20.0, -20.4],
    wind_speed_500hPa: [40, 42],
    wind_direction_500hPa: [250, 255],
    geopotential_height_500hPa: [5850, 5845],
    temperature_400hPa: [-21.0, -21.3],
    dew_point_400hPa: [-34.0, -34.2],
    wind_speed_400hPa: [55, 57],
    wind_direction_400hPa: [258, 260],
    geopotential_height_400hPa: [7480, 7470],
    temperature_300hPa: [-38.0, -38.2],
    dew_point_300hPa: [-52.0, -52.4],
    wind_speed_300hPa: [70, 72],
    wind_direction_300hPa: [265, 265],
    geopotential_height_300hPa: [9600, 9590],
  },
};

describe("reading a forecast sounding", () => {
  it("takes the hour nearest the one asked for and says it is a forecast", () => {
    const wanted = Date.parse("2026-09-02T00:40:00Z") / 1000;
    const sounding = parseForecastSounding(MODEL, wanted);
    expect(sounding).not.toBeNull();
    if (!sounding) return;
    expect(sounding.kind).toBe("forecast");
    // 00:40 is nearer 01:00 than 00:00.
    expect(sounding.valid).toBe(Date.parse("2026-09-02T01:00:00Z") / 1000);
    expect(sounding.levels[0].temperature).toBe(34.1);
    expect(sounding.levels).toHaveLength(6);
    expect(sounding.levels[0].pressure).toBe(1000);
    expect(sounding.levels.at(-1)?.pressure).toBe(300);
    // Knots, because the request asks for them and everything above reads
    // wind in knots.
    expect(sounding.levels[0].windKnots).toBe(8.1);
  });

  it("skips a level the model did not publish", () => {
    const thin = {
      hourly: {
        ...MODEL.hourly,
        temperature_700hPa: [null, null],
      },
    };
    const sounding = parseForecastSounding(
      thin,
      Date.parse("2026-09-02T00:00:00Z") / 1000,
    );
    expect(sounding?.levels.map((level) => level.pressure)).toEqual([
      1000, 850, 500, 400, 300,
    ]);
  });

  it("has nothing to draw from an answer with no hours in it", () => {
    expect(parseForecastSounding({}, 0)).toBeNull();
    expect(parseForecastSounding({ hourly: { time: [] } }, 0)).toBeNull();
  });

  it("asks the model for every level it will draw, for one hour", () => {
    const url = forecastUrl(
      41.6,
      -93.6,
      Date.parse("2026-09-02T00:20:00Z") / 1000,
    );
    expect(url).toContain("temperature_500hPa");
    expect(url).toContain("dew_point_500hPa");
    expect(url).toContain("geopotential_height_500hPa");
    expect(url).toContain("wind_speed_unit=kn");
    expect(url).toContain("timezone=UTC");
    // A hundred and five series per hour: asking for days of them would be
    // fifty times the answer for the one hour anybody is looking at, on a
    // free service whose fair use is counted in variable-hours.
    expect(url).toContain("start_hour=2026-09-02T00%3A00");
    expect(url).toContain("end_hour=2026-09-02T00%3A00");
    expect(url).not.toContain("forecast_days");
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("reads a real balloon over the plains", async () => {
    // 00Z and 12Z every day at every site in the list, so yesterday's is
    // always there. An empty answer means the query shape has moved.
    const yesterday = Math.floor(Date.now() / 1000) - 36 * 3600;
    const sounding = await observedSounding(41.6, -93.6, yesterday);
    expect(sounding).not.toBeNull();
    if (!sounding) return;
    expect(sounding.kind).toBe("observed");
    expect(sounding.levels.length).toBeGreaterThan(20);
    expect(sounding.label).toContain("(");
    for (const level of sounding.levels) {
      expect(level.pressure).toBeGreaterThan(0);
      expect(level.pressure).toBeLessThanOrEqual(1100);
      expect(level.temperature).toBeGreaterThan(-100);
      expect(level.temperature).toBeLessThan(60);
      expect(level.dewpoint).toBeLessThanOrEqual(level.temperature + 0.5);
    }
  }, 30_000);

  it("reads a real model column", async () => {
    const now = Math.floor(Date.now() / 1000) + 3 * 3600;
    const sounding = await forecastSounding(41.6, -93.6, now);
    expect(sounding).not.toBeNull();
    if (!sounding) return;
    expect(sounding.kind).toBe("forecast");
    expect(sounding.levels.length).toBeGreaterThan(10);
    // The pressure ladder descends and the heights climb with it.
    for (let at = 1; at < sounding.levels.length; at += 1) {
      expect(sounding.levels[at].pressure).toBeLessThan(
        sounding.levels[at - 1].pressure,
      );
      expect(sounding.levels[at].height).toBeGreaterThan(
        sounding.levels[at - 1].height,
      );
    }
  }, 30_000);
});

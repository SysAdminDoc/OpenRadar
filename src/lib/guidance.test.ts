import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GUIDANCE_MODELS,
  disagreement,
  fetchGuidance,
  modelsThatAnswered,
  parseGuidance,
  parseModelRun,
  runIsStale,
  type GuidanceModelId,
} from "./guidance";
import { forecastUnits, setUnits } from "./units";

const POINT = { lat: 29.95, lon: -90.07 };
const MODELS: GuidanceModelId[] = ["gfs_seamless", "ecmwf_ifs025"];

/** Six hours of two models, shaped the way Open-Meteo answers. */
const PAYLOAD = {
  hourly_units: {
    time: "iso8601",
    temperature_2m_gfs_seamless: "°C",
    precipitation_gfs_seamless: "mm",
    wind_speed_10m_gfs_seamless: "km/h",
    temperature_2m_ecmwf_ifs025: "°C",
    precipitation_ecmwf_ifs025: "mm",
    wind_speed_10m_ecmwf_ifs025: "km/h",
  },
  hourly: {
    time: [
      "2026-08-30T00:00",
      "2026-08-30T01:00",
      "2026-08-30T02:00",
      "2026-08-30T03:00",
      "2026-08-30T04:00",
      "2026-08-30T05:00",
    ],
    temperature_2m_gfs_seamless: [26, 26.2, 26.4, 27, 27.5, 28],
    temperature_2m_ecmwf_ifs025: [24, 24.1, 24.3, 25, 25.5, 26],
    precipitation_gfs_seamless: [0, 0, 0.2, 1.4, 0, 0],
    precipitation_ecmwf_ifs025: [0, 0, 0, 0.1, 0, 0],
    wind_speed_10m_gfs_seamless: [12, 12, 13, 14, 15, 16],
    wind_speed_10m_ecmwf_ifs025: [11, 11, 12, 13, 14, 15],
  },
};

describe("reading several models at once", () => {
  it("puts each model's value on the same hour", () => {
    const guidance = parseGuidance(PAYLOAD, POINT, MODELS);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;

    // Every third hour, so a day and a half fits across the panel.
    expect(temperature.hours).toHaveLength(2);
    expect(temperature.hours[0].time).toBe(Date.parse("2026-08-30T00:00Z"));
    expect(temperature.hours[1].time).toBe(Date.parse("2026-08-30T03:00Z"));
    // The reading a model gave for that hour, not the one beside it.
    expect(temperature.hours[0].values).toEqual([26, 24]);
    expect(temperature.hours[1].values).toEqual([27, 25]);
    expect(temperature.unit).toBe("°C");
  });

  it("reads the times as UTC rather than as local", () => {
    // Open-Meteo answers with a naive ISO string and is asked for UTC. Letting
    // the browser guess would put every hour out by the machine's offset,
    // which is how a forecast ends up drawn against the wrong radar frame.
    const guidance = parseGuidance(PAYLOAD, POINT, MODELS);
    const first = guidance.readings[0].hours[0].time;
    expect(new Date(first).getUTCHours()).toBe(0);
  });

  it("measures how far apart the models are", () => {
    const guidance = parseGuidance(PAYLOAD, POINT, MODELS);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;
    // Two degrees at every hour, on a range of 26 to 24 and 27 to 25.
    expect(temperature.spread).toBeCloseTo(2, 5);
    // Three degrees of range across everything, two of it disagreement.
    expect(disagreement(temperature)).toBeCloseTo(2 / 3, 5);
  });

  it("says nothing rather than zero where a model has no answer", () => {
    const thin = parseGuidance(
      {
        hourly_units: { temperature_2m_gfs_seamless: "°C" },
        hourly: {
          time: ["2026-08-30T00:00", "2026-08-30T03:00"],
          temperature_2m_gfs_seamless: [26, null],
          // ECMWF answered with nothing at all, as it does outside its grid.
          temperature_2m_ecmwf_ifs025: [],
        },
      },
      POINT,
      MODELS,
    );
    const temperature = thin.readings[0];
    expect(temperature.hours[0].values).toEqual([26, null]);
    expect(temperature.hours[1].values).toEqual([null, null]);
    // A missing reading is not a cold hour, and must not count as agreement.
    expect(temperature.spread).toBe(0);
    expect(modelsThatAnswered(thin)).toEqual(["gfs_seamless"]);
  });

  it("reads a single model's reply, which carries no suffix", () => {
    const one = parseGuidance(
      {
        hourly_units: { temperature_2m: "°C" },
        hourly: {
          time: ["2026-08-30T00:00", "2026-08-30T03:00"],
          temperature_2m: [26, 27],
        },
      },
      POINT,
      ["gfs_seamless"],
    );
    expect(one.readings[0].hours.map((hour) => hour.values)).toEqual([
      [26],
      [27],
    ]);
    expect(one.readings[0].unit).toBe("°C");
  });

  it("names every model it offers", () => {
    // A model in the list with no name is a blank column in the panel.
    for (const model of GUIDANCE_MODELS) {
      expect(model.key).toMatch(/^guidance\./);
      expect(model.centre.length).toBeGreaterThan(0);
    }
  });
});

const live = process.env.OPENRADAR_LIVE ? describe : describe.skip;

live("against Open-Meteo itself", () => {
  // The unit system is module state that any earlier test can move, and the
  // request carries whichever one is in force. Pinning it here is what makes
  // the assertion below about the service rather than about test ordering.
  beforeEach(() => setUnits("metric"));
  afterEach(() => setUnits("imperial"));

  it("brings back three models that mostly agree about tomorrow", async () => {
    const models: GuidanceModelId[] = [
      "gfs_seamless",
      "ecmwf_ifs025",
      "icon_seamless",
    ];
    const guidance = await fetchGuidance({ lat: 29.95, lon: -90.07 }, models);

    expect(modelsThatAnswered(guidance)).toEqual(models);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;
    // The service has to answer in the unit the request asked for. Asserting a
    // fixed string instead was wrong in both directions: it failed against a
    // correct fahrenheit answer under the default imperial setting, and it
    // would have passed had the service ignored the parameter entirely.
    const asked = forecastUnits().temperature_unit;
    expect(asked).toBe("celsius");
    expect(temperature.unit).toBe("°C");
    expect(temperature.hours.length).toBeGreaterThan(8);

    // Every column is on a three-hourly boundary and runs forwards.
    for (let at = 0; at < temperature.hours.length; at += 1) {
      expect(new Date(temperature.hours[at].time).getUTCHours() % 3).toBe(0);
      if (at) {
        expect(temperature.hours[at].time).toBeGreaterThan(
          temperature.hours[at - 1].time,
        );
      }
    }

    // New Orleans in any season is between a frost and a furnace, and three
    // models are not going to be thirty degrees apart about it.
    const readings = temperature.hours.flatMap((hour) =>
      hour.values.filter((value): value is number => value !== null),
    );
    expect(Math.min(...readings)).toBeGreaterThan(-15);
    expect(Math.max(...readings)).toBeLessThan(50);
    expect(temperature.spread).toBeLessThan(15);
    // But they are not the same model, so they are not identical either.
    expect(temperature.spread).toBeGreaterThan(0);
  }, 30_000);
});

describe("comparing a model against its previous run", () => {
  /** The same reply, with what the earlier run said beside it. */
  const WITH_PREVIOUS = {
    hourly_units: PAYLOAD.hourly_units,
    hourly: {
      ...PAYLOAD.hourly,
      temperature_2m_previous_day1_gfs_seamless: [25, 25.2, 25.4, 26, 26.5, 27],
      // The earlier ECMWF run stops short, which is what a model that was not
      // run that far, or an archive that has been trimmed, looks like.
      temperature_2m_previous_day1_ecmwf_ifs025: [
        24.5,
        24.6,
        24.8,
        null,
        null,
        null,
      ],
      precipitation_previous_day1_gfs_seamless: [0, 0, 0, 0.4, 0, 0],
      precipitation_previous_day1_ecmwf_ifs025: [0, 0, 0, 0, 0, 0],
      wind_speed_10m_previous_day1_gfs_seamless: [10, 10, 11, 12, 13, 14],
      wind_speed_10m_previous_day1_ecmwf_ifs025: [11, 11, 11, 12, 13, 14],
    },
  };

  it("puts the earlier run on the same valid hours", () => {
    const guidance = parseGuidance(WITH_PREVIOUS, POINT, MODELS, true);
    expect(guidance.comparedWithPreviousRun).toBe(true);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;
    // Midnight and three, which are the hours the panel keeps.
    const [midnight, three] = temperature.hours;
    expect(midnight.values).toEqual([26, 24]);
    expect(midnight.previous).toEqual([25, 24.5]);
    expect(three.values).toEqual([27, 25]);
    // The earlier ECMWF run had nothing at three, and says so rather than
    // reading as no change.
    expect(three.previous).toEqual([26, null]);
  });

  it("says nothing about a previous run nobody asked for", () => {
    const guidance = parseGuidance(WITH_PREVIOUS, POINT, MODELS);
    expect(guidance.comparedWithPreviousRun).toBeUndefined();
    for (const reading of guidance.readings) {
      for (const hour of reading.hours) {
        expect(hour.previous).toBeUndefined();
      }
    }
  });

  it("leaves the hours empty when the archive has none", () => {
    // Asked for, and the service answered without the extra variables, which
    // is what a model with no archive looks like.
    const guidance = parseGuidance(PAYLOAD, POINT, MODELS, true);
    expect(guidance.comparedWithPreviousRun).toBe(true);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;
    expect(temperature.hours[0].previous).toEqual([null, null]);
  });

  it("still lands every hour on UTC", () => {
    const guidance = parseGuidance(WITH_PREVIOUS, POINT, MODELS, true);
    const temperature = guidance.readings.find(
      (reading) => reading.variable === "temperature_2m",
    )!;
    for (const hour of temperature.hours) {
      expect(new Date(hour.time).getUTCHours() % 3).toBe(0);
    }
    expect(temperature.hours[0].time).toBe(Date.UTC(2026, 7, 30, 0));
  });
});

describe("when a model last ran", () => {
  it("reads the run out of the service's own metadata", () => {
    const run = parseModelRun({
      last_run_initialisation_time: 1788177600,
      last_run_availability_time: 1788198595,
      update_interval_seconds: 21600,
    })!;
    expect(run.initUtc).toBe(1788177600000);
    expect(run.availableUtc).toBe(1788198595000);
    expect(run.intervalSeconds).toBe(21600);
  });

  it("has no run rather than a made-up one", () => {
    expect(parseModelRun(null)).toBeNull();
    expect(parseModelRun({})).toBeNull();
    expect(parseModelRun({ last_run_initialisation_time: "soon" })).toBeNull();
    expect(parseModelRun({ last_run_initialisation_time: 0 })).toBeNull();
  });

  it("falls back to the initialisation when nothing says it arrived", () => {
    const run = parseModelRun({ last_run_initialisation_time: 1788177600 })!;
    expect(run.availableUtc).toBe(run.initUtc);
    expect(run.intervalSeconds).toBe(0);
  });

  it("calls a run stale only when it is past its own schedule", () => {
    const run = {
      initUtc: Date.UTC(2026, 7, 31, 0),
      availableUtc: Date.UTC(2026, 7, 31, 4),
      intervalSeconds: 21600,
    };
    // Four hours later is an ordinary morning: the run has not even finished
    // arriving in some models.
    expect(runIsStale(run, Date.UTC(2026, 7, 31, 4))).toBe(false);
    // A skipped cycle is not news either.
    expect(runIsStale(run, Date.UTC(2026, 7, 31, 12))).toBe(false);
    // Three months is not a model running late.
    expect(runIsStale(run, Date.UTC(2026, 10, 31, 0))).toBe(true);
    // A model that does not say how often it runs is never called stale.
    expect(
      runIsStale({ ...run, intervalSeconds: 0 }, Date.UTC(2027, 0, 1)),
    ).toBe(false);
  });
});

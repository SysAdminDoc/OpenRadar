import { describe, expect, it } from "vitest";
import {
  GUIDANCE_MODELS,
  disagreement,
  fetchGuidance,
  modelsThatAnswered,
  parseGuidance,
  type GuidanceModelId,
} from "./guidance";

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

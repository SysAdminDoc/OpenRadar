import { describe, expect, it } from "vitest";
import {
  MAX_SAMPLES,
  parseRoute,
  readRouteForecast,
  routeGeoJson,
  sampleRoute,
} from "./route";

/** A straight line down one meridian, a degree of latitude per point. */
function straightRoute(points: number) {
  return {
    coordinates: Array.from(
      { length: points },
      (_, index) => [-96.8, 33 - index] as [number, number],
    ),
    // A degree of latitude is about sixty-nine miles.
    distanceMiles: 69.09 * (points - 1),
    durationSeconds: 3600 * (points - 1),
  };
}

describe("route parsing", () => {
  it("reads the first route and converts to miles", () => {
    const route = parseRoute({
      code: "Ok",
      routes: [
        {
          distance: 160934.4,
          duration: 7200,
          geometry: {
            coordinates: [
              [-96.8, 32.8],
              [-96, 32],
              [-95.4, 29.8],
            ],
          },
        },
      ],
    });
    expect(route?.distanceMiles).toBeCloseTo(100, 3);
    expect(route?.durationSeconds).toBe(7200);
    expect(route?.coordinates).toHaveLength(3);
  });

  it("refuses a response with no usable route", () => {
    expect(parseRoute({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseRoute({ code: "Ok", routes: [{ geometry: {} }] })).toBeNull();
    expect(parseRoute(null)).toBeNull();
  });
});

describe("route sampling", () => {
  it("spaces samples out and spreads the drive time over them", () => {
    const samples = sampleRoute(straightRoute(5), 100);
    expect(samples[0].distanceMiles).toBe(0);
    expect(samples[0].offsetSeconds).toBe(0);
    expect(samples.at(-1)?.distanceMiles).toBeCloseTo(276.4, 0);
    expect(samples.at(-1)?.offsetSeconds).toBeCloseTo(14400, -1);
    for (const sample of samples.slice(1)) {
      expect(sample.distanceMiles).toBeGreaterThan(0);
    }
  });

  it("always keeps the far end of a long route", () => {
    const samples = sampleRoute(straightRoute(60), 10);
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0].distanceMiles).toBe(0);
    expect(samples.at(-1)?.distanceMiles).toBeGreaterThan(3800);
  });
});

describe("route forecast", () => {
  const samples = [
    {
      point: { lat: 33, lon: -96.8 },
      distanceMiles: 0,
      offsetSeconds: 0,
      index: 0,
    },
    {
      point: { lat: 31, lon: -96.8 },
      distanceMiles: 138,
      offsetSeconds: 7200,
      index: 2,
    },
  ];
  const departure = Date.parse("2026-08-30T12:00:00Z");

  const payload = [
    {
      hourly: {
        time: ["2026-08-30T12:00", "2026-08-30T13:00", "2026-08-30T14:00"],
        temperature_2m: [80, 84, 88],
        precipitation_probability: [10, 20, 30],
        weather_code: [1, 61, 95],
      },
    },
    {
      hourly: {
        time: ["2026-08-30T12:00", "2026-08-30T13:00", "2026-08-30T14:00"],
        temperature_2m: [90, 92, 95],
        precipitation_probability: [0, 5, 70],
        weather_code: [0, 1, 95],
      },
    },
  ];

  it("reads the hour each sample is reached, not the hour of departure", () => {
    const conditions = readRouteForecast(payload, samples, departure);
    expect(conditions[0].temperature).toBe(80);
    expect(conditions[0].precipitationChance).toBe(10);
    // Two hours down the road lands on the 14:00 row of the second point.
    expect(conditions[1].temperature).toBe(95);
    expect(conditions[1].precipitationChance).toBe(70);
    expect(conditions[1].weatherCode).toBe(95);
  });

  it("reports nothing rather than guessing when a point has no series", () => {
    const conditions = readRouteForecast([payload[0]], samples, departure);
    expect(conditions[1].temperature).toBeNull();
    expect(conditions[1].precipitationChance).toBeNull();
  });

  it("colours each leg by the chance of rain when the driver gets there", () => {
    const conditions = readRouteForecast(payload, samples, departure);
    const geojson = routeGeoJson(straightRoute(3), conditions) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].properties.precipitationChance).toBe(70);
  });
});

describe("routes that cross themselves", () => {
  const loop = {
    coordinates: [
      [-97, 35.3],
      [-96.5, 35.3],
      [-96.5, 35.8],
      [-97, 35.8],
      [-97, 35.3],
      [-97.5, 35.3],
    ] as Array<[number, number]>,
    distanceMiles: 120,
    durationSeconds: 7200,
  };

  it("draws each leg once, even where the road returns to a junction", () => {
    const samples = sampleRoute(loop, 20);
    const conditions = samples.map((sample, index) => ({
      ...sample,
      arrival: 0,
      temperature: 70,
      precipitationChance: index * 10,
      weatherCode: 1,
    }));
    const geojson = routeGeoJson(loop, conditions) as {
      features: Array<{
        geometry: { coordinates: Array<[number, number]> };
      }>;
    };

    // Every leg walks forward along the polyline, so no coordinate is drawn
    // twice within one leg.
    for (const feature of geojson.features) {
      const seen = new Set(
        feature.geometry.coordinates.map((pair) => pair.join(",")),
      );
      expect(seen.size).toBe(feature.geometry.coordinates.length);
    }
  });

  it("never repeats a sample where the polyline repeats a vertex", () => {
    const samples = sampleRoute(
      {
        coordinates: [
          [-97, 35],
          [-97, 35.3],
          [-97, 35.3],
        ],
        distanceMiles: 21,
        durationSeconds: 1800,
      },
      10,
    );
    const distances = samples.map((sample) => sample.distanceMiles);
    expect(new Set(distances).size).toBe(distances.length);
  });
});

describe("an arrival past the forecast", () => {
  it("reports nothing rather than the nearest hour it has", () => {
    const samples = [
      {
        point: { lat: 33, lon: -96.8 },
        distanceMiles: 0,
        offsetSeconds: 0,
        index: 0,
      },
    ];
    const conditions = readRouteForecast(
      [
        {
          hourly: {
            time: ["2026-08-30T12:00", "2026-08-30T13:00"],
            temperature_2m: [80, 84],
            precipitation_probability: [10, 90],
            weather_code: [1, 95],
          },
        },
      ],
      samples,
      Date.parse("2026-09-05T12:00:00Z"),
    );
    expect(conditions[0].temperature).toBeNull();
    expect(conditions[0].precipitationChance).toBeNull();
  });
});

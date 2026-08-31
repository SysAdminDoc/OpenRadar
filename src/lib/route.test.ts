import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SAMPLES,
  ROUTER_MIN_GAP_MS,
  fetchRoute,
  parseRoute,
  resetRouterThrottle,
  straightRoute as lineBetween,
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
  /** The three points below, encoded the way the router sends a leg. */
  const SHAPE = "_o}p}@~neswD~nyo@_oyo@~zgeC_{rc@";

  it("reads the trip and keeps its miles", () => {
    const route = parseRoute({
      trip: {
        status: 0,
        units: "miles",
        summary: { length: 100, time: 7200 },
        legs: [{ shape: SHAPE }],
      },
    });
    expect(route?.distanceMiles).toBeCloseTo(100, 3);
    expect(route?.durationSeconds).toBe(7200);
    expect(route?.coordinates).toHaveLength(3);
    expect(route?.coordinates[0][0]).toBeCloseTo(-96.8, 5);
    expect(route?.coordinates[2][1]).toBeCloseTo(29.8, 5);
  });

  // A kilometre answer read as miles would draw a drive two thirds too short,
  // with every arrival time along it wrong in the same direction.
  it("converts when the router answers in kilometres", () => {
    const route = parseRoute({
      trip: {
        status: 0,
        units: "kilometers",
        summary: { length: 160.9344, time: 7200 },
        legs: [{ shape: SHAPE }],
      },
    });
    expect(route?.distanceMiles).toBeCloseTo(100, 3);
  });

  // Legs meet at a shared point. Keeping both copies puts a sample no distance
  // from the one before it.
  it("joins legs without repeating the point they share", () => {
    const route = parseRoute({
      trip: {
        status: 0,
        units: "miles",
        summary: { length: 100, time: 7200 },
        legs: [{ shape: SHAPE }, { shape: SHAPE }],
      },
    });
    expect(route?.coordinates).toHaveLength(5);
  });

  it("refuses a response with no usable route", () => {
    expect(parseRoute({ trip: { status: 1, legs: [] } })).toBeNull();
    expect(parseRoute({ trip: { status: 0, legs: [{}] } })).toBeNull();
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

describe("the demo router is used gently", () => {
  beforeEach(() => {
    resetRouterThrottle();
  });

  it("sends one request a second, however many are asked for at once", async () => {
    // The router asks for at most one request a second per user and promises
    // no uptime. Two panels planning at the same moment, or a person pressing
    // the button twice, must not become two requests in the same instant.
    const sent: number[] = [];
    const headers: Array<Record<string, string>> = [];
    let clock = 10_000;
    const now = () => clock;
    const wait = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        sent.push(clock);
        headers.push((init?.headers ?? {}) as Record<string, string>);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              trip: {
                status: 0,
                units: "miles",
                summary: { length: 1, time: 60 },
                legs: [{ shape: "_o}p}@~neswD~zgeC_{rc@" }],
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );

    const from = { lon: -96.8, lat: 32.78 };
    const to = { lon: -95.37, lat: 29.76 };
    await Promise.all([
      fetchRoute(from, to, undefined, now, wait),
      fetchRoute(from, to, undefined, now, wait),
      fetchRoute(from, to, undefined, now, wait),
    ]);

    expect(sent).toHaveLength(3);
    for (const [at, when] of sent.entries()) {
      if (at === 0) continue;
      expect(
        when - sent[at - 1],
        `request ${at} followed the one before it too closely`,
      ).toBeGreaterThanOrEqual(ROUTER_MIN_GAP_MS);
    }
    // The service asks apps handed out to other people to name themselves, and
    // this is the whole of what it asks in return for the routing.
    for (const sentHeaders of headers) {
      expect(sentHeaders["X-Client-Id"]).toBe("OpenRadar");
    }
    vi.unstubAllGlobals();
  });

  it("draws the line between two places when there is no road shape", () => {
    // Not a route, and it does not pretend to be one. What it is for is the
    // weather, which does not care which road you take.
    const from = { lon: -96.8, lat: 32.78 };
    const to = { lon: -95.37, lat: 29.76 };
    const line = lineBetween(from, to);

    expect(line.estimated).toBe(true);
    expect(line.coordinates).toEqual([
      [-96.8, 32.78],
      [-95.37, 29.76],
    ]);
    // Dallas to Houston is about 225 miles as the crow flies.
    expect(line.distanceMiles).toBeGreaterThan(200);
    expect(line.distanceMiles).toBeLessThan(250);
    // And the time is a plain function of that distance, not a fabrication
    // borrowed from a route nobody fetched.
    expect(line.durationSeconds).toBeCloseTo(
      (line.distanceMiles / 55) * 3600,
      3,
    );

    // It still samples like a route, so the forecast path is unchanged.
    const samples = sampleRoute(line);
    expect(samples.length).toBeGreaterThan(1);
    expect(samples[0].distanceMiles).toBe(0);
  });
});

describe("what the router can answer badly", () => {
  const SHAPE = "_o}p}@~neswD~nyo@_oyo@~zgeC_{rc@";

  // Found by review: the units check was an exact match on "miles", so any
  // other spelling was read as kilometres and reported at 62 per cent of the
  // real distance, with every arrival time along the drive wrong to match.
  it("reads the units however the service spells them", () => {
    for (const units of ["miles", "Miles", "mi", "MI"]) {
      const route = parseRoute({
        trip: {
          status: 0,
          units,
          summary: { length: 100, time: 7200 },
          legs: [{ shape: SHAPE }],
        },
      });
      expect(route?.distanceMiles, units).toBeCloseTo(100, 3);
    }
  });

  // A drawn route reporting nought miles and nought minutes reads as a bug in
  // the app rather than as an answer the router could not give, and it puts
  // the whole drive's weather at the departure hour.
  it("refuses a route with no length or duration rather than reporting nought", () => {
    const base = {
      status: 0,
      units: "miles",
      legs: [{ shape: SHAPE }],
    };
    expect(parseRoute({ trip: base })).toBeNull();
    expect(
      parseRoute({ trip: { ...base, summary: { time: 7200 } } }),
    ).toBeNull();
    expect(
      parseRoute({ trip: { ...base, summary: { length: 100 } } }),
    ).toBeNull();
  });
});

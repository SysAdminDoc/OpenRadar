import { haversineMiles, type GeoPoint } from "./geo";
import { translate } from "../i18n";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

/**
 * The OSRM demo server asks for at most one request a second and promises no
 * uptime, so requests queue behind each other rather than going out together.
 * It is a courtesy server run for demonstrations, and this is the whole of what
 * it asks in return.
 */
export const OSRM_MIN_GAP_MS = 1_000;

let osrmQueue: Promise<void> = Promise.resolve();
let osrmLastAt = 0;

/** Waits for this caller's turn on the demo server. */
function osrmTurn(now: () => number, wait: (ms: number) => Promise<void>) {
  const mine = osrmQueue.then(async () => {
    const since = now() - osrmLastAt;
    if (since < OSRM_MIN_GAP_MS) await wait(OSRM_MIN_GAP_MS - since);
    osrmLastAt = now();
  });
  // A rejected turn must not stop the queue for everyone behind it.
  osrmQueue = mine.catch(() => {});
  return mine;
}

/** Only for tests, which cannot wait a real second between cases. */
export function resetOsrmThrottle() {
  osrmQueue = Promise.resolve();
  osrmLastAt = 0;
}
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** How far apart the weather samples along a route are placed. */
export const SAMPLE_SPACING_MILES = 15;
/** Open-Meteo takes many points in one request, but not without limit. */
export const MAX_SAMPLES = 20;

export interface RouteShape {
  coordinates: Array<[number, number]>;
  distanceMiles: number;
  durationSeconds: number;
  /**
   * True when this is a straight line between the two places rather than a
   * road, because the router could not be reached. The times along it are a
   * guess and the panel says so.
   */
  estimated?: boolean;
}

/** What a car averages door to door, near enough to time a straight line by. */
const ESTIMATED_MPH = 55;

/**
 * The line between two places, for when the router refuses.
 *
 * It is not a route and does not pretend to be one: no roads, no turns, and a
 * duration from an average speed. What it is good for is the weather, which
 * does not care which road you take.
 */
export function straightRoute(from: GeoPoint, to: GeoPoint): RouteShape {
  const distanceMiles = haversineMiles(from, to);
  return {
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    distanceMiles,
    durationSeconds: (distanceMiles / ESTIMATED_MPH) * 3600,
    estimated: true,
  };
}

export interface RouteSample {
  point: GeoPoint;
  /** Miles travelled from the start. */
  distanceMiles: number;
  /** Seconds after departure the driver reaches this point. */
  offsetSeconds: number;
  /** Where the sample sits on the route, so a leg can be sliced exactly. */
  index: number;
}

export interface RouteConditions extends RouteSample {
  arrival: number;
  temperature: number | null;
  precipitationChance: number | null;
  weatherCode: number | null;
}

export function parseRoute(payload: unknown): RouteShape | null {
  const raw = payload as {
    code?: unknown;
    routes?: Array<{
      distance?: unknown;
      duration?: unknown;
      geometry?: { coordinates?: unknown };
    }>;
  };
  if (raw?.code !== "Ok" || !Array.isArray(raw.routes) || !raw.routes.length) {
    return null;
  }

  const route = raw.routes[0];
  const coordinates = Array.isArray(route.geometry?.coordinates)
    ? route.geometry.coordinates.flatMap((pair): Array<[number, number]> => {
        if (!Array.isArray(pair)) return [];
        const [lon, lat] = pair.map(Number);
        return Number.isFinite(lon) && Number.isFinite(lat) ? [[lon, lat]] : [];
      })
    : [];
  if (coordinates.length < 2) return null;

  const meters = Number(route.distance);
  const duration = Number(route.duration);
  return {
    coordinates,
    distanceMiles: Number.isFinite(meters) ? meters / 1609.344 : 0,
    durationSeconds: Number.isFinite(duration) ? duration : 0,
  };
}

export async function fetchRoute(
  from: GeoPoint,
  to: GeoPoint,
  signal?: AbortSignal,
  // Injected so a test does not have to wait a real second.
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<RouteShape> {
  const path = `${from.lon.toFixed(5)},${from.lat.toFixed(5)};${to.lon.toFixed(5)},${to.lat.toFixed(5)}`;
  await osrmTurn(now, wait);
  const response = await fetch(
    `${OSRM_URL}/${path}?overview=simplified&geometries=geojson`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(
      translate("route.routerRefused", { status: response.status }),
    );
  }
  const route = parseRoute(await response.json());
  if (!route) throw new Error(translate("route.noRoad"));
  return route;
}

/**
 * Points along the line at a roughly even spacing, each carrying how long the
 * drive takes to reach it. The duration is spread by distance, which is close
 * enough for a weather timeline and needs no per-leg data.
 */
export function sampleRoute(
  route: RouteShape,
  spacingMiles = SAMPLE_SPACING_MILES,
): RouteSample[] {
  const [first] = route.coordinates;
  const samples: RouteSample[] = [
    {
      point: { lon: first[0], lat: first[1] },
      distanceMiles: 0,
      offsetSeconds: 0,
      index: 0,
    },
  ];

  let travelled = 0;
  let sinceLast = 0;
  for (let index = 1; index < route.coordinates.length; index += 1) {
    const previous = route.coordinates[index - 1];
    const current = route.coordinates[index];
    const step = haversineMiles(
      { lon: previous[0], lat: previous[1] },
      { lon: current[0], lat: current[1] },
    );
    travelled += step;
    sinceLast += step;
    const last = index === route.coordinates.length - 1;
    if (sinceLast < spacingMiles && !last) continue;

    sinceLast = 0;
    // A repeated vertex would otherwise add a sample no distance from the last.
    if (travelled <= samples[samples.length - 1].distanceMiles) continue;
    samples.push({
      point: { lon: current[0], lat: current[1] },
      distanceMiles: travelled,
      offsetSeconds: route.distanceMiles
        ? (travelled / route.distanceMiles) * route.durationSeconds
        : 0,
      index,
    });
  }

  if (samples.length <= MAX_SAMPLES) return samples;

  // Thin evenly rather than truncating, so the far end still gets a reading.
  const step = (samples.length - 1) / (MAX_SAMPLES - 1);
  return Array.from(
    { length: MAX_SAMPLES },
    (_, index) => samples[Math.round(index * step)],
  );
}

/** Half an hour either side of an hourly stamp is still that hour. */
const HOUR_TOLERANCE_MS = 31 * 60_000;

function hourIndex(times: string[], arrival: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, value] of times.entries()) {
    // Open-Meteo returns local-naive stamps; the request asks for UTC.
    const at = Date.parse(`${value}:00Z`);
    if (!Number.isFinite(at)) continue;
    const distance = Math.abs(at - arrival);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  // An arrival past the end of the forecast has no reading, and saying so beats
  // clamping to the last hour and presenting it as the answer.
  return best !== null && bestDistance <= HOUR_TOLERANCE_MS ? best : null;
}

export function readRouteForecast(
  payload: unknown,
  samples: RouteSample[],
  departure: number,
): RouteConditions[] {
  const series = Array.isArray(payload) ? payload : [payload];

  return samples.map((sample, index) => {
    const arrival = departure + sample.offsetSeconds * 1000;
    const hourly = (
      series[index] as
        | {
            hourly?: {
              time?: unknown;
              temperature_2m?: unknown;
              precipitation_probability?: unknown;
              weather_code?: unknown;
            };
          }
        | undefined
    )?.hourly;
    const times = Array.isArray(hourly?.time)
      ? hourly.time.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    if (!times.length) {
      return {
        ...sample,
        arrival,
        temperature: null,
        precipitationChance: null,
        weatherCode: null,
      };
    }

    const at = hourIndex(times, arrival);
    const pick = (values: unknown): number | null => {
      if (at === null || !Array.isArray(values)) return null;
      const value = Number(values[at]);
      return Number.isFinite(value) ? value : null;
    };

    return {
      ...sample,
      arrival,
      temperature: pick(hourly?.temperature_2m),
      precipitationChance: pick(hourly?.precipitation_probability),
      weatherCode: pick(hourly?.weather_code),
    };
  });
}

export async function fetchRouteForecast(
  samples: RouteSample[],
  departure: number,
  signal?: AbortSignal,
): Promise<RouteConditions[]> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set(
    "latitude",
    samples.map((sample) => sample.point.lat.toFixed(4)).join(","),
  );
  url.searchParams.set(
    "longitude",
    samples.map((sample) => sample.point.lon.toFixed(4)).join(","),
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,weather_code",
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("forecast_days", "3");

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`The forecast returned ${response.status}.`);
  }
  return readRouteForecast(await response.json(), samples, departure);
}

/** A GeoJSON line whose segments carry the chance of rain when you reach them. */
export function routeGeoJson(
  route: RouteShape,
  conditions: RouteConditions[],
): Record<string, unknown> {
  const features = conditions.slice(0, -1).map((sample, index) => {
    const next = conditions[index + 1];
    // Sliced by the indices the samples were taken at. Searching for the
    // coordinates would re-trace the whole loop wherever a route crosses
    // itself, which happens at every cloverleaf.
    const slice =
      next.index > sample.index
        ? route.coordinates.slice(sample.index, next.index + 1)
        : [
            [sample.point.lon, sample.point.lat],
            [next.point.lon, next.point.lat],
          ];

    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      properties: {
        // Negative marks "no reading", which the map paints in its own colour.
        precipitationChance: next.precipitationChance ?? -1,
        arrival: next.arrival,
      },
    };
  });

  return { type: "FeatureCollection", features };
}

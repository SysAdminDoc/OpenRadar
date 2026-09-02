import sites from "./soundingSites.json";
import { serviceAnswer } from "./serviceAnswer";
import { cachedUrl } from "./tileCache";
import { translate } from "../i18n";
import type { SoundingLevel } from "./thermo";

/**
 * A vertical profile of the atmosphere, observed or forecast.
 *
 * The community's standard sounding tool has not shipped a release since 2020
 * and no open radar application draws one at all, which is why this exists.
 * Two sources, and they are never blended: a balloon that went up somewhere
 * near here at a moment that has passed, or a model column over the middle of
 * the map for a moment that has not arrived. Each says which it is, on the
 * chart and in every number derived from it, because a forecast sounding read
 * as an observation is the one way this panel could mislead somebody.
 */

const RAOB_HOST = "mesonet.agron.iastate.edu";
const RAOB_SERVICE = `https://${RAOB_HOST}/json/raob.py`;
const FORECAST_HOST = "api.open-meteo.com";
const FORECAST_SERVICE = `https://${FORECAST_HOST}/v1/gfs`;

/** The pressure levels the model publishes, deepest first. */
export const FORECAST_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400,
  350, 300, 250, 200, 150, 100,
] as const;

export interface SoundingSite {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
}

export const SOUNDING_SITES: SoundingSite[] = sites as SoundingSite[];

export interface Sounding {
  /** Never blended, and said wherever a number off this appears. */
  kind: "observed" | "forecast";
  /** The launch site, or the place a model column was taken over. */
  label: string;
  /** Seconds since the epoch: when the balloon went up, or the valid hour. */
  valid: number;
  /** For a forecast, the run it came out of. Absent on an observation. */
  run?: number;
  levels: SoundingLevel[];
  attribution: string;
  attributionUrl: string;
}

/** Great-circle distance in kilometres, for choosing the nearest site. */
function distanceKm(
  from: { latitude: number; longitude: number },
  lat: number,
  lon: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat - from.latitude) * toRad;
  const dLon = (lon - from.longitude) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.latitude * toRad) *
      Math.cos(lat * toRad) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The launch site nearest a point, with how far away it is. */
export function nearestSite(
  latitude: number,
  longitude: number,
): { site: SoundingSite; km: number } | null {
  let best: { site: SoundingSite; km: number } | null = null;
  for (const site of SOUNDING_SITES) {
    const km = distanceKm(site, latitude, longitude);
    if (!best || km < best.km) best = { site, km };
  }
  return best;
}

/**
 * The synoptic hour a sounding would have been launched at.
 *
 * Balloons go up at 00 and 12 UTC. The service holds nothing for an hour
 * nobody launched in, so asking for one is asking for an empty answer.
 */
export function launchHour(at: number): number {
  const date = new Date(at * 1000);
  const hour = date.getUTCHours() >= 12 ? 12 : 0;
  return (
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hour,
    ) / 1000
  );
}

function iso(at: number): string {
  return new Date(at * 1000).toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * The service's own timestamp, which is not an ISO one.
 *
 * It answers `08/31/2026 00:00:00`, in UTC and with no marker saying so.
 * Reading it with `Date.parse` gets the reader's own zone and puts a midnight
 * balloon six hours out.
 */
export function parseRaobTime(value: unknown): number | null {
  const text = String(value ?? "").trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(text);
  if (!match) {
    const fallback = Date.parse(text);
    return Number.isFinite(fallback) ? Math.floor(fallback / 1000) : null;
  }
  const [, month, day, year, hour, minute] = match;
  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
    ) / 1000
  );
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One observed profile out of the service's answer.
 *
 * A mandatory level with no thermodynamics is dropped rather than drawn: the
 * service publishes the whole pressure ladder and fills in what the balloon
 * actually reported, so most of the top of a list is nulls.
 */
export function parseRaob(payload: unknown): Sounding | null {
  const raw = payload as {
    profiles?: Array<{
      station?: unknown;
      valid?: unknown;
      profile?: unknown[];
    }>;
  };
  const first = Array.isArray(raw?.profiles) ? raw.profiles[0] : null;
  if (!first) return null;
  const valid = parseRaobTime(first.valid);
  if (valid === null) return null;

  const levels: SoundingLevel[] = [];
  for (const item of Array.isArray(first.profile) ? first.profile : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const pressure = number(row.pres);
    const temperature = number(row.tmpc);
    const dewpoint = number(row.dwpc);
    const height = number(row.hght);
    if (pressure === null || temperature === null || height === null) continue;
    levels.push({
      pressure,
      height,
      temperature,
      // A level with no dewpoint is a level the balloon's humidity sensor had
      // nothing for. The temperature is still the temperature, so the level
      // stays and the moisture curve simply stops.
      dewpoint: dewpoint === null ? temperature : dewpoint,
      windKnots: number(row.sknt),
      windFrom: number(row.drct),
    });
  }
  if (levels.length < 5) return null;
  levels.sort((a, b) => b.pressure - a.pressure);

  const station = String(first.station ?? "").trim();
  const site = SOUNDING_SITES.find(
    (held) => held.id === station || held.id.slice(1) === station,
  );
  return {
    kind: "observed",
    label: site ? `${site.name}, ${site.state} (${station})` : station,
    valid,
    levels,
    attribution: "NWS upper air, by way of Iowa State",
    attributionUrl: "https://mesonet.agron.iastate.edu/",
  };
}

export function raobUrl(station: string, at: number): string {
  const query = new URLSearchParams({
    ts: iso(launchHour(at)),
    station,
  });
  return `${RAOB_SERVICE}?${query.toString()}`;
}

/**
 * How far back to look for a balloon that actually went up.
 *
 * Not every site launches at every synoptic hour, and a site can miss one:
 * the day this was written, Omaha had a 00Z sounding and no 12Z. Two days of
 * hours is four requests at worst and covers a missed launch without
 * pretending a three-day-old profile is current.
 */
const LAUNCHES_BACK = 4;

/**
 * The nearest balloon that went up, for a point and a moment.
 *
 * Walks back through the synoptic hours until the archive has one, because a
 * missing launch is common and "there is no sounding" is the wrong answer to
 * give a reader when yesterday evening's is right there.
 */
export async function observedSounding(
  latitude: number,
  longitude: number,
  at: number,
  signal?: AbortSignal,
): Promise<Sounding | null> {
  const near = nearestSite(latitude, longitude);
  if (!near) return null;
  let hour = launchHour(at);
  for (let step = 0; step < LAUNCHES_BACK; step += 1) {
    const response = await fetch(cachedUrl(raobUrl(near.site.id, hour)), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        translate("sounding.failed", {
          answer: serviceAnswer(response.status),
        }),
      );
    }
    const parsed = parseRaob(await response.json());
    if (parsed) {
      return {
        ...parsed,
        label: `${near.site.name}, ${near.site.state} (${near.site.id})`,
      };
    }
    // Twelve hours earlier, which is the previous launch everywhere.
    hour -= 12 * 3600;
  }
  return null;
}

/** The hour a moment belongs to, as the service writes one. */
function modelHour(at: number): string {
  const date = new Date(Math.round(at / 3600) * 3600 * 1000);
  return date.toISOString().slice(0, 13) + ":00";
}

export function forecastUrl(
  latitude: number,
  longitude: number,
  at: number,
): string {
  const fields = FORECAST_LEVELS.flatMap((level) => [
    `temperature_${level}hPa`,
    `dew_point_${level}hPa`,
    `wind_speed_${level}hPa`,
    `wind_direction_${level}hPa`,
    `geopotential_height_${level}hPa`,
  ]);
  const hour = modelHour(at);
  const query = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: fields.join(","),
    // One hour rather than a range. A sounding is a column at a moment, and
    // this is a hundred and five series per hour: asking for two days of them
    // is fifty times the answer for the one hour anybody is looking at, on a
    // free service whose fair use is counted in variable-hours.
    start_hour: hour,
    end_hour: hour,
    timezone: "UTC",
    wind_speed_unit: "kn",
  });
  return `${FORECAST_SERVICE}?${query.toString()}`;
}

/**
 * One model column out of an Open-Meteo answer, for the hour asked for.
 *
 * The same service the guidance panel already reads, at the same terms. What
 * comes back is a forecast, and it is labelled one everywhere it appears.
 */
export function parseForecastSounding(
  payload: unknown,
  at: number,
): Sounding | null {
  const raw = payload as {
    hourly?: Record<string, unknown>;
    latitude?: unknown;
    longitude?: unknown;
  };
  const hourly = raw?.hourly;
  const times = Array.isArray(hourly?.time) ? (hourly.time as string[]) : [];
  if (!times.length) return null;

  // The nearest published hour to the one asked for, which is what the
  // timeline's own moment lands between.
  let index = 0;
  let best = Infinity;
  times.forEach((stamp, at_) => {
    const hour = Date.parse(`${stamp}Z`) / 1000;
    const away = Math.abs(hour - at);
    if (away < best) {
      best = away;
      index = at_;
    }
  });

  const levels: SoundingLevel[] = [];
  for (const level of FORECAST_LEVELS) {
    const read = (field: string): number | null => {
      const series = hourly?.[`${field}_${level}hPa`];
      return Array.isArray(series) ? number(series[index]) : null;
    };
    const temperature = read("temperature");
    const height = read("geopotential_height");
    if (temperature === null || height === null) continue;
    const dewpoint = read("dew_point");
    levels.push({
      pressure: level,
      height,
      temperature,
      dewpoint: dewpoint === null ? temperature : dewpoint,
      windKnots: read("wind_speed"),
      windFrom: read("wind_direction"),
    });
  }
  if (levels.length < 5) return null;
  levels.sort((a, b) => b.pressure - a.pressure);

  return {
    kind: "forecast",
    label: translate("sounding.hereLabel"),
    valid: Date.parse(`${times[index]}Z`) / 1000,
    levels,
    attribution: "GFS by way of Open-Meteo",
    attributionUrl: "https://open-meteo.com/",
  };
}

/** The model's column over a point, for a moment. */
export async function forecastSounding(
  latitude: number,
  longitude: number,
  at: number,
  signal?: AbortSignal,
): Promise<Sounding | null> {
  const response = await fetch(
    cachedUrl(forecastUrl(latitude, longitude, at)),
    {
      signal,
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(
      translate("sounding.failedModel", {
        answer: serviceAnswer(response.status),
      }),
    );
  }
  return parseForecastSounding(await response.json(), at);
}

/**
 * High and low water at the nearest NOAA tide station.
 *
 * Storm surge is measured on top of the tide, so a surge forecast without a
 * tide beside it says less than it looks like it says. The predictions come
 * from NOAA CO-OPS, which publishes them for three and a half thousand
 * stations along the American coasts.
 *
 * The station list is bundled rather than fetched, so the nearest one is found
 * instantly and works with no network. Only the predictions themselves need a
 * connection.
 */
import { haversineMiles, type GeoPoint } from "./geo";
import { serviceAnswer } from "./serviceAnswer";
import { cachedUrl } from "./tileCache";
import { translate } from "../i18n";

const SERVICE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
/** Beyond this the nearest station is describing a different body of water. */
export const MAX_STATION_MILES = 120;

export interface TideStation {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface TideExtreme {
  /** Milliseconds since the epoch. A real instant, not a wall clock. */
  time: number;
  /** Feet above the chart datum, which for these predictions is MLLW. */
  feet: number;
  high: boolean;
}

export interface TideReading {
  station: TideStation;
  distanceMiles: number;
  extremes: TideExtreme[];
}

let loading: Promise<TideStation[]> | null = null;

/** The bundled station list, read once and kept. */
export function loadStations(): Promise<TideStation[]> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}tide-stations.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(translate("tides.stationsFailed"));
        }
        return response.json() as Promise<TideStation[]>;
      })
      .catch((error: unknown) => {
        // A failed read must not be remembered as an empty list, or every
        // later call answers with nothing.
        loading = null;
        throw error;
      });
  }
  return loading;
}

/** Only for tests, which need a fresh read between cases. */
export function resetStations() {
  loading = null;
}

/**
 * The closest station to a point, or nothing when the nearest is far enough
 * away that its tide says nothing about where the map is looking.
 */
export function nearestStation(
  stations: readonly TideStation[],
  point: GeoPoint,
  maxMiles = MAX_STATION_MILES,
): { station: TideStation; distanceMiles: number } | null {
  let best: { station: TideStation; distanceMiles: number } | null = null;
  for (const station of stations) {
    const distanceMiles = haversineMiles(point, {
      lat: station.lat,
      lon: station.lon,
    });
    if (!best || distanceMiles < best.distanceMiles) {
      best = { station, distanceMiles };
    }
  }
  if (!best || best.distanceMiles > maxMiles) return null;
  return best;
}

/** The date NOAA wants, in its own format, from a moment. */
export function stationDate(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
}

/**
 * NOAA answers with a naked "YYYY-MM-DD HH:MM" and no offset on it. The
 * request asks for GMT, so it is read as GMT rather than handed to Date.parse,
 * which would read it as this machine's local time and put every tide out by
 * the viewer's own offset.
 */
export function parseStationTime(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
}

export function parsePredictions(payload: unknown): TideExtreme[] {
  const raw = payload as {
    predictions?: unknown;
    error?: { message?: string };
  };
  if (raw?.error?.message) throw new Error(String(raw.error.message));
  const rows = Array.isArray(raw?.predictions) ? raw.predictions : [];

  const extremes: TideExtreme[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as { t?: unknown; v?: unknown; type?: unknown };
    if (typeof entry.t !== "string") continue;
    const time = parseStationTime(entry.t);
    if (!Number.isFinite(time)) continue;
    const feet = Number(entry.v);
    if (!Number.isFinite(feet)) continue;
    extremes.push({ time, feet, high: entry.type === "H" });
  }
  return extremes;
}

export async function fetchTides(
  station: TideStation,
  distanceMiles: number,
  now = new Date(),
  signal?: AbortSignal,
): Promise<TideReading> {
  const end = new Date(now.getTime() + 3 * 24 * 3_600_000);
  const url = new URL(SERVICE);
  url.searchParams.set("product", "predictions");
  url.searchParams.set("application", "OpenRadar");
  url.searchParams.set("station", station.id);
  url.searchParams.set("begin_date", stationDate(now));
  url.searchParams.set("end_date", stationDate(end));
  url.searchParams.set("datum", "MLLW");
  url.searchParams.set("units", "english");
  // GMT, so what comes back is an instant rather than a wall clock that only
  // means something at the station. The panel shows it in the viewer's zone
  // and says so.
  url.searchParams.set("time_zone", "gmt");
  url.searchParams.set("interval", "hilo");
  url.searchParams.set("format", "json");

  const response = await fetch(cachedUrl(url.toString()), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      translate("tides.failed", { answer: serviceAnswer(response.status) }),
    );
  }
  return {
    station,
    distanceMiles,
    extremes: parsePredictions(await response.json()),
  };
}

/** The next few turns of the tide, counted from a moment. */
export function upcoming(
  extremes: readonly TideExtreme[],
  now = Date.now(),
  count = 4,
): TideExtreme[] {
  return extremes.filter((extreme) => extreme.time >= now).slice(0, count);
}

/** Whether the water is rising or falling right now, and when that turns. */
export function state(
  extremes: readonly TideExtreme[],
  now = Date.now(),
): { rising: boolean; next: TideExtreme } | null {
  const next = extremes.find((extreme) => extreme.time >= now);
  if (!next) return null;
  // Heading for a high means rising, and heading for a low means falling.
  return { rising: next.high, next };
}

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
import { log } from "./log";
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
  // CO-OPS says why in English prose, and the panel printed it: "No
  // Predictions data was found. Please make sure the Datum input is valid."
  // reached a French reader exactly like that. What a reader can act on is
  // which of the two it is, so the sentence is this app's own and the
  // service's own wording goes to the log with everything else it says.
  if (raw?.error?.message) {
    const said = String(raw.error.message);
    log.info("tides", "CO-OPS refused the request: " + said);
    throw new Error(
      /no\s+predictions/i.test(said)
        ? translate("tides.noPredictions")
        : translate("tides.unknown"),
    );
  }
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

/** How many times a day the tide turns where this station is. */
export type TideRegime = "diurnal" | "semidiurnal" | "unknown";

/**
 * Which of the two shapes a stretch of coast has, read off the turns
 * themselves.
 *
 * Most of the American coast turns four times a day and the Gulf of Mexico
 * turns twice, which is a fact about the water rather than about the station
 * being sparse. Without it a Gulf reader sees half as many rows as a Boston
 * reader with nothing on screen to say why, and a test written on the Atlantic
 * shape fails on the Gulf: the live contract asked for eight turns in three
 * days and New Canal Station on Lake Pontchartrain published seven.
 *
 * NOAA classifies each station itself, as Diurnal, Semidiurnal or Mixed, and
 * this is deliberately not that. It describes the predictions actually on
 * screen, which is what the panel is naming, and it costs no second request.
 * The two are held against each other in the live test rather than either
 * being trusted to stand in for the other. Mixed counts as semidiurnal here
 * because a mixed coast still turns four times a day; what differs is the
 * heights, which the rows already show.
 */
export function tideRegime(extremes: readonly TideExtreme[]): TideRegime {
  // Three turns is the fewest that can carry a rate at all, and a window
  // shorter than a day cannot: two highs six hours apart say nothing about
  // what the next three days do.
  if (extremes.length < 3) return "unknown";
  const span = extremes[extremes.length - 1].time - extremes[0].time;
  const days = span / (24 * 3_600_000);
  if (days < 1) return "unknown";
  // Intervals rather than turns, because a window that starts and ends on a
  // turn holds one more of them than it does gaps.
  const perDay = (extremes.length - 1) / days;
  // Measured on 2026-09-07 over the three days this app asks for: New Canal
  // Station 1.94 a day, The Battery 3.87, San Francisco 3.81. Three sits in
  // the gap with room on either side.
  return perDay < 3 ? "diurnal" : "semidiurnal";
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

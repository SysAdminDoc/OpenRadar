import { serviceAnswer } from "../serviceAnswer";
import { cachedUrl } from "../tileCache";
import {
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayFeature,
} from "./registry";
import { formatNumber, translate } from "../../i18n";
import { isMetric } from "../units";

/**
 * What people standing in their own gardens measured.
 *
 * Every other rain figure on this map is an instrument's estimate: radar
 * working backwards from what came back, or a model's guess at what the radar
 * meant. CoCoRaHS is twenty thousand volunteers with the same four-inch gauge
 * reading it at the same time every morning, and it is the densest
 * precipitation network in North America by a wide margin. In a flash flood
 * the gauge in somebody's back garden is often the only measurement inside
 * the cell.
 *
 * They report hail too, with the stone sizes, how long it fell for and what
 * it did to the garden. That is the part no instrument publishes at all.
 *
 * The service answers per state, so this asks for the states the reader is
 * looking at and keeps each one for an hour. Asking for the whole network at
 * once is a 2.7 MB answer for a screen showing one county, which is why the
 * layer has a zoom floor as well.
 */

const HOST = "data.cocorahs.org";
const EXPORT = `https://${HOST}/export/exportreports.aspx`;

export const COCORAHS_ATTRIBUTION =
  '<a href="https://www.cocorahs.org/">CoCoRaHS</a>';

/**
 * How long a state is kept before it is asked for again.
 *
 * Observers report once in the morning, so the answer for a state changes a
 * few times a day at most. An hour is the item's own figure and is already
 * more often than the data moves.
 */
export const COCORAHS_REFRESH_MS = 60 * 60_000;

/**
 * Below this a state is a shape and its gauges are a smear.
 *
 * The same floor the station plots use, and for the same reason: there are
 * thirteen thousand of these reporting on an ordinary day, and a country's
 * worth at once is both unreadable and a request nobody wanted.
 */
export const COCORAHS_MIN_ZOOM = 6;

/**
 * The states the service knows, with a box around each.
 *
 * A closed list rather than anything worked out from a code, because of what
 * the service does with a code it does not recognise: `State=ON` is not an
 * error and not empty, it is the entire national feed, 13,351 reports and
 * 2.7 MB of it. So a view over Ontario has to ask for nothing at all rather
 * than for a code that looks plausible.
 *
 * The boxes are deliberately generous. Over-reaching costs one extra state in
 * a request; under-reaching means a reader looking at the top of Michigan is
 * shown no gauges at all and told nothing about why.
 */
export const COCORAHS_STATES: ReadonlyArray<{
  code: string;
  west: number;
  south: number;
  east: number;
  north: number;
}> = [
  { code: "AL", west: -88.6, south: 30.1, east: -84.8, north: 35.1 },
  // The Aleutians run past the antimeridian, and no box in this list crosses
  // it. The chain has no reporting gauges on it; the state's stations are on
  // the mainland and in the southeast, which this covers.
  { code: "AK", west: -179.3, south: 51.1, east: -129.9, north: 71.5 },
  { code: "AZ", west: -115.0, south: 31.2, east: -108.9, north: 37.1 },
  { code: "AR", west: -94.7, south: 32.9, east: -89.5, north: 36.6 },
  { code: "CA", west: -124.5, south: 32.4, east: -114.0, north: 42.1 },
  { code: "CO", west: -109.2, south: 36.9, east: -101.9, north: 41.1 },
  { code: "CT", west: -73.8, south: 40.9, east: -71.7, north: 42.1 },
  { code: "DC", west: -77.2, south: 38.7, east: -76.8, north: 39.1 },
  { code: "DE", west: -75.9, south: 38.4, east: -74.9, north: 39.9 },
  { code: "FL", west: -87.7, south: 24.3, east: -79.9, north: 31.1 },
  { code: "GA", west: -85.7, south: 30.3, east: -80.7, north: 35.1 },
  { code: "HI", west: -160.4, south: 18.8, east: -154.7, north: 22.4 },
  { code: "ID", west: -117.3, south: 41.9, east: -110.9, north: 49.1 },
  { code: "IL", west: -91.6, south: 36.9, east: -87.4, north: 42.6 },
  { code: "IN", west: -88.2, south: 37.7, east: -84.7, north: 41.9 },
  { code: "IA", west: -96.7, south: 40.3, east: -90.0, north: 43.6 },
  { code: "KS", west: -102.2, south: 36.9, east: -94.5, north: 40.1 },
  { code: "KY", west: -89.6, south: 36.4, east: -81.9, north: 39.2 },
  { code: "LA", west: -94.1, south: 28.8, east: -88.7, north: 33.1 },
  { code: "MA", west: -73.6, south: 41.1, east: -69.8, north: 43.0 },
  { code: "MD", west: -79.6, south: 37.8, east: -74.9, north: 39.8 },
  { code: "ME", west: -71.2, south: 42.9, east: -66.8, north: 47.5 },
  { code: "MI", west: -90.5, south: 41.6, east: -82.1, north: 48.4 },
  { code: "MN", west: -97.3, south: 43.4, east: -89.4, north: 49.5 },
  { code: "MO", west: -95.9, south: 35.9, east: -88.9, north: 40.7 },
  { code: "MS", west: -91.7, south: 30.1, east: -88.0, north: 35.1 },
  { code: "MT", west: -116.2, south: 44.3, east: -103.9, north: 49.1 },
  { code: "NC", west: -84.4, south: 33.7, east: -75.3, north: 36.7 },
  { code: "ND", west: -104.1, south: 45.8, east: -96.5, north: 49.1 },
  { code: "NE", west: -104.1, south: 39.9, east: -95.2, north: 43.1 },
  { code: "NH", west: -72.6, south: 42.6, east: -70.6, north: 45.4 },
  { code: "NJ", west: -75.6, south: 38.8, east: -73.8, north: 41.4 },
  { code: "NM", west: -109.2, south: 31.2, east: -102.9, north: 37.1 },
  { code: "NV", west: -120.1, south: 34.9, east: -113.9, north: 42.1 },
  { code: "NY", west: -79.8, south: 40.4, east: -71.8, north: 45.1 },
  { code: "OH", west: -84.9, south: 38.3, east: -80.4, north: 42.1 },
  { code: "OK", west: -103.1, south: 33.5, east: -94.4, north: 37.1 },
  { code: "OR", west: -124.6, south: 41.9, east: -116.4, north: 46.3 },
  { code: "PA", west: -80.6, south: 39.6, east: -74.6, north: 42.4 },
  { code: "PR", west: -67.4, south: 17.8, east: -65.1, north: 18.6 },
  { code: "RI", west: -71.9, south: 41.1, east: -71.1, north: 42.1 },
  { code: "SC", west: -83.4, south: 32.0, east: -78.4, north: 35.3 },
  { code: "SD", west: -104.1, south: 42.4, east: -96.4, north: 46.0 },
  { code: "TN", west: -90.4, south: 34.9, east: -81.6, north: 36.7 },
  { code: "TX", west: -106.7, south: 25.8, east: -93.4, north: 36.6 },
  { code: "UT", west: -114.1, south: 36.9, east: -108.9, north: 42.1 },
  { code: "VA", west: -83.7, south: 36.5, east: -75.1, north: 39.5 },
  { code: "VI", west: -65.2, south: 17.6, east: -64.5, north: 18.5 },
  { code: "VT", west: -73.5, south: 42.7, east: -71.4, north: 45.1 },
  { code: "WA", west: -124.9, south: 45.5, east: -116.9, north: 49.1 },
  { code: "WI", west: -93.0, south: 42.4, east: -86.7, north: 47.1 },
  { code: "WV", west: -82.7, south: 37.1, east: -77.7, north: 40.7 },
  { code: "WY", west: -111.1, south: 40.9, east: -103.9, north: 45.1 },
];

/** Which of them the reader is looking at, in the order the list is written. */
export function statesIn(bounds: OverlayBounds): string[] {
  return COCORAHS_STATES.filter(
    (state) =>
      state.west <= bounds.east &&
      state.east >= bounds.west &&
      state.south <= bounds.north &&
      state.north >= bounds.south,
  ).map((state) => state.code);
}

/** The service takes American dates, whoever is reading the map. */
function exportDate(at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${at.getUTCFullYear()}`;
}

/**
 * The two days a request covers.
 *
 * Observers report in the morning for the day before, and a morning in
 * Hawaii is late afternoon UTC. Asking for yesterday and today in UTC covers
 * every local date any observer could be writing, whichever side of the date
 * line the reader is on.
 */
export function reportWindow(now: number): { start: string; end: string } {
  return {
    start: exportDate(new Date(now - 24 * 3_600_000)),
    end: exportDate(new Date(now)),
  };
}

function url(
  kind: "Daily" | "Hail",
  state: string,
  window: { start: string; end: string },
): string {
  const query = new URLSearchParams({
    Format: "json",
    ReportType: kind,
    State: state,
    StartDate: window.start,
    EndDate: window.end,
  });
  return `${EXPORT}?${query.toString()}`;
}

/** A number the service wrote, or null where it wrote `NA` or nothing. */
function reading(token: string | undefined): number | null {
  if (token === undefined) return null;
  const trimmed = token.trim();
  // `Number("")` is 0 and `Number.isFinite(0)` is true, so a blank field left
  // to the parser reads as a real measurement of nothing.
  if (trimmed === "" || trimmed.toUpperCase() === "NA") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function words(token: string | undefined): string | null {
  const trimmed = token?.trim() ?? "";
  if (trimmed === "" || trimmed.toUpperCase() === "NA") return null;
  return trimmed;
}

/**
 * The observation's own date and clock, kept as the observer wrote them.
 *
 * Not turned into an instant. The service publishes a local date and a local
 * time with no zone on either, and the only way to an instant would be to
 * guess the zone from the coordinates. What the observer actually said is
 * "7 in the morning", and that is what a reader wants beside a rain total.
 */
function observedWords(
  date: string | null,
  time: string | null,
): string | null {
  if (date === null) return null;
  return time === null ? date : `${date} ${time}`;
}

/** How the reports sort: the newest of a station's is the one drawn. */
function ordering(properties: Record<string, unknown>): string {
  const date = String(properties.observedDate ?? "");
  const time = String(properties.observedTime ?? "");
  // 12-hour clocks do not sort, so AM before PM is made explicit. A missing
  // or unreadable time sorts first, behind anything that has one.
  const [clock, half] = time.split(/\s+/);
  const [hour = "", minute = ""] = clock?.split(":") ?? [];
  const hours = Number(hour);
  const settled =
    Number.isFinite(hours) && (half === "AM" || half === "PM")
      ? String(
          (half === "PM" ? (hours % 12) + 12 : hours % 12) * 60 +
            (Number(minute) || 0),
        ).padStart(4, "0")
      : "0000";
  return `${date} ${settled}`;
}

/** The daily precipitation reports, in the JSON shape only this one answers in. */
export function parseDaily(body: unknown): OverlayFeature[] {
  const reports = (body as { data?: { reports?: unknown } })?.data?.reports;
  if (!Array.isArray(reports)) return [];
  const features: OverlayFeature[] = [];
  for (const entry of reports) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const lat = typeof row.lat === "number" ? row.lat : null;
    const lon = typeof row.lng === "number" ? row.lng : null;
    if (lat === null || lon === null) continue;
    const station = typeof row.st_num === "string" ? row.st_num : null;
    if (station === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        kind: "daily",
        station,
        // The station's name is a place: "Parnell 0.1 SSW" is how far the
        // gauge is from the nearest town. No field in this feed carries an
        // observer's name and none is asked for.
        place: typeof row.st_name === "string" ? row.st_name : null,
        observedDate: typeof row.obs_date === "string" ? row.obs_date : null,
        observedTime: typeof row.obs_time === "string" ? row.obs_time : null,
        inches: typeof row.totalpcpn === "number" ? row.totalpcpn : null,
      },
    });
  }
  return features;
}

/**
 * The hail reports, which arrive as a comma separated table.
 *
 * `Format=json` is honoured by the daily report and by nothing else: the
 * hail, significant weather and multi-day exports all answer with this
 * whatever the parameter says. Only the columns before the free-text ones are
 * read, so a comma inside somebody's description of the damage cannot move a
 * coordinate: a row whose latitude does not read as a number is dropped.
 */
export function parseHail(body: string): OverlayFeature[] {
  const features: OverlayFeature[] = [];
  // The service sends this table with Windows line endings, so splitting
  // on the newline alone leaves a carriage return on the end of every row.
  // It lands on the last column, which nothing here reads today, and it
  // would still be sitting there the day somebody reads one.
  const lines = body.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 18) continue;
    const lat = reading(parts[5]);
    const lon = reading(parts[6]);
    if (lat === null || lon === null) continue;
    const station = words(parts[3]);
    if (station === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        kind: "hail",
        station,
        place: words(parts[4]),
        observedDate: words(parts[0]),
        observedTime: words(parts[1]),
        smallestInches: reading(parts[7]),
        averageInches: reading(parts[8]),
        largestInches: reading(parts[9]),
        minutes: reading(parts[10]),
        timing: words(parts[12]),
        consistency: words(parts[13]),
      },
    });
  }
  return features;
}

/** One state's answer, and when it was asked for. */
interface Held {
  at: number;
  features: OverlayFeature[];
}

/**
 * What has already been asked for, by state.
 *
 * The framework re-runs `fetchData` whenever the reader pans past the box the
 * last answer was asked for, which on this layer would be the same state
 * again. Holding each state here is what makes "once an hour while in view"
 * true of the service rather than only of the framework.
 */
const held = new Map<string, Held>();

/** For the tests, and for a language change, which repaints every popup. */
export function forgetCocorahs(): void {
  held.clear();
}

async function fetchState(
  state: string,
  window: { start: string; end: string },
  signal: AbortSignal | undefined,
): Promise<OverlayFeature[]> {
  const [daily, hail] = await Promise.all([
    fetch(cachedUrl(url("Daily", state, window)), { signal }),
    fetch(cachedUrl(url("Hail", state, window)), { signal }),
  ]);
  if (!daily.ok) {
    throw new Error(
      translate("cocorahs.failed", { answer: serviceAnswer(daily.status) }),
    );
  }
  const features = parseDaily(await daily.json());
  // A hail table that will not answer is not a reason to drop the rain
  // totals: hail is the rarer half of this layer and is absent most days
  // anyway, so an empty one and a failed one look the same on the map.
  if (hail.ok) features.push(...parseHail(await hail.text()));
  return features;
}

/**
 * The newest report each station made, and every hail report.
 *
 * A gauge read at seven and corrected at nine is one measurement, and drawing
 * both puts two dots on one garden saying different numbers. Hail is an
 * event rather than a running total, so two of them in a day are two things
 * that happened.
 */
export function newestPerStation(features: OverlayFeature[]): OverlayFeature[] {
  const daily = new Map<string, OverlayFeature>();
  const rest: OverlayFeature[] = [];
  for (const feature of features) {
    if (feature.properties.kind !== "daily") {
      rest.push(feature);
      continue;
    }
    const station = String(feature.properties.station);
    const standing = daily.get(station);
    if (
      !standing ||
      ordering(feature.properties) > ordering(standing.properties)
    ) {
      daily.set(station, feature);
    }
  }
  return [...daily.values(), ...rest];
}

/** Whether a feature is inside the box the reader is looking at. */
function within(feature: OverlayFeature, bounds: OverlayBounds): boolean {
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  return (
    lon >= bounds.west &&
    lon <= bounds.east &&
    lat >= bounds.south &&
    lat <= bounds.north
  );
}

/** A depth of rain in the reader's own units, at the precision it was read to. */
function depth(inches: number): string {
  return isMetric()
    ? `${formatNumber(inches * 25.4, 1)} mm`
    : `${formatNumber(inches, 2)} ${translate("units.inches")}`;
}

/** A hail stone, which is measured in fractions of an inch. */
function stone(inches: number): string {
  return isMetric()
    ? `${formatNumber(inches * 2.54, 1)} cm`
    : `${formatNumber(inches, 2)} ${translate("units.inches")}`;
}

export const cocorahsOverlay: OverlayAdapter = {
  id: "cocorahs",
  nameKey: "layer.cocorahs",
  label: "CoCoRaHS",
  attribution: COCORAHS_ATTRIBUTION,
  attributionUrl: "https://www.cocorahs.org/",
  host: HOST,
  refreshMs: COCORAHS_REFRESH_MS,
  minZoom: COCORAHS_MIN_ZOOM,
  // A state is a wide thing to ask for, and every extra one in the box is
  // another sixty kilobytes. The default padding of half a viewport reaches
  // into a neighbour that is nowhere near the screen.
  boundsPadding: 0.15,
  fetchData: async (bounds, signal) => {
    const wanted = statesIn(bounds);
    if (wanted.length === 0) {
      // Somewhere the network does not cover. Nothing drawn and nothing
      // asked for, rather than a code the service would answer with the
      // whole of North America.
      return { type: "FeatureCollection", features: [] };
    }
    const now = Date.now();
    const window = reportWindow(now);
    const missing = wanted.filter((state) => {
      const standing = held.get(state);
      return !standing || now - standing.at >= COCORAHS_REFRESH_MS;
    });
    const failed: string[] = [];
    await Promise.all(
      missing.map(async (state) => {
        try {
          held.set(state, {
            at: Date.now(),
            features: await fetchState(state, window, signal),
          });
        } catch (failure) {
          if (signal?.aborted) throw failure;
          // The state is left unheld, so the next pass asks again rather
          // than waiting an hour on an answer nobody got.
          failed.push(state);
        }
      }),
    );
    if (failed.length === wanted.length) {
      throw new Error(
        translate("cocorahs.failed", { answer: serviceAnswer(0) }),
      );
    }
    const features = newestPerStation(
      wanted.flatMap((state) => held.get(state)?.features ?? []),
    ).filter((feature) => within(feature, bounds));
    return {
      type: "FeatureCollection",
      features,
      // Which states went missing, so a screen showing Kansas and not
      // Nebraska is not read as a dry night in Nebraska.
      partial:
        failed.length > 0
          ? translate("cocorahs.partial", { states: failed.join(", ") })
          : undefined,
    };
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-daily`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["get", "kind"], "daily"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          COCORAHS_MIN_ZOOM,
          3,
          11,
          7,
        ],
        // The scale people act on: a tenth of an inch is a damp morning, an
        // inch is a wet one, three is a creek out of its banks.
        "circle-color": [
          "step",
          ["coalesce", ["get", "inches"], -1],
          // Below zero is the coalesce standing in for a station that
          // reported no total at all, which is a station rather than a dry
          // garden and is drawn hollow.
          "rgba(148, 163, 184, 0.55)",
          0,
          "#e2e8f0",
          0.1,
          "#7dd3fc",
          0.5,
          "#38bdf8",
          1,
          "#22c55e",
          2,
          "#facc15",
          3,
          "#fb923c",
          5,
          "#f43f5e",
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(2, 6, 23, 0.6)",
        "circle-opacity": 0.9,
      },
    },
    {
      id: `${sourceId}-hail`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["get", "kind"], "hail"],
      paint: {
        // Sized by the stone rather than coloured by it: a hail report on a
        // map of rain totals has to be a different shape of thing, and the
        // size is the measurement a reader is after.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "largestInches"], 0.25],
          0.25,
          5,
          2,
          14,
        ],
        "circle-color": "rgba(15, 23, 42, 0)",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#f8fafc",
        "circle-opacity": 1,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const place = properties.place;
    if (typeof place === "string") lines.push(place);
    if (properties.kind === "hail") {
      const largest = properties.largestInches;
      if (typeof largest === "number") {
        lines.push(translate("cocorahs.largest", { size: stone(largest) }));
      }
      const average = properties.averageInches;
      if (typeof average === "number") {
        lines.push(translate("cocorahs.average", { size: stone(average) }));
      }
      const minutes = properties.minutes;
      if (typeof minutes === "number") {
        lines.push(
          translate("cocorahs.duration", { count: Math.round(minutes) }),
        );
      }
      const consistency = properties.consistency;
      if (typeof consistency === "string") {
        // The observer's own words off a fixed list, which this app does not
        // translate for the same reason it leaves a forecaster's categories
        // alone: renaming somebody's report is not translating it.
        lines.push(consistency.split("|").join(", "));
      }
    } else {
      const inches = properties.inches;
      lines.push(
        typeof inches === "number"
          ? translate("cocorahs.total", { depth: depth(inches) })
          : translate("cocorahs.noTotal"),
      );
    }
    const observed = observedWords(
      typeof properties.observedDate === "string"
        ? properties.observedDate
        : null,
      typeof properties.observedTime === "string"
        ? properties.observedTime
        : null,
    );
    if (observed !== null) {
      // Said to be the observer's own clock, because it is: the service
      // publishes a local date and time with no zone on either, and shown
      // beside the workspace's own times it would read as those.
      lines.push(translate("cocorahs.observed", { when: observed }));
    }
    const station = String(properties.station ?? "");
    return {
      title:
        properties.kind === "hail"
          ? translate("cocorahs.hailAt", { station })
          : translate("cocorahs.gauge", { station }),
      lines,
      url: `https://www.cocorahs.org/ViewData/ListDailyPrecipReports.aspx`,
    };
  },
};

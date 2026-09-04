import type { RadarFrame } from "./radar";
import { serviceAnswer } from "./serviceAnswer";
import { translate } from "../i18n";

const INDEX_URL = "hurdat/index.json";
const TRACKS_URL = "hurdat";
/** The Iowa State radar archive starts here, so nothing older can be replayed. */
export const ARCHIVE_FIRST_YEAR = 2003;
const ARCHIVE_STEP_MINUTES = 15;
const ARCHIVE_HALF_WINDOW_MINUTES = 180;
const ARCHIVE_ATTRIBUTION =
  '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet NEXRAD archive</a>';

/**
 * One track point: time, latitude, longitude, wind in knots, status index, and
 * whether HURDAT2 marked it as a landfall.
 */
export type TrackPoint = [number, number, number, number, number, number];

/**
 * What the archive mosaic actually covers. A storm with no fix in here has no
 * radar to replay, however strong it was.
 */
export const RADAR_DOMAIN = {
  west: -127,
  south: 23.5,
  east: -65,
  north: 50,
};

/** One row of the index: id, name, ACE, peak wind, first fix, last fix, fixes. */
type StoredSummary = [string, string, number, number, number, number, number];

interface StoredIndex {
  generated: string;
  statuses: string[];
  storms: StoredSummary[];
}

/** Everything about a storm except where it went. */
export interface StormSummary {
  id: string;
  name: string;
  year: number;
  basin: "AL" | "EP";
  /** Accumulated cyclone energy, in ten-thousands of knots squared. */
  ace: number;
  peakWindKt: number;
  start: number;
  end: number;
  /** How many six-hourly fixes the record holds. */
  fixes: number;
}

export interface Storm extends StormSummary {
  track: TrackPoint[];
  statuses: string[];
}

let index: Promise<StormSummary[]> | null = null;
let statuses: string[] = [];
const decades = new Map<number, Promise<Record<string, TrackPoint[]>>>();

/** The file a storm's track lives in. */
function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

function toSummary(stored: StoredSummary): StormSummary {
  const [id, name, ace, peakWindKt, start, end, fixes] = stored;
  return {
    id,
    name: name || "Unnamed",
    // The id carries both: AL011851 is the first Atlantic storm of 1851, and
    // a central Pacific CP id belongs to the eastern Pacific record.
    year: Number(id.slice(4)),
    basin: id.startsWith("AL") ? "AL" : "EP",
    ace,
    peakWindKt,
    start,
    end,
    fixes,
  };
}

/**
 * Every storm, without its track.
 *
 * The whole record is nearly three megabytes and a search does not need any of
 * the positions in it, so this reads the index alone and the tracks arrive one
 * decade at a time as storms are picked.
 *
 * The read is shared between callers, so it deliberately takes no abort
 * signal: one caller going away must not cancel the load everyone else is
 * waiting on.
 */
export async function loadStorms(): Promise<StormSummary[]> {
  index ??= (async () => {
    const response = await fetch(INDEX_URL);
    if (!response.ok) {
      throw new Error(
        translate("history.archiveStatus", {
          answer: serviceAnswer(response.status),
        }),
      );
    }
    const record = (await response.json()) as StoredIndex;
    statuses = record.statuses;
    return record.storms.map(toSummary);
  })().catch((failure: unknown) => {
    // A failed load must not be cached, or the panel can never recover.
    index = null;
    throw failure;
  });
  return index;
}

/** The tracks for one decade, fetched once and kept. */
function loadDecade(decade: number): Promise<Record<string, TrackPoint[]>> {
  let held = decades.get(decade);
  if (!held) {
    held = (async () => {
      const response = await fetch(`${TRACKS_URL}/${decade}.json`);
      if (!response.ok) {
        throw new Error(
          translate("history.archiveStatus", {
            answer: serviceAnswer(response.status),
          }),
        );
      }
      return (await response.json()) as Record<string, TrackPoint[]>;
    })().catch((failure: unknown) => {
      decades.delete(decade);
      throw failure;
    });
    decades.set(decade, held);
  }
  return held;
}

/** One storm with the track it needs to be drawn. */
export async function loadStorm(id: string): Promise<Storm> {
  const summaries = await loadStorms();
  const summary = summaries.find((storm) => storm.id === id);
  if (!summary) throw new Error(translate("history.unknownStorm"));
  const byId = await loadDecade(decadeOf(summary.year));
  const track = byId[id];
  if (!track) throw new Error(translate("history.unknownStorm"));
  return { ...summary, track, statuses };
}

/**
 * Matches on name and year together, so "ian 2022" finds one storm and "ian"
 * finds every one of them.
 */
export function searchStorms<T extends StormSummary>(
  storms: T[],
  query: string,
): T[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return [];

  const words = trimmed.split(/\s+/);
  const years = words
    .filter((word) => /^\d{4}$/.test(word))
    .map((word) => Number(word));
  const names = words.filter((word) => !/^\d{4}$/.test(word));

  return storms
    .filter((storm) => {
      if (years.length && !years.includes(storm.year)) return false;
      if (!names.length) return true;
      const name = storm.name.toLowerCase();
      return names.every((word) => name.includes(word));
    })
    .slice(0, 40);
}

/**
 * A track that crosses the date line has to be drawn as separate pieces. Left
 * as one line, a step from 179.9 to -179.9 is drawn the long way round and
 * stripes the whole map.
 */
export function trackSegments(track: TrackPoint[]): number[][][] {
  const segments: number[][][] = [];
  let current: number[][] = [];
  for (const [index, point] of track.entries()) {
    const previous = track[index - 1];
    if (previous && Math.abs(point[2] - previous[2]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([point[2], point[1]]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/**
 * What the archive calls the state of a storm, in words.
 *
 * The nine codes NOAA documents for HURDAT2, which are the nine the shipped
 * data uses. Anything else is shown as it arrived rather than swallowed: a
 * code this build has never seen is still worth putting in front of somebody
 * who can look it up.
 */
const STORM_KINDS = [
  "TD",
  "TS",
  "HU",
  "EX",
  "SD",
  "SS",
  "LO",
  "WV",
  "DB",
] as const;

function stormKind(code: string | undefined): string {
  if (!code) return "";
  const known = STORM_KINDS.find((kind) => kind === code);
  return known ? translate(`storm.status.${known}`) : code;
}

export function stormTrack(storm: Storm): Record<string, unknown> {
  const line = {
    type: "Feature",
    geometry: {
      type: "MultiLineString",
      coordinates: trackSegments(storm.track),
    },
    properties: { kind: "line", color: "#e2e8f0", width: 2 },
  };

  const points = storm.track.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point[2], point[1]] },
    properties: {
      kind: "place",
      color: trackColor(point[3]),
      // Through the catalogue, because none of this label was the reader's
      // own words: the French copy says nœuds in every other place it names
      // a wind speed and this one said kt, and the state of the storm was
      // the archive's two-letter code. A map point read "TS 65 kt".
      label: translate("history.trackPoint", {
        kind: stormKind(storm.statuses[point[4]]),
        knots: point[3],
      }).trim(),
    },
  }));

  return { type: "FeatureCollection", features: [line, ...points] };
}

/** Saffir-Simpson in knots, with the two sub-hurricane bands below it. */
export function trackColor(windKt: number): string {
  if (windKt >= 137) return "#c026d3";
  if (windKt >= 113) return "#f43f5e";
  if (windKt >= 96) return "#f97316";
  if (windKt >= 83) return "#fb923c";
  if (windKt >= 64) return "#facc15";
  if (windKt >= 34) return "#38bdf8";
  return "#94a3b8";
}

/** The Saffir-Simpson name for a peak wind, which is how storms get talked about. */
export function categoryLabel(windKt: number): string {
  if (windKt >= 137) return translate("storm.cat5");
  if (windKt >= 113) return translate("storm.cat4");
  if (windKt >= 96) return translate("storm.cat3");
  if (windKt >= 83) return translate("storm.cat2");
  if (windKt >= 64) return translate("storm.cat1");
  if (windKt >= 34) return translate("storm.tropicalStorm");
  return translate("storm.tropicalDepression");
}

export function peakPoint(storm: Storm): TrackPoint {
  return strongest(storm.track) ?? storm.track[0];
}

function strongest(points: TrackPoint[]): TrackPoint | null {
  if (!points.length) return null;
  return points.reduce((best, point) => (point[3] > best[3] ? point : best));
}

function withinRadar(point: TrackPoint): boolean {
  return (
    point[1] >= RADAR_DOMAIN.south &&
    point[1] <= RADAR_DOMAIN.north &&
    point[2] >= RADAR_DOMAIN.west &&
    point[2] <= RADAR_DOMAIN.east
  );
}

export interface ReplayFocus {
  point: TrackPoint;
  /** True when the moment is a landfall rather than a closest approach. */
  landfall: boolean;
}

/**
 * The moment a replay is about. A landfall is what anyone looking a storm up
 * wants to watch, and it is rarely the peak: Ian was strongest six hours out
 * in the Gulf and came ashore later and weaker. Where a storm never came
 * ashore, the strongest fix the radar could see is the next best thing.
 */
export function replayFocus(storm: Storm): ReplayFocus | null {
  const reachable = storm.track.filter(withinRadar);
  if (!reachable.length) return null;
  const landfalls = reachable.filter((point) => point[5] === 1);
  const point = strongest(landfalls.length ? landfalls : reachable);
  return point ? { point, landfall: landfalls.length > 0 } : null;
}

function archiveStamp(time: number): string {
  return new Date(time * 1000).toISOString().replace(/\D/g, "").slice(0, 12);
}

/**
 * The archive only holds the national mosaic, so a storm that stayed out of
 * its reach has nothing to play even when the years line up.
 */
export function canReplay(storm: Storm): boolean {
  return storm.year >= ARCHIVE_FIRST_YEAR && replayFocus(storm) !== null;
}

/**
 * Archive radar around the storm's strongest moment, which is the part anyone
 * looking a storm up wants to watch.
 */
export function archiveFrames(storm: Storm): RadarFrame[] {
  const focus = storm.year >= ARCHIVE_FIRST_YEAR ? replayFocus(storm) : null;
  if (!focus) return [];
  const centre = focus.point[0];
  const step = ARCHIVE_STEP_MINUTES * 60;
  const from =
    Math.floor((centre - ARCHIVE_HALF_WINDOW_MINUTES * 60) / step) * step;
  const to = centre + ARCHIVE_HALF_WINDOW_MINUTES * 60;

  const frames: RadarFrame[] = [];
  for (let at = from; at <= to; at += step) {
    frames.push({
      providerId: "archive",
      time: at,
      tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${archiveStamp(at)}/{z}/{x}/{y}.png`,
      tileSize: 256,
      maxZoom: 9,
      attribution: ARCHIVE_ATTRIBUTION,
    });
  }
  return frames;
}

/**
 * The box a track fits in. A storm that crosses the date line is measured the
 * short way round, so the box comes back with its east edge west of its west
 * edge rather than wrapping the whole world.
 */
export function trackBounds(track: TrackPoint[]): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const lats = track.map((point) => point[1]);
  const lons = track.map((point) => point[2]);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  const plain = { west: Math.min(...lons), east: Math.max(...lons) };
  // Measured again with everything on one side of the date line. Whichever
  // reading is narrower is the one that describes the storm.
  const shifted = lons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const across = { west: Math.min(...shifted), east: Math.max(...shifted) };

  if (across.east - across.west < plain.east - plain.west) {
    return {
      west: across.west > 180 ? across.west - 360 : across.west,
      east: across.east > 180 ? across.east - 360 : across.east,
      south,
      north,
    };
  }
  return { ...plain, south, north };
}

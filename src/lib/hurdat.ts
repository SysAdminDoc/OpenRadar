import type { RadarFrame } from "./radar";

const RECORD_URL = "hurdat.json";
/** The Iowa State radar archive starts here, so nothing older can be replayed. */
export const ARCHIVE_FIRST_YEAR = 2003;
const ARCHIVE_STEP_MINUTES = 15;
const ARCHIVE_HALF_WINDOW_MINUTES = 180;
const ARCHIVE_ATTRIBUTION =
  '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet NEXRAD archive</a>';

/** One track point: time, latitude, longitude, wind in knots, status index. */
export type TrackPoint = [number, number, number, number, number];

interface StoredStorm {
  i: string;
  n: string;
  y: number;
  b: string;
  a: number;
  p: TrackPoint[];
}

interface StoredRecord {
  generated: string;
  statuses: string[];
  storms: StoredStorm[];
}

export interface Storm {
  id: string;
  name: string;
  year: number;
  basin: "AL" | "EP";
  /** Accumulated cyclone energy, in ten-thousands of knots squared. */
  ace: number;
  peakWindKt: number;
  start: number;
  end: number;
  track: TrackPoint[];
  statuses: string[];
}

let loaded: Promise<Storm[]> | null = null;

function toStorm(stored: StoredStorm, statuses: string[]): Storm {
  return {
    id: stored.i,
    name: stored.n || "Unnamed",
    year: stored.y,
    basin: stored.b === "EP" ? "EP" : "AL",
    ace: stored.a,
    peakWindKt: stored.p.reduce((peak, point) => Math.max(peak, point[3]), 0),
    start: stored.p[0][0],
    end: stored.p[stored.p.length - 1][0],
    track: stored.p,
    statuses,
  };
}

/**
 * Reads the bundled record once and keeps it for the session. The read is
 * shared between callers, so it deliberately takes no abort signal: one caller
 * going away must not cancel the load everyone else is waiting on.
 */
export async function loadStorms(): Promise<Storm[]> {
  loaded ??= (async () => {
    const response = await fetch(RECORD_URL);
    if (!response.ok) {
      throw new Error(`The storm archive returned ${response.status}.`);
    }
    const record = (await response.json()) as StoredRecord;
    return record.storms.map((storm) => toStorm(storm, record.statuses));
  })().catch((failure: unknown) => {
    // A failed load must not be cached, or the panel can never recover.
    loaded = null;
    throw failure;
  });
  return loaded;
}

export function resetStorms() {
  loaded = null;
}

/**
 * Matches on name and year together, so "ian 2022" finds one storm and "ian"
 * finds every one of them.
 */
export function searchStorms(storms: Storm[], query: string): Storm[] {
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

export function stormTrack(storm: Storm): Record<string, unknown> {
  const line = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: storm.track.map((point) => [point[2], point[1]]),
    },
    properties: { kind: "line", color: "#e2e8f0", width: 2 },
  };

  const points = storm.track.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point[2], point[1]] },
    properties: {
      kind: "place",
      color: trackColor(point[3]),
      label: `${storm.statuses[point[4]] ?? ""} ${point[3]} kt`.trim(),
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
  if (windKt >= 137) return "Category 5";
  if (windKt >= 113) return "Category 4";
  if (windKt >= 96) return "Category 3";
  if (windKt >= 83) return "Category 2";
  if (windKt >= 64) return "Category 1";
  if (windKt >= 34) return "Tropical storm";
  return "Tropical depression";
}

export function peakPoint(storm: Storm): TrackPoint {
  return storm.track.reduce(
    (peak, point) => (point[3] > peak[3] ? point : peak),
    storm.track[0],
  );
}

function archiveStamp(time: number): string {
  return new Date(time * 1000).toISOString().replace(/\D/g, "").slice(0, 12);
}

export function canReplay(storm: Storm): boolean {
  return storm.year >= ARCHIVE_FIRST_YEAR;
}

/**
 * Archive radar around the storm's strongest moment, which is the part anyone
 * looking a storm up wants to watch.
 */
export function archiveFrames(storm: Storm): RadarFrame[] {
  if (!canReplay(storm)) return [];
  const centre = peakPoint(storm)[0];
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

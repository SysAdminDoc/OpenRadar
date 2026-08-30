import { isDesktopRuntime } from "./settings";
import { haversineMiles, type GeoPoint } from "./geo";

/**
 * Storm cells, as the radar's own tracking algorithm found them.
 *
 * The mosaic says where rain is. This says which blobs are one storm, which
 * way each is going, and how fast, which is what turns a picture into
 * "reaching you in twenty minutes". It comes from the Level III products the
 * Radar Product Generator publishes beside the raw volumes.
 */

export interface CellPoint {
  latitude: number;
  longitude: number;
}

export interface StormCell {
  /** A letter and a digit, as the algorithm names them. */
  id: string;
  latitude: number;
  longitude: number;
  rangeKm: number;
  azimuthDegrees: number;
  /** Absent for a cell the algorithm has only just found. */
  directionDegrees: number | null;
  speedMs: number | null;
  /** Quarter-hour steps out to an hour, when the algorithm forecast that far. */
  forecast: CellPoint[];
  past: CellPoint[];
}

export interface Mesocyclone {
  latitude: number;
  longitude: number;
  radiusKm: number;
  kind: string;
}

export interface CellReport {
  station: string;
  siteLatitude: number;
  siteLongitude: number;
  observed: string;
  cells: StormCell[];
  mesocyclones: Mesocyclone[];
}

/** Level III is decoded natively, so a browser preview has none of it. */
export function cellsAvailable(): boolean {
  return isDesktopRuntime();
}

export async function fetchCells(station: string): Promise<CellReport> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CellReport>("level3_cells", { station });
}

/** How long a volume's cells are worth drawing, in minutes. */
export const CELLS_STALE_MINUTES = 20;

/** The products come once a volume, so this is roughly one scan. */
export const CELLS_REFRESH_MS = 4 * 60_000;

const MILES_TO_KM = 1.609344;

/**
 * How long until a cell reaches a place, in minutes, or null when it never
 * will.
 *
 * The algorithm gives a bearing and a speed, so this is the component of that
 * motion pointing at the place divided into the distance. A storm moving away,
 * or across, has no arrival: reporting the time it would take if it turned
 * round would be inventing a forecast the algorithm did not make.
 */
export function minutesUntilArrival(
  cell: StormCell,
  place: GeoPoint,
): number | null {
  if (cell.directionDegrees === null || cell.speedMs === null) return null;
  if (cell.speedMs <= 0) return null;

  const from: GeoPoint = { lat: cell.latitude, lon: cell.longitude };
  const distanceKm = haversineMiles(from, place) * MILES_TO_KM;
  // Already there.
  if (distanceKm < 1) return 0;

  const bearing = bearingDegrees(from, place);
  const apart = ((cell.directionDegrees - bearing + 540) % 360) - 180;
  // More than sixty degrees off and it is going past rather than coming.
  if (Math.abs(apart) > 60) return null;

  const closingMs = cell.speedMs * Math.cos((apart * Math.PI) / 180);
  if (closingMs <= 0) return null;
  return (distanceKm * 1000) / closingMs / 60;
}

/** The compass bearing from one place to another. */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * The soonest any tracked cell reaches the watched place.
 *
 * Only cells actually heading there count, so a quiet answer means nothing is
 * coming rather than nothing was found.
 */
export function soonestArrival(
  report: CellReport | null,
  place: GeoPoint | null,
): { cell: StormCell; minutes: number } | null {
  if (!report || !place) return null;
  let best: { cell: StormCell; minutes: number } | null = null;
  for (const cell of report.cells) {
    const minutes = minutesUntilArrival(cell, place);
    if (minutes === null) continue;
    if (!best || minutes < best.minutes) best = { cell, minutes };
  }
  return best;
}

/** Which cells have a rotation sitting on them, by cell id. */
export function rotatingCells(report: CellReport): Set<string> {
  const out = new Set<string>();
  for (const rotation of report.mesocyclones) {
    let nearest: { id: string; km: number } | null = null;
    for (const cell of report.cells) {
      const km =
        haversineMiles(
          { lat: cell.latitude, lon: cell.longitude },
          { lat: rotation.latitude, lon: rotation.longitude },
        ) * MILES_TO_KM;
      if (!nearest || km < nearest.km) nearest = { id: cell.id, km };
    }
    // A circulation belongs to the storm it is inside, not to whichever cell
    // happens to be closest across the county.
    if (nearest && nearest.km <= 15) out.add(nearest.id);
  }
  return out;
}

/** The cells and their tracks, as the map draws them. */
export function cellFeatures(
  report: CellReport,
  rotating: Set<string>,
): Record<string, unknown> {
  const features: Array<Record<string, unknown>> = [];
  for (const cell of report.cells) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [cell.longitude, cell.latitude],
      },
      properties: {
        kind: "cell",
        id: cell.id,
        rotating: rotating.has(cell.id),
        speedMs: cell.speedMs,
        directionDegrees: cell.directionDegrees,
      },
    });
    // The track is drawn as one line through where it has been, where it is,
    // and where it is going, so the reader sees one storm rather than three
    // sets of dots.
    const path = [
      ...cell.past.map((point) => [point.longitude, point.latitude]),
      [cell.longitude, cell.latitude],
      ...cell.forecast.map((point) => [point.longitude, point.latitude]),
    ];
    if (path.length > 1) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: path },
        properties: { kind: "track", id: cell.id },
      });
    }
    for (const [at, point] of cell.forecast.entries()) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          kind: "forecast",
          id: cell.id,
          // Quarter-hour steps, so the reader can tell the half hour from the
          // hour rather than seeing four identical dots.
          minutes: (at + 1) * 15,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

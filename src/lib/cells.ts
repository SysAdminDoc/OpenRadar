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
 * How close a storm gets to a place, and when, or null when it never comes.
 *
 * The obvious sum is wrong. Dividing the whole distance by the part of the
 * speed pointing at the place answers "when has it travelled that far along
 * its own track", which for a storm forty kilometres away at forty-five
 * degrees off says forty-seven minutes for something that is nearest at
 * twenty-four and never gets closer than twenty-eight kilometres. The number
 * somebody acts on has to be the moment of closest approach, and it is only
 * worth saying at all if the storm actually gets near.
 *
 * The storm is treated as travelling in a straight line at a steady speed,
 * which is what the algorithm's own forecast positions assume.
 */
export interface Approach {
  /** Minutes from the moment the volume was taken. */
  minutes: number;
  /** How near it gets, in kilometres. */
  distanceKm: number;
}

export function closestApproach(
  cell: StormCell,
  place: GeoPoint,
): Approach | null {
  if (cell.directionDegrees === null || cell.speedMs === null) return null;
  if (!Number.isFinite(cell.speedMs) || cell.speedMs <= 0) return null;
  if (!Number.isFinite(cell.directionDegrees)) return null;

  const from: GeoPoint = { lat: cell.latitude, lon: cell.longitude };
  const distanceKm = haversineMiles(from, place) * MILES_TO_KM;
  const bearing = bearingDegrees(from, place);
  // How far off the storm's heading the place is.
  const apart =
    (((cell.directionDegrees - bearing + 540) % 360) - 180) * (Math.PI / 180);

  // Distance along the storm's track to the point nearest the place, and how
  // far off the track that point lies. Behind the storm means it is going
  // away, and there is nothing to say.
  const alongKm = distanceKm * Math.cos(apart);
  if (alongKm <= 0) return null;
  const offKm = Math.abs(distanceKm * Math.sin(apart));

  const speedKmMin = (cell.speedMs * 60) / 1000;
  return { minutes: alongKm / speedKmMin, distanceKm: offKm };
}

/**
 * How long until a cell reaches a place, in minutes, or null when it does not.
 *
 * "Near" is a radius rather than an angle. A storm passing four kilometres
 * away at sixty-one degrees off is coming to you; one passing eighty-eight
 * kilometres away at fifty-nine degrees is not, and an angle cannot tell them
 * apart at two different distances.
 */
export function minutesUntilArrival(
  cell: StormCell,
  place: GeoPoint,
  nearKm = NEAR_KM,
): number | null {
  const approach = closestApproach(cell, place);
  if (!approach) return null;
  if (approach.distanceKm > nearKm) return null;
  return Math.max(0, approach.minutes);
}

/**
 * How near a storm has to pass to be worth telling somebody about.
 *
 * Twenty kilometres is about the width of a severe storm's damaging core plus
 * the error in an hour-old track. Wider and every storm in the county is
 * "coming"; narrower and one that hits the next town over goes unmentioned.
 */
export const NEAR_KM = 20;

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
  /** Now, so the age of the volume comes off the answer. */
  clock: number = Date.now(),
): { cell: StormCell; minutes: number } | null {
  if (!report || !place) return null;

  // The cells describe where things were when the volume was taken, and a
  // volume is minutes old by the time anybody reads it. Printing "in twelve
  // minutes" from a picture taken eight minutes ago is eight minutes late,
  // which on a storm this is about is the whole margin.
  const observed = Date.parse(report.observed);
  const ageMinutes = Number.isFinite(observed)
    ? Math.max(0, (clock - observed) / 60_000)
    : 0;

  let best: { cell: StormCell; minutes: number } | null = null;
  for (const cell of report.cells) {
    const minutes = minutesUntilArrival(cell, place);
    if (minutes === null) continue;
    const fromNow = Math.max(0, minutes - ageMinutes);
    if (!best || fromNow < best.minutes) best = { cell, minutes: fromNow };
  }
  return best;
}

/**
 * How far a rotation may sit from a cell and still be that storm's.
 *
 * The circulation's own radius is added, because a wide one genuinely reaches
 * further from the point the algorithm put it at. Fifteen kilometres of slack
 * on top is a squall line's spacing, which is the case this has to get right:
 * cells ten kilometres apart, and picking the nearest alone credits the
 * rotation to whichever centroid happens to be marginally closer.
 */
const ROTATION_REACH_KM = 15;

/** Which cells have a rotation sitting on them, by cell id. */
export function rotatingCells(report: CellReport): Set<string> {
  const out = new Set<string>();
  for (const rotation of report.mesocyclones) {
    const reach = ROTATION_REACH_KM + rotation.radiusKm;
    // Every cell it could belong to, not only the nearest: two storms ten
    // kilometres apart can both be inside one circulation's reach, and
    // saying so is more honest than picking one by a hundred metres.
    for (const cell of report.cells) {
      const km =
        haversineMiles(
          { lat: cell.latitude, lon: cell.longitude },
          { lat: rotation.latitude, lon: rotation.longitude },
        ) * MILES_TO_KM;
      if (km <= reach) out.add(cell.id);
    }
  }
  return out;
}

/**
 * The rotations that belong to no tracked cell.
 *
 * They exist: the mesocyclone product is published on its own schedule and the
 * tracking algorithm does not find every storm a circulation sits in. Dropping
 * them silently meant a radar reporting six mesocyclones and a panel saying it
 * was not tracking any storms.
 */
export function unmatchedRotations(report: CellReport): Mesocyclone[] {
  return report.mesocyclones.filter((rotation) => {
    const reach = ROTATION_REACH_KM + rotation.radiusKm;
    return !report.cells.some(
      (cell) =>
        haversineMiles(
          { lat: cell.latitude, lon: cell.longitude },
          { lat: rotation.latitude, lon: rotation.longitude },
        ) *
          MILES_TO_KM <=
        reach,
    );
  });
}

/** The cells and their tracks, as the map draws them. */
export function cellFeatures(
  report: CellReport,
  rotating: Set<string>,
  /**
   * What the reader calls each storm, keyed by station and identifier.
   *
   * The label carries both: the name is the reader's and the identifier is
   * the data's, so a picture of this can still be checked against the
   * office's own products. Keyed by the station as well, because A1 on one
   * radar is a different storm from A1 on the next.
   */
  names: ReadonlyMap<string, string> = new Map(),
): Record<string, unknown> {
  const features: Array<Record<string, unknown>> = [];
  for (const cell of report.cells) {
    const named = names.get(`${report.station}|${cell.id}`);
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [cell.longitude, cell.latitude],
      },
      properties: {
        kind: "cell",
        id: cell.id,
        label: named ? `${named} (${cell.id})` : cell.id,
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
  // A circulation the tracking algorithm found no storm for is still a
  // circulation, and it is drawn where it is rather than left off.
  for (const rotation of unmatchedRotations(report)) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [rotation.longitude, rotation.latitude],
      },
      properties: {
        kind: "rotation",
        id: rotation.kind,
        radiusKm: rotation.radiusKm,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

import { haversineMiles, type GeoPoint } from "./geo";
import { translate, type StringKey } from "../i18n";
import {
  formatClock,
  formatDistance,
  speedFromMetres,
  speedUnit,
} from "./units";
import type { StormCell } from "./cells";
import type { OverlayData } from "./overlays";

/**
 * The weather near a place, as sentences.
 *
 * A map canvas cannot be made accessible. MapLibre's own tracker says so and
 * Mapbox's says so; what is on it is pixels, and a reader using a screen
 * reader gets an image with no alternative. Blind users describe radar as the
 * weather feature they give up on.
 *
 * The pattern that does work is radar as data rather than radar as a picture:
 * how far the nearest storm is, which way it is going, and what has been
 * warned about, in words. That is not a lesser version of the map. It is the
 * same three questions anybody asks it, answered without needing to look.
 *
 * Everything here is a pure function over what the app already holds, so the
 * readout and the picture cannot say different things.
 */

/** The eight points, which is as precise as a bearing is useful in words. */
const COMPASS: StringKey[] = [
  "nearby.north",
  "nearby.northeast",
  "nearby.east",
  "nearby.southeast",
  "nearby.south",
  "nearby.southwest",
  "nearby.west",
  "nearby.northwest",
];

/**
 * The bearing from one point to another, in degrees clockwise from north.
 *
 * The great-circle bearing rather than the flat one: over the distances a
 * radar covers the two barely differ, but a storm five hundred miles away at
 * a high latitude is exactly where the flat answer starts being wrong, and
 * this is not more code.
 */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const fromLat = radians(from.lat);
  const toLat = radians(to.lat);
  const deltaLon = radians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** A bearing as one of eight words. */
export function compassPoint(degrees: number): string {
  const at = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return translate(COMPASS[at]);
}

/** A storm's speed as the reader's own units say it. */
function spokenSpeed(metresPerSecond: number): string {
  return `${Math.round(speedFromMetres(metresPerSecond))} ${speedUnit()}`;
}

export interface NearbyCell {
  id: string;
  /** Straight-line distance from the place, in miles. */
  miles: number;
  /** Which way the storm lies from the place. */
  bearing: number;
  /** One sentence a reader can hear. */
  sentence: string;
}

/**
 * The storms nearest a place, nearest first.
 *
 * Bounded, because a reader hearing a list has to hold it in their head and
 * the fifth-nearest storm is not what they asked. The radar's own tracker
 * routinely finds dozens.
 */
export const NEARBY_LIMIT = 4;

export function nearbyCells(
  cells: StormCell[],
  place: GeoPoint,
  options: { rotating?: ReadonlySet<string> } = {},
): NearbyCell[] {
  const rotating = options.rotating ?? new Set<string>();
  return cells
    .map((cell) => {
      const at = { lon: cell.longitude, lat: cell.latitude };
      const miles = haversineMiles(place, at);
      const bearing = bearingDegrees(place, at);
      // Where it lies, then where it is going, then whether the radar found a
      // rotation in it, which is the part that changes what somebody does.
      const parts = [
        translate("nearby.cellAt", {
          id: cell.id,
          distance: formatDistance(miles),
          direction: compassPoint(bearing),
        }),
      ];
      if (cell.directionDegrees !== null && cell.speedMs !== null) {
        parts.push(
          translate("nearby.cellMoving", {
            // A storm's own heading is the direction it travels towards.
            direction: compassPoint(cell.directionDegrees),
            speed: spokenSpeed(cell.speedMs),
          }),
        );
      } else {
        parts.push(translate("nearby.cellNewlyFound"));
      }
      if (rotating.has(cell.id)) parts.push(translate("nearby.cellRotating"));
      return { id: cell.id, miles, bearing, sentence: parts.join(" ") };
    })
    .sort((left, right) => left.miles - right.miles)
    .slice(0, NEARBY_LIMIT);
}

export interface NearbyWarning {
  /** The CAP identifier, which is what makes one warning the same warning. */
  id: string;
  /** One sentence: what it is, how bad the office tagged it, how long it runs. */
  sentence: string;
}

/**
 * The warnings over a place, worst first.
 *
 * Read off the same collection the map draws, filtered to the ones whose
 * polygon actually contains the place rather than the ones in view, because
 * "in view" is a question about a picture and this is for somebody who is not
 * looking at one. The collection arrives sorted by severity, so filtering it
 * keeps that order without sorting again.
 */
export function warningsOver(
  alerts: OverlayData | null,
  place: GeoPoint,
): NearbyWarning[] {
  if (!alerts) return [];
  const found: NearbyWarning[] = [];
  for (const feature of alerts.features) {
    if (!containsPoint(feature.geometry, place)) continue;
    const properties = feature.properties;
    const headline = String(properties.headline ?? "");
    if (!headline) continue;
    const impact = String(properties.impact ?? "");
    const expires = Number(properties.expires);
    const parts = [
      impact
        ? translate("nearby.warningTagged", {
            headline,
            tag: translate(`alerts.impact.${impact}` as StringKey),
          })
        : translate("nearby.warning", { headline }),
    ];
    if (Number.isFinite(expires) && expires > 0) {
      parts.push(
        translate("nearby.warningUntil", { when: formatClock(expires) }),
      );
    }
    // The office's own instruction, read out with the warning. This surface
    // exists for a reader who cannot see the map, and what to do about a
    // tornado warning is the part of it that matters most; it was the one
    // place the app could only offer a link to.
    const instruction = String(properties.instruction ?? "").trim();
    if (instruction) parts.push(instruction);
    found.push({
      id: String(properties.capId ?? headline),
      sentence: parts.join(" "),
    });
  }
  return found;
}

/**
 * Whether a place is inside a polygon, by the even-odd rule.
 *
 * Written here rather than pulled in, because the only geometries this ever
 * sees are warning polygons: a Polygon or a MultiPolygon in plain longitude
 * and latitude, no holes worth honouring at the scale of a county, and no
 * antimeridian crossings in a product issued by a single forecast office.
 */
function containsPoint(geometry: unknown, place: GeoPoint): boolean {
  const shape = geometry as { type?: string; coordinates?: unknown };
  if (shape?.type === "Polygon") {
    return ringHolds(shape.coordinates, place);
  }
  if (shape?.type === "MultiPolygon" && Array.isArray(shape.coordinates)) {
    return shape.coordinates.some((polygon) => ringHolds(polygon, place));
  }
  return false;
}

function ringHolds(polygon: unknown, place: GeoPoint): boolean {
  if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return false;
  const ring = polygon[0] as Array<[number, number]>;
  let inside = false;
  for (let at = 0, before = ring.length - 1; at < ring.length; before = at++) {
    const [x1, y1] = ring[at];
    const [x2, y2] = ring[before];
    if (
      y1 > place.lat !== y2 > place.lat &&
      place.lon < ((x2 - x1) * (place.lat - y1)) / (y2 - y1) + x1
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The whole answer as one line, for the live region to read out.
 *
 * The warnings first because they are the part that changes what somebody
 * does, then the nearest storm. Only the nearest: a live region that reads
 * four storms every time the radar turns is not information, it is noise.
 */
export function nearbySummary(
  warnings: NearbyWarning[],
  cells: NearbyCell[],
  placeName: string,
): string {
  const said = [
    ...warnings.map((warning) => warning.sentence),
    ...cells.slice(0, 1).map((cell) => cell.sentence),
  ];
  return said.length
    ? said.join(" ")
    : translate("nearby.nothing", { place: placeName });
}

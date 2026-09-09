import type { GeoPoint } from "./geo";
import { formatDistance } from "./units";
import type { WatchPlace } from "./watch";

/**
 * How many points a ring is drawn with.
 *
 * Enough that the corners do not show at the zoom a thirty-mile ring fills
 * the window at, and few enough that eight of them are still a small
 * document. A ring is redrawn only when a radius or a place moves.
 */
const RING_POINTS = 96;

/** The Earth radius `haversineMiles` measures with, so the two agree. */
const EARTH_RADIUS_MILES = 3958.7613;

/**
 * A closed ring of points at one distance around a place.
 *
 * Great-circle rather than a flat circle in degrees. A flat one is a circle
 * on the screen and the wrong shape on the ground: at fifty degrees north a
 * ring drawn by adding degrees is half again too wide, so the storms it says
 * are inside the radius are not the ones the rules count. The rules measure
 * with `haversineMiles`, and this has to be the same measurement drawn.
 */
export function ringAround(
  center: GeoPoint,
  radiusMiles: number,
): Array<[number, number]> {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const degrees = (value: number) => (value * 180) / Math.PI;
  const angular = Math.max(0, radiusMiles) / EARTH_RADIUS_MILES;
  const lat = radians(center.lat);
  const lon = radians(center.lon);
  const ring: Array<[number, number]> = [];
  for (let step = 0; step <= RING_POINTS; step += 1) {
    // The last point is the first point, which is what closes the ring: a
    // polygon whose ends do not meet is not one, and some readers of GeoJSON
    // close it for you while others draw the gap.
    const bearing = radians((360 * (step % RING_POINTS)) / RING_POINTS);
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angular) +
        Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat),
      );
    // Wrapped into the range the map draws in, or a ring around a place near
    // the date line jumps the world rather than crossing it.
    ring.push([((degrees(pointLon) + 540) % 360) - 180, degrees(pointLat)]);
  }
  return ring;
}

/**
 * The rings for every watched place, as one collection for the map.
 *
 * Two features each: the ring itself, and one label at the top of it. Once
 * per place rather than repeated around the circle, because the distance is
 * one fact about it, and in the units the reader is reading everything else
 * in.
 */
export function watchRingFeatures(
  places: readonly WatchPlace[],
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: places.flatMap((place) => {
      const ring = ringAround(
        { lon: place.center[0], lat: place.center[1] },
        place.radiusMiles,
      );
      return [
        {
          type: "Feature",
          properties: { kind: "ring", id: place.id },
          geometry: { type: "LineString", coordinates: ring },
        },
        {
          type: "Feature",
          properties: {
            kind: "label",
            label: formatDistance(place.radiusMiles),
          },
          // Due north of the place, which is where the ring starts.
          geometry: { type: "Point", coordinates: ring[0] },
        },
      ];
    }),
  };
}

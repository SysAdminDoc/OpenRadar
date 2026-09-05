export interface GeoPoint {
  lon: number;
  lat: number;
}

export function haversineMiles(start: GeoPoint, end: GeoPoint): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const latitudeDelta = toRadians(end.lat - start.lat);
  const longitudeDelta = toRadians(end.lon - start.lon);
  const startLatitude = toRadians(start.lat);
  const endLatitude = toRadians(end.lat);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The compass bearing from one place to another, in degrees from north.
 *
 * Great-circle rather than flat. Over the distance a single radar covers the
 * two barely differ, and a storm five hundred miles away at a high latitude
 * is exactly where the flat answer starts being wrong.
 *
 * Written twice before this, in `cells.ts` and `nearby.ts`, in two spellings
 * of the same arithmetic. Neither had drifted yet. The pair beside them had:
 * this file and `sounding.ts` held two Earth radii.
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

export { formatDistance } from "./units";

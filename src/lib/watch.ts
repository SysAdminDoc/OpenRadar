import { haversineMiles, type GeoPoint } from "./geo";
import { SEVERITY_RANK, type AlertSeverity } from "./overlays/alerts";
import {
  featureBounds,
  type OverlayBounds,
  type OverlayData,
} from "./overlays";

export interface WatchSettings {
  enabled: boolean;
  center: [number, number];
  radiusMiles: number;
  /** The least severe alert worth interrupting someone for. */
  minSeverity: AlertSeverity;
}

export interface WatchAlert {
  id: string;
  headline: string;
  severity: AlertSeverity;
  expires: number | null;
  distanceMiles: number;
}

/** A box around the watched point, which is what the alert service is asked for. */
export function watchBounds(watch: WatchSettings): OverlayBounds {
  const [lon, lat] = watch.center;
  const latitudeSpan = watch.radiusMiles / 69;
  const longitudeSpan =
    watch.radiusMiles / (69 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)));
  return {
    west: Math.max(-180, lon - longitudeSpan),
    south: Math.max(-85, lat - latitudeSpan),
    east: Math.min(180, lon + longitudeSpan),
    north: Math.min(85, lat + latitudeSpan),
  };
}

function nearestCorner(bounds: OverlayBounds, point: GeoPoint): number {
  const inside =
    point.lon >= bounds.west &&
    point.lon <= bounds.east &&
    point.lat >= bounds.south &&
    point.lat <= bounds.north;
  if (inside) return 0;

  const lon = Math.min(Math.max(point.lon, bounds.west), bounds.east);
  const lat = Math.min(Math.max(point.lat, bounds.south), bounds.north);
  return haversineMiles(point, { lon, lat });
}

function alertId(properties: Record<string, unknown>, index: number): string {
  const url = String(properties.url ?? "");
  if (url) return url;
  return `${String(properties.headline ?? "alert")}-${String(properties.issued ?? index)}`;
}

/**
 * Which alerts deserve to interrupt someone: severe enough, close enough, still
 * in force, and not already announced.
 */
export function alertsToAnnounce(
  alerts: OverlayData,
  watch: WatchSettings,
  announced: ReadonlySet<string>,
  now: number,
): WatchAlert[] {
  if (!watch.enabled) return [];
  const floor = SEVERITY_RANK[watch.minSeverity];
  const point: GeoPoint = { lon: watch.center[0], lat: watch.center[1] };

  const found: WatchAlert[] = [];
  for (const [index, feature] of alerts.features.entries()) {
    const severity = String(feature.properties.severity ?? "") as AlertSeverity;
    if (!(severity in SEVERITY_RANK)) continue;
    if (SEVERITY_RANK[severity] < floor) continue;

    const expires = feature.properties.expires;
    if (typeof expires === "number" && expires <= now) continue;

    const bounds = featureBounds(feature.geometry);
    if (!bounds) continue;
    const distance = nearestCorner(bounds, point);
    if (distance > watch.radiusMiles) continue;

    const id = alertId(feature.properties, index);
    if (announced.has(id)) continue;

    found.push({
      id,
      headline: String(feature.properties.headline ?? "Weather alert"),
      severity,
      expires: typeof expires === "number" ? expires : null,
      distanceMiles: distance,
    });
  }

  return found.sort(
    (left, right) =>
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
      left.distanceMiles - right.distanceMiles,
  );
}

export function watchAlertBody(alert: WatchAlert): string {
  const where =
    alert.distanceMiles < 1
      ? "where you are watching"
      : `${Math.round(alert.distanceMiles)} miles from the point you watch`;
  return `${alert.headline} ${where}.`;
}

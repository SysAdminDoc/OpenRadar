import { haversineMiles, type GeoPoint } from "./geo";
import { SEVERITY_RANK, type AlertSeverity } from "./overlays/alerts";
import {
  featureBounds,
  type OverlayBounds,
  type OverlayData,
} from "./overlays";
import { translate } from "../i18n";
import { distanceUnit, distanceValue } from "./units";

export interface WatchSettings {
  enabled: boolean;
  center: [number, number];
  radiusMiles: number;
  /** The least severe alert worth interrupting someone for. */
  minSeverity: AlertSeverity;
  /** Whether an announcement also makes a sound. */
  sound: boolean;
}

export interface WatchAlert {
  id: string;
  headline: string;
  /** The damage threat the office attached, or empty for most warnings. */
  impact: string;
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

/**
 * The same alert has to answer to the same id on every poll. The list is sorted
 * by severity, so a position in it is not an identity.
 */
/**
 * What makes one announcement different from another.
 *
 * The damage threat is part of it. An office can upgrade a warning already in
 * force, from nothing to considerable or from considerable to destructive, and
 * that is worth interrupting somebody for a second time: it is the office
 * saying the thing got worse. Leaving the tag out of the identity would keep
 * the upgrade quiet, and putting the whole alert in would announce it again on
 * every unrelated correction.
 */
function alertId(
  properties: Record<string, unknown>,
  bounds: OverlayBounds,
): string {
  const impact = String(properties.impact ?? "");
  const url = String(properties.url ?? "");
  if (url) return impact ? `${url}#${impact}` : url;
  const where = [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(3))
    .join(",");
  return `${String(properties.headline ?? "alert")}-${String(properties.issued ?? "")}-${where}-${impact}`;
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
  for (const feature of alerts.features) {
    const severity = String(feature.properties.severity ?? "") as AlertSeverity;
    if (!(severity in SEVERITY_RANK)) continue;
    if (SEVERITY_RANK[severity] < floor) continue;

    const expires = feature.properties.expires;
    if (typeof expires === "number" && expires <= now) continue;

    const bounds = featureBounds(feature.geometry);
    if (!bounds) continue;
    const distance = nearestCorner(bounds, point);
    if (distance > watch.radiusMiles) continue;

    const id = alertId(feature.properties, bounds);
    if (announced.has(id)) continue;

    found.push({
      id,
      headline: String(feature.properties.headline ?? translate("watch.alert")),
      impact: String(feature.properties.impact ?? ""),
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
      ? translate("watch.here")
      : translate("watch.milesAway", {
          miles: distanceValue(alert.distanceMiles),
          unit: distanceUnit(),
        });
  const body = translate("watch.body", { headline: alert.headline, where });
  // The tag goes in the notification too. Somebody woken by this needs to know
  // straight away that the office called it destructive rather than reading
  // the same sentence they read for the ordinary one an hour ago.
  if (!alert.impact) return body;
  return `${body} ${translate("alerts.impactLine", {
    tag: translate(`alerts.impact.${alert.impact}` as never),
  })}`;
}

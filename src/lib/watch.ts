import { haversineMiles, type GeoPoint } from "./geo";
import { SEVERITY_RANK, type AlertSeverity } from "./overlays/alerts";
import {
  featureBounds,
  type OverlayBounds,
  type OverlayData,
} from "./overlays";
import { translate } from "../i18n";
import { distanceUnit, distanceValue } from "./units";

/**
 * Hours the reader would rather not be spoken to during, and what still gets
 * through anyway.
 *
 * The override is the point of the whole thing. A weather app that can be
 * silenced completely is one that fails at the only moment it matters, so the
 * quiet applies to the ordinary run of warnings and never to the ones worth
 * waking somebody for.
 */
export interface QuietHours {
  enabled: boolean;
  /** Minutes past local midnight, so 22:30 is 1350. */
  startMinute: number;
  endMinute: number;
  /** Nothing at this severity or above is ever held back. */
  overrideSeverity: AlertSeverity;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  // Ten at night until seven in the morning, which is the shape of the thing
  // most people mean, and which deliberately crosses midnight so the wrap is
  // exercised the moment anybody switches it on.
  startMinute: 22 * 60,
  endMinute: 7 * 60,
  overrideSeverity: "extreme",
};

export interface WatchSettings {
  enabled: boolean;
  center: [number, number];
  radiusMiles: number;
  /** The least severe alert worth interrupting someone for. */
  minSeverity: AlertSeverity;
  /** Whether an announcement also makes a sound. */
  sound: boolean;
  quietHours?: QuietHours;
}

/** The reader's own clock, as minutes past their own midnight. */
export function localMinute(at: number | Date): number {
  const when = at instanceof Date ? at : new Date(at);
  return when.getHours() * 60 + when.getMinutes();
}

/**
 * Whether a moment falls inside the quiet window.
 *
 * A window that crosses midnight is the normal case rather than the awkward
 * one, so it is handled first: from ten at night until seven means everything
 * after the start or before the end, not everything between two numbers.
 */
export function inQuietHours(quiet: QuietHours, at: number | Date): boolean {
  if (!quiet.enabled) return false;
  const minute = localMinute(at);
  // A window with the same start and end silences nothing rather than
  // everything, which is the reading that cannot lock somebody out by accident.
  if (quiet.startMinute === quiet.endMinute) return false;
  if (quiet.startMinute < quiet.endMinute) {
    return minute >= quiet.startMinute && minute < quiet.endMinute;
  }
  return minute >= quiet.startMinute || minute < quiet.endMinute;
}

/**
 * Whether quiet hours hold this one back.
 *
 * Severity is what decides, not the reader's own minimum: somebody who has
 * asked to hear about moderate alerts still does not want one at four in the
 * morning, and still does want the tornado warning.
 */
export function silencedByQuietHours(
  watch: WatchSettings,
  severity: AlertSeverity,
  at: number | Date,
): boolean {
  const quiet = watch.quietHours;
  if (!quiet || !inQuietHours(quiet, at)) return false;
  return SEVERITY_RANK[severity] < SEVERITY_RANK[quiet.overrideSeverity];
}

/**
 * Why one alert was announced, kept so it can be answered afterwards.
 *
 * "Why did my computer just make a noise at me" is the question a watch has to
 * be able to answer, and the parts of the answer are all decided in one place
 * and then thrown away. Keeping them costs nothing and turns a mystery into a
 * sentence.
 */
export interface WatchReason {
  /** The kind of alert, which is the switch it belongs to in the panel. */
  event: string;
  severity: AlertSeverity;
  /** The threshold it had to clear to be worth mentioning. */
  minSeverity: AlertSeverity;
  radiusMiles: number;
  distanceMiles: number;
  /**
   * The damage threat it carried last time it was announced, when this one is
   * an upgrade rather than a first sighting. Null on a first sighting.
   */
  upgradedFrom: number | null;
}

export interface WatchAlert {
  id: string;
  /** How far up the damage scale this one is, for the record of what was said. */
  rank: number;
  headline: string;
  /** The damage threat the office attached, or empty for most warnings. */
  impact: string;
  severity: AlertSeverity;
  expires: number | null;
  distanceMiles: number;
  reason: WatchReason;
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
 * What one alert is, without the part that can change.
 *
 * The damage threat is deliberately not in here. It was, so that an upgrade
 * would announce a second time, and that is right in one direction and badly
 * wrong in the other: the tag comes from a feed that can rate-limit, and when
 * it does the tag disappears and the alert looks new again. Somebody who was
 * told the office called it destructive would then be woken a second time with
 * the plain wording, because a service somewhere returned 429.
 *
 * So the identity is the alert, and how far it has been escalated is tracked
 * separately below: an announcement happens when the alert is new, or when its
 * threat has gone up, and never when it has gone down.
 */
function alertId(
  properties: Record<string, unknown>,
  bounds: OverlayBounds,
): string {
  const url = String(properties.url ?? "");
  if (url) return url;
  const where = [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(3))
    .join(",");
  return `${String(properties.headline ?? "alert")}-${String(properties.issued ?? "")}-${where}`;
}

/** How far up the scale a warning has been taken, as a number to compare. */
export function impactRankOf(impact: unknown): number {
  const named = typeof impact === "string" ? impact : "";
  if (named === "catastrophic") return 3;
  if (named === "destructive") return 2;
  if (named === "considerable") return 1;
  return 0;
}

/**
 * Which alerts deserve to interrupt someone: severe enough, close enough, still
 * in force, and not already announced.
 */
export function alertsToAnnounce(
  alerts: OverlayData,
  watch: WatchSettings,
  /** What has been said already, and how bad it was when it was said. */
  announced: ReadonlyMap<string, number>,
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
    const rank = impactRankOf(feature.properties.impact);
    const told = announced.get(id);
    // Already mentioned, and no worse than it was. A threat that has gone
    // down is not news, and is usually the tag feed having a bad minute
    // rather than the office changing its mind.
    if (told !== undefined && rank <= told) continue;

    found.push({
      id,
      rank,
      headline: String(feature.properties.headline ?? translate("watch.alert")),
      impact: String(feature.properties.impact ?? ""),
      severity,
      expires: typeof expires === "number" ? expires : null,
      distanceMiles: distance,
      reason: {
        event: String(feature.properties.kind ?? "other"),
        severity,
        minSeverity: watch.minSeverity,
        radiusMiles: watch.radiusMiles,
        distanceMiles: distance,
        upgradedFrom: told ?? null,
      },
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

/**
 * The reason an alert was announced, as lines somebody can read.
 *
 * Written from the record rather than recomposed, so what this says and what
 * the watch actually decided cannot drift apart.
 */
export function watchReasonLines(reason: WatchReason): string[] {
  const lines = [
    translate("watch.whyEvent", {
      event: reason.event,
      severity: reason.severity,
    }),
    translate("watch.whyThreshold", { minSeverity: reason.minSeverity }),
    translate("watch.whyDistance", {
      miles: distanceValue(reason.distanceMiles),
      radius: distanceValue(reason.radiusMiles),
      unit: distanceUnit(),
    }),
  ];
  if (reason.upgradedFrom !== null) {
    // The one case where the same alert is mentioned twice, and the only
    // honest way to explain a second interruption about something already said.
    lines.push(translate("watch.whyUpgraded"));
  }
  return lines;
}

/**
 * A harmless alert, for somebody who wants to know what one looks like before
 * the weather decides to show them.
 *
 * It goes through the same delivery as a real one, because the thing worth
 * testing is the permission, the sound and the notification, not the wording.
 */
export function testWatchAlert(watch: WatchSettings): WatchAlert {
  return {
    id: `test-${Date.now()}`,
    rank: 0,
    headline: translate("watch.testHeadline"),
    impact: "",
    severity: watch.minSeverity,
    expires: null,
    distanceMiles: 0,
    reason: {
      event: "test",
      severity: watch.minSeverity,
      minSeverity: watch.minSeverity,
      radiusMiles: watch.radiusMiles,
      distanceMiles: 0,
      upgradedFrom: null,
    },
  };
}

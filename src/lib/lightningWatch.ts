import type { Flash, FlashWindow } from "../hooks/useLightning";
import { haversineMiles } from "./geo";
import { inQuietHours, type WatchPlace } from "./watch";

/**
 * Lightning near a place somebody watches, and the rule for saying so.
 *
 * A reader at a ballfield wants "flashes within ten miles in the last five
 * minutes", not a national picture. The flashes are already read for the map,
 * so this is arithmetic on what is in memory rather than a second question
 * asked of the same service.
 *
 * These are satellite-detected flashes, which is not the same thing as a
 * ground strike report: the instrument sees light above the cloud, counts one
 * flash where a network on the ground might count several strokes or none,
 * and is blind to nothing but says nothing about what reached the ground.
 * Every surface here carries that, because a reader who takes it for a strike
 * report is a reader making a decision on the wrong thing.
 */
export interface LightningRule {
  /** Off until asked for, like every other notice that is not a warning. */
  enabled: boolean;
  /** How near a flash has to be, in miles. */
  radiusMiles: number;
  /** How many flashes in the window are worth mentioning. */
  count: number;
  /** Whether it makes a sound. Off: a warning does that, and this is not one. */
  sound: boolean;
}

export const DEFAULT_LIGHTNING_RULE: LightningRule = {
  enabled: false,
  radiusMiles: 10,
  count: 1,
  sound: false,
};

/** The radii the panel offers, in miles. */
export const LIGHTNING_RADII = [5, 10, 15, 25] as const;
/** The counts it offers. */
export const LIGHTNING_COUNTS = [1, 3, 5, 10] as const;

/**
 * How long a place has to go without a flash before it is called quiet.
 *
 * The thirty-minute rule is the one lightning safety guidance everybody
 * agrees on, and it is the number a reader at a ballfield is actually acting
 * on: half an hour after the last flash, not half an hour after the storm
 * looks finished.
 */
export const QUIET_AFTER_MS = 30 * 60_000;

export interface PlaceLightning {
  placeId: string;
  placeName: string;
  /** False for a home nobody has renamed, which is not worth saying aloud. */
  named: boolean;
  /** Flashes inside the radius in the window the app is holding. */
  flashes: number;
  /** The newest of them, in milliseconds, or null when there were none. */
  newest: number | null;
  radiusMiles: number;
}

/** How many of a window's flashes fell within a radius of a point. */
export function flashesNear(
  flashes: readonly Flash[],
  place: { lon: number; lat: number },
  radiusMiles: number,
): Flash[] {
  return flashes.filter(
    (flash) =>
      haversineMiles(place, { lat: flash.latitude, lon: flash.longitude }) <=
      radiusMiles,
  );
}

/** What each watched place has had, one entry per place being watched. */
export function lightningNear(
  window: FlashWindow | null,
  places: readonly WatchPlace[],
  rule: LightningRule,
): PlaceLightning[] {
  if (!window) return [];
  const found: PlaceLightning[] = [];
  for (const place of places) {
    if (!place.enabled) continue;
    const near = flashesNear(
      window.flashes,
      { lon: place.center[0], lat: place.center[1] },
      rule.radiusMiles,
    );
    found.push({
      placeId: place.id,
      placeName: place.name,
      named: place.named !== false,
      flashes: near.length,
      // The flash times arrive in seconds, like everything else the radar
      // publishes, and every clock this is compared against is milliseconds.
      newest: near.length
        ? Math.max(...near.map((flash) => flash.time)) * 1000
        : null,
      radiusMiles: rule.radiusMiles,
    });
  }
  found.sort((left, right) => right.flashes - left.flashes);
  return found;
}

/** What a place was last told about its own lightning. */
export interface LightningSaid {
  /** True while the place has been told it is under lightning. */
  active: boolean;
  /** The newest flash it has heard about, in milliseconds. */
  newest: number | null;
}

export type LightningNotice =
  | { kind: "started"; place: PlaceLightning }
  | { kind: "quiet"; place: PlaceLightning };

/**
 * What to say about each place, given what it has already been told.
 *
 * Two things and no others: it started, and half an hour later it stopped.
 * Not one per flash, not one per poll, and not one every time the count goes
 * up: a reader at a ballfield needs to know to come in and then to know it is
 * over, and anything in between is the app talking about itself.
 */
export function lightningToAnnounce(
  near: readonly PlaceLightning[],
  rule: LightningRule,
  places: readonly WatchPlace[],
  said: ReadonlyMap<string, LightningSaid>,
  at: number = Date.now(),
): LightningNotice[] {
  if (!rule.enabled) return [];
  const byId = new Map(places.map((place) => [place.id, place]));
  const notices: LightningNotice[] = [];
  for (const place of near) {
    const held = said.get(place.placeId);
    const quiet = byId.get(place.placeId)?.quietHours;
    // A place's own quiet hours, with no severity to override: this is an
    // instrument counting flashes, not a forecaster judging a hazard.
    const silenced = quiet ? inQuietHours(quiet, at) : false;
    if (!held?.active) {
      if (place.flashes < rule.count || silenced) continue;
      notices.push({ kind: "started", place });
      continue;
    }
    // Already told. The only other thing worth saying is that it is over,
    // measured from the newest flash rather than from the last poll: a window
    // that goes empty because the satellite missed a file is not half an hour
    // of quiet.
    const last = place.newest ?? held.newest;
    if (last === null) continue;
    if (at - last < QUIET_AFTER_MS) continue;
    // The all-clear is said whatever the hour. Somebody who was told to come
    // in during quiet hours has to be told they can go back out.
    notices.push({ kind: "quiet", place });
  }
  return notices;
}

/** What each place has been told, after a round of notices. */
export function lightningAfter(
  near: readonly PlaceLightning[],
  said: ReadonlyMap<string, LightningSaid>,
  notices: readonly LightningNotice[],
): Map<string, LightningSaid> {
  const next = new Map(said);
  for (const place of near) {
    const held = next.get(place.placeId);
    const newest =
      place.newest !== null
        ? Math.max(place.newest, held?.newest ?? place.newest)
        : (held?.newest ?? null);
    next.set(place.placeId, { active: held?.active ?? false, newest });
  }
  for (const notice of notices) {
    const held = next.get(notice.place.placeId);
    next.set(notice.place.placeId, {
      active: notice.kind === "started",
      newest: held?.newest ?? notice.place.newest,
    });
  }
  // A place that is no longer being watched is forgotten, so switching one
  // back on does not announce a storm that ended an hour ago.
  const live = new Set(near.map((place) => place.placeId));
  for (const id of next.keys()) {
    if (!live.has(id)) next.delete(id);
  }
  return next;
}

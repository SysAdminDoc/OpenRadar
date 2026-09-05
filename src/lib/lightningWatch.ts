import type { Flash, FlashWindow } from "../hooks/useLightning";
import { bearingDegrees, haversineMiles } from "./geo";
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

/**
 * How recent a flash has to be for a place to be called active.
 *
 * The Hazardous Weather Testbed's lightning stoplight colours by time since
 * the last strike rather than by a probability, and the guidance that came
 * out of it is that nobody is told an area is clear while a strike is fresh.
 * Ten minutes is the first step; the second is the thirty minutes the
 * all-clear already uses, so the chip and the notice cannot disagree.
 */
export const LIGHTNING_FRESH_MS = 10 * 60_000;

/** Where a place stands, from elapsed time and nothing else. */
export type LightningStep = "fresh" | "recent" | "clear";

/**
 * Which step a place is on, given when it last saw a flash and when the feed
 * was last read.
 *
 * Elapsed time decides the first two steps. A probability that has come down,
 * a window that went empty because a file was missed, and a storm that looks
 * finished are all reasons a place can look quiet while a strike six miles out
 * is ten minutes old, and the testbed's forecasters were told never to message
 * an all-clear from any of them.
 *
 * The last step needs one thing more: half an hour of quiet somebody actually
 * watched. A satellite feed that stopped being polled looks exactly like a sky
 * that stopped flashing, and the difference is the whole point of the step, so
 * "clear" is only reached when the feed has been read at least that long after
 * the flash. Until then a place that has gone quiet sits on "recent" with the
 * true age beside it, which is a fact rather than an all-clear.
 *
 * Null for a place that has seen no flash at all: nothing has happened, which
 * is a different statement from something that has stopped.
 */
export function lightningStep(
  newest: number | null,
  at: number = Date.now(),
  checkedAt: number | null = null,
): LightningStep | null {
  if (newest === null) return null;
  // A flash stamped after the clock is a clock disagreeing with a satellite
  // rather than a flash in the future, and a negative age reads as fresh
  // here, which is the side to be wrong on.
  const since = at - newest;
  if (since < LIGHTNING_FRESH_MS) return "fresh";
  if (since < QUIET_AFTER_MS) return "recent";
  return checkedAt !== null && checkedAt - newest >= QUIET_AFTER_MS
    ? "clear"
    : "recent";
}

export interface PlaceLightning {
  placeId: string;
  placeName: string;
  /** False for a home nobody has renamed, which is not worth saying aloud. */
  named: boolean;
  /** Flashes inside the radius in the window the app is holding. */
  flashes: number;
  /** The newest of them, in milliseconds, or null when there were none. */
  newest: number | null;
  /** How far the nearest of them lay, in miles, or null when there were none. */
  nearestMiles: number | null;
  /** Which way that one lay from the place, in degrees from north. */
  nearestBearing: number | null;
  /**
   * When the feed this came from was last read, in milliseconds.
   *
   * Not the same question as when the last flash was. A window nobody has
   * polled for half an hour holds the same flashes it held half an hour ago,
   * and without this the app would read that as half an hour of quiet sky.
   */
  checkedAt: number | null;
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

/**
 * What each watched place has had, one entry per place being watched.
 *
 * A place answers even with no window at all, with nothing counted and no
 * moment when the feed was read. That is a different answer from an empty
 * window, and the difference matters twice: `lightningStep` will not call a
 * place clear without a read behind it, and `rememberLightning` needs the
 * place to still be in the list or it drops what it was holding. A poll that
 * failed must not read as a place that has never seen a flash.
 */
export function lightningNear(
  window: FlashWindow | null,
  places: readonly WatchPlace[],
  rule: LightningRule,
): PlaceLightning[] {
  const found: PlaceLightning[] = [];
  for (const place of places) {
    if (!place.enabled) continue;
    const centre = { lon: place.center[0], lat: place.center[1] };
    const near = window
      ? flashesNear(window.flashes, centre, rule.radiusMiles)
      : [];
    // The nearest one, which is the distance a reader at a ballfield is
    // acting on. Not the newest: the one that decides whether to come in is
    // the closest the storm has come, and the two are rarely the same flash.
    let nearest: { miles: number; bearing: number } | null = null;
    for (const flash of near) {
      const at = { lat: flash.latitude, lon: flash.longitude };
      const miles = haversineMiles(centre, at);
      if (nearest === null || miles < nearest.miles) {
        nearest = { miles, bearing: bearingDegrees(centre, at) };
      }
    }
    found.push({
      placeId: place.id,
      placeName: place.name,
      named: place.named !== false,
      flashes: near.length,
      nearestMiles: nearest?.miles ?? null,
      nearestBearing: nearest?.bearing ?? null,
      // The window's own observation time, which is when this answer was
      // last checked against the sky rather than when it was last read out
      // of memory. Null when there is no window: nothing was read, which is
      // exactly what stops a place being called clear.
      checkedAt: window ? window.observed * 1000 : null,
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

/**
 * What each place has had, remembered past the window that showed it.
 *
 * The feed holds five minutes of flashes. Read from it alone, the age of the
 * last flash near a place could never pass about six minutes: the flash falls
 * out of the window and the place goes back to having seen nothing, which is
 * the one thing that must not be said after a strike. So the last reading is
 * kept, and only a window with a flash in it replaces one.
 *
 * The count is not carried. That is the current window's answer and it is what
 * decides whether to say anything at all, so a place that has gone quiet keeps
 * the age of its last flash and a count of none.
 */
export function lightningRemembered(
  near: readonly PlaceLightning[],
  held: ReadonlyMap<string, PlaceLightning>,
): PlaceLightning[] {
  return near.map((place) => {
    if (place.newest !== null) return place;
    const kept = held.get(place.placeId);
    if (!kept || kept.newest === null) return place;
    return {
      ...place,
      newest: kept.newest,
      nearestMiles: kept.nearestMiles,
      nearestBearing: kept.nearestBearing,
    };
  });
}

/**
 * The last reading each place had, held past the windows that lose it.
 *
 * Module state rather than a hook's, because React allows neither of the two
 * shapes this would otherwise take: a ref cannot be written while rendering,
 * and setting state inside an effect is a cascading render the linter refuses.
 * It is one map for one running app, the same way the unit and the clock zone
 * are held in `units.ts`, and it is only ever a cache: everything it holds
 * came out of a real window, and losing it costs the age of the last flash and
 * nothing else.
 *
 * Folding is idempotent, which is what makes it safe to do while rendering: a
 * second pass over the same window merges the same reading into a store that
 * already holds it and produces the same answer.
 */
const remembered = new Map<string, PlaceLightning>();

/** What each place has had, with what it had before folded in. */
export function rememberLightning(
  near: readonly PlaceLightning[],
): PlaceLightning[] {
  const merged = lightningRemembered(near, remembered);
  // Rebuilt rather than updated, so a place that has stopped being watched is
  // dropped: switching one back on should not show it an age from an hour ago.
  remembered.clear();
  for (const place of merged) {
    if (place.newest !== null) remembered.set(place.placeId, place);
  }
  return merged;
}

/** Forgets every place, for a test that needs an app that has seen nothing. */
export function forgetLightning(): void {
  remembered.clear();
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

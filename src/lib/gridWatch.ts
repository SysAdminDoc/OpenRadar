import { inQuietHours, type WatchPlace } from "./watch";
import { QUIET_AFTER_MS } from "./lightningWatch";
import type { MrmsProductId } from "./providers/mrms";

/**
 * A rule set on a number the network publishes, near a place somebody watches.
 *
 * The watch answers warnings, which are a forecaster's judgement about a
 * county. This answers a measurement about a ballfield: the largest hail the
 * network estimated within ten miles of it, or the strongest rotation it
 * merged there. Neither is a warning and every surface here says so.
 *
 * Both of these are estimates rather than reports. Hail size is worked out
 * from the energy in the column, not from anybody standing under it, and it
 * runs high on a warm day and low on a cold one. Rotation is shear the
 * network merged from the radars that could see the storm, which is not a
 * tornado and not a claim that one is on the ground. A reader who takes
 * either for a report is a reader deciding on the wrong thing.
 */

/** The two grids a rule can be set on. */
export type GridRuleId = "hail" | "rotation";

export interface GridRule {
  /** Off until asked for, like every other notice that is not a warning. */
  enabled: boolean;
  /** How near the reading has to be, in miles. */
  radiusMiles: number;
  /**
   * The reading worth saying something about, in the grid's own unit.
   *
   * Inches for hail, because that is what a warning and a spotter both use.
   * Thousandths of a second for rotation, which is the unit the merged shear
   * grid is published in and the one the weather service's own training
   * talks in.
   */
  threshold: number;
  /** Whether it makes a sound. Off: a warning does that, and this is not one. */
  sound: boolean;
}

export const DEFAULT_HAIL_RULE: GridRule = {
  enabled: false,
  radiusMiles: 10,
  // An inch is the size a severe thunderstorm warning is issued at, so it is
  // the size a reader already has a plan for.
  threshold: 1,
  sound: false,
};

export const DEFAULT_ROTATION_RULE: GridRule = {
  enabled: false,
  radiusMiles: 10,
  // Ten thousandths of a second through the low slab is where the weather
  // service's own training says a mesocyclone is worth looking at.
  threshold: 10,
  sound: false,
};

/** The radii the panel offers, in miles, the same four the lightning rule has. */
export const GRID_RADII = [5, 10, 15, 25] as const;

/** The hail sizes it offers, in inches, and what each one is usually called. */
export const HAIL_SIZES = [0.75, 1, 1.75, 2.5] as const;

/** The rotation thresholds it offers, in thousandths of a second. */
export const ROTATION_LEVELS = [5, 10, 15, 20] as const;

/**
 * The grid each rule reads, and the unit it comes back in.
 *
 * The hail grid is published in millimetres and the rule is written in
 * inches, because a reader setting "over an inch" is thinking in the units a
 * warning is worded in. The shear grid is published in inverse seconds and
 * the rule is in thousandths, for the same reason: 0.01 is what the network
 * writes and "ten" is what a forecaster says.
 */
export const GRID_RULE_SOURCES: Record<
  GridRuleId,
  { product: MrmsProductId; fromGrid: (value: number) => number }
> = {
  hail: { product: "mesh", fromGrid: (mm) => mm / 25.4 },
  rotation: {
    product: "az-shear-low",
    fromGrid: (perSecond) => perSecond * 1000,
  },
};

/** What the newest grid says near one place. */
export interface PlaceReading {
  placeId: string;
  place: string;
  named: boolean;
  /** The reading, in the rule's own unit, or null where nothing was measured. */
  value: number | null;
  /** How far off it was, in miles. */
  miles: number | null;
  /** When the grid was published, in milliseconds. */
  observed: number | null;
}

/** What a place has already been told, so it is not told twice. */
export interface GridSaid {
  /** True while the place has been told the reading is over its threshold. */
  active: boolean;
  /** The last moment it was over, in milliseconds. */
  over: number | null;
}

export type GridNotice =
  | { kind: "over"; rule: GridRuleId; reading: PlaceReading }
  | { kind: "quiet"; rule: GridRuleId; reading: PlaceReading };

/**
 * Which places to say something about, and which to call quiet again.
 *
 * The same shape the lightning rule uses, and deliberately: a reader who has
 * learned that "it tells me when it starts and again when it has been half an
 * hour" should not have to learn a second behaviour for a second rule. A
 * place is told once when the reading first meets the threshold, and again
 * only after the grid has been under it for half an hour.
 */
export function gridToAnnounce(
  rule: GridRuleId,
  settings: GridRule,
  readings: readonly PlaceReading[],
  places: readonly WatchPlace[],
  said: ReadonlyMap<string, GridSaid>,
  at: number = Date.now(),
): GridNotice[] {
  if (!settings.enabled) return [];
  const byId = new Map(places.map((place) => [place.id, place]));
  const notices: GridNotice[] = [];
  for (const reading of readings) {
    const held = said.get(reading.placeId);
    const quiet = byId.get(reading.placeId)?.quietHours;
    // A place's own quiet hours, with no severity to override: this is the
    // network's own arithmetic on a grid, not a forecaster judging a hazard.
    const silenced = quiet ? inQuietHours(quiet, at) : false;
    // No coverage is not a reading under the threshold. A circle the network
    // could not see into says nothing either way, and neither starting nor
    // ending on it would be honest.
    const over = reading.value !== null && reading.value >= settings.threshold;
    if (!held?.active) {
      if (!over || silenced) continue;
      notices.push({ kind: "over", rule, reading });
      continue;
    }
    if (over) continue;
    // Nothing measured is not a reading under the threshold. Ending on it
    // would tell somebody at a ballfield the hail had stopped because the
    // radar went down, which is the one thing this rule must never say.
    if (reading.value === null) continue;
    const last = held.over;
    if (last === null) continue;
    if (at - last < QUIET_AFTER_MS) continue;
    // The all-clear ignores quiet hours on purpose: somebody told to come in
    // during them has to be told they can go back out.
    notices.push({ kind: "quiet", rule, reading });
  }
  return notices;
}

/**
 * What each place has been told, after a pass.
 *
 * Places no longer watched are dropped, so a place removed and added again
 * starts fresh rather than inheriting a state nobody can see.
 */
export function gridAfter(
  settings: GridRule,
  readings: readonly PlaceReading[],
  said: ReadonlyMap<string, GridSaid>,
  notices: readonly GridNotice[],
  at: number = Date.now(),
): Map<string, GridSaid> {
  const next = new Map<string, GridSaid>();
  const told = new Map(
    notices.map((notice) => [notice.reading.placeId, notice]),
  );
  for (const reading of readings) {
    const held = said.get(reading.placeId);
    const notice = told.get(reading.placeId);
    const over = reading.value !== null && reading.value >= settings.threshold;
    const active =
      notice?.kind === "over"
        ? true
        : notice?.kind === "quiet"
          ? false
          : (held?.active ?? false);
    next.set(reading.placeId, {
      active,
      // The moment it was last over, which is what the half hour is counted
      // from. Held through a pass where the reading is under, because that
      // is the whole point of counting it.
      over: over ? at : (held?.over ?? null),
    });
  }
  return next;
}

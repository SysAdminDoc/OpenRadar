import type { CellReport } from "./cells";
import { soonestArrival } from "./cells";
import { inQuietHours, type WatchPlace } from "./watch";

/**
 * A storm the radar's own tracker says is heading for a place somebody
 * watches, and how long it has.
 *
 * Deliberately not a warning. A warning is a forecaster's judgement about a
 * hazard; this is arithmetic on a centroid and a motion vector, and it is
 * wrong often enough that saying so is part of saying it at all. Everything
 * here is worded and gated on that difference: it is off until asked for, it
 * makes no sound unless asked, it stands down in quiet hours whatever the
 * threshold, and it never uses the words a warning uses.
 */
export interface Approach {
  placeId: string;
  placeName: string;
  /** False for a home nobody has renamed, which is not worth saying aloud. */
  named: boolean;
  /** The tracker's own identifier for the storm, never a name a reader gave. */
  cellId: string;
  /** Minutes until it reaches the place, from now rather than from the scan. */
  minutes: number;
}

export interface ApproachSettings {
  /**
   * Off until somebody asks. A radar estimate that interrupts a reader who
   * did not ask for it is the failure this whole feature is one press away
   * from.
   */
  enabled: boolean;
  /** How close it has to get, in minutes, before it is worth saying. */
  minutes: number;
  /** Whether it makes a sound. Off: a warning does that, and this is not one. */
  sound: boolean;
}

export const DEFAULT_APPROACH: ApproachSettings = {
  enabled: false,
  minutes: 20,
  sound: false,
};

/** The windows the panel offers, in minutes. */
export const APPROACH_MINUTES = [10, 20, 30, 45, 60] as const;

/**
 * The soonest storm heading for each watched place, one entry per place.
 *
 * Only places with something actually coming appear, so an empty answer means
 * nothing is on its way rather than that nothing was looked at.
 */
export function approachesFor(
  report: CellReport | null,
  places: readonly WatchPlace[],
  clock: number = Date.now(),
): Approach[] {
  if (!report) return [];
  const found: Approach[] = [];
  for (const place of places) {
    if (!place.enabled) continue;
    const soonest = soonestArrival(
      report,
      { lon: place.center[0], lat: place.center[1] },
      clock,
    );
    if (!soonest) continue;
    found.push({
      placeId: place.id,
      placeName: place.name,
      named: place.named !== false,
      cellId: soonest.cell.id,
      minutes: soonest.minutes,
    });
  }
  // Soonest first, which is the order somebody reads a list like this in.
  found.sort((left, right) => left.minutes - right.minutes);
  return found;
}

/**
 * One place and one storm, which is what "said once" is counted against.
 *
 * Per pair rather than per storm: the same cell crossing two watched places is
 * two different pieces of news. Per storm rather than per place: a cell that
 * has been announced and then slows down must not be announced again when it
 * dips back under the threshold, and the tracker reuses an identifier only
 * while it is following the same storm.
 */
export function approachKey(approach: Approach): string {
  return `${approach.placeId}:${approach.cellId}`;
}

/**
 * Which approaches are worth saying now, and which have already been said.
 *
 * The threshold is a first crossing, not a state: a storm sitting at eighteen
 * minutes for half an hour is one piece of news, not fifteen. Quiet hours
 * silence it outright rather than by severity, because there is no severity
 * here to override with. Everything it decides to say goes into `told`, so a
 * caller that keeps that between polls says each one once.
 */
export function approachesToAnnounce(
  approaches: readonly Approach[],
  settings: ApproachSettings,
  places: readonly WatchPlace[],
  told: ReadonlySet<string>,
  at: number | Date = Date.now(),
): Approach[] {
  if (!settings.enabled) return [];
  const byId = new Map(places.map((place) => [place.id, place]));
  return approaches.filter((approach) => {
    if (approach.minutes > settings.minutes) return false;
    if (told.has(approachKey(approach))) return false;
    const place = byId.get(approach.placeId);
    // A place's own quiet hours, because the reader set them per place and a
    // storm estimate is exactly the kind of thing they set them for. No
    // severity override: this is not severe, it is arithmetic.
    const quiet = place?.quietHours;
    if (quiet && inQuietHours(quiet, at)) return false;
    return true;
  });
}

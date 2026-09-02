import { locale } from "../i18n";
import type { GeoPoint } from "./geo";
import { haversineMiles } from "./geo";

/**
 * A small set of places where the weather made history, found by going there.
 *
 * The idea is borrowed from an app that hid fictional places for people to
 * hunt; this version is the opposite of fictional. Every one of these is a
 * real measurement or a real event at a real coordinate, with the office or
 * observatory that published it named and linked, and the whole set ships in
 * the app so it works with networking off.
 *
 * Four rules, and they are the difference between this and a collectible:
 *
 * - It is found by exploring, not by being told. Nothing points at one, no
 *   marker sits on the map waiting to be clicked, and the only way to reach
 *   one is to have gone and looked at that part of the world closely.
 * - Finding one is quiet. A card, once, with the story and the citation. No
 *   toast, no sound, nothing that interrupts.
 * - Nothing is counted. There is no total, no progress, no badge and no
 *   score, so there is nothing to complete and nothing to feel behind on.
 *   The found list is a list of what you found, and that is all it is.
 * - No casualty figures and no reaching. These are places, and what happened
 *   at them is stated plainly; a record that was actually measured is a fact
 *   worth stating, and a body count is not a curiosity.
 */
/**
 * One piece of copy in each language the workspace is written in.
 *
 * The stories are prose a person reads, so they are translated like every
 * other sentence in the app rather than left in English in a data file. The
 * source's name is not: an office is called what it is called.
 */
export type Told = Record<"en" | "es" | "fr", string>;

export interface Curiosity {
  id: string;
  /** The place's own name, in each language. */
  title: Told;
  /** What happened there, in a few sentences, in each language. */
  story: Told;
  /** Who says so, by name. */
  source: string;
  /**
   * Where to read it.
   *
   * A deep link where the office published a page about that event, and the
   * office's own front door where it did not. Either way the story names who
   * is speaking, so a reader can check it; an entry with neither a source nor
   * a link is dropped rather than shown unattributed.
   */
  url: string;
  place: { lon: number; lat: number };
}

/** The file that ships with the app. Same-origin, so it works offline. */
export const CURIOSITY_URL = "curiosities.json";

/**
 * How near the middle of the view has to be, in miles.
 *
 * Close enough that it means somebody went looking at that place, and wide
 * enough that they do not have to land on a coordinate.
 */
export const FIND_MILES = 30;

/**
 * How far in the map has to be zoomed before anything can be found.
 *
 * A reader looking at a whole continent has not explored to anywhere. This is
 * roughly a county across a desktop window.
 */
export const FIND_ZOOM = 7;

function told(value: unknown): value is Told {
  if (!value || typeof value !== "object") return false;
  const one = value as Partial<Told>;
  // Every language, or none: a card that falls back to English for one reader
  // and not another is worse than one that is not there.
  return (["en", "es", "fr"] as const).every(
    (which) => typeof one[which] === "string" && one[which].length > 0,
  );
}

function isCuriosity(value: unknown): value is Curiosity {
  if (!value || typeof value !== "object") return false;
  const one = value as Partial<Curiosity>;
  return (
    typeof one.id === "string" &&
    one.id.length > 0 &&
    told(one.title) &&
    told(one.story) &&
    // A story with nobody behind it is a story this app has no business
    // telling. An uncited entry is dropped rather than shown unattributed.
    typeof one.source === "string" &&
    one.source.length > 0 &&
    typeof one.url === "string" &&
    /^https:\/\//.test(one.url) &&
    typeof one.place === "object" &&
    one.place !== null &&
    Number.isFinite(one.place.lon) &&
    Number.isFinite(one.place.lat)
  );
}

/** The set as the file holds it, with anything incomplete left out. */
export function readCuriosities(value: unknown): Curiosity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Curiosity[] = [];
  for (const entry of value) {
    if (!isCuriosity(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** A curiosity's own words, in the language the workspace is written in. */
export function inWords(told: Told): string {
  const which = locale();
  if (which.startsWith("es")) return told.es;
  if (which.startsWith("fr")) return told.fr;
  return told.en;
}

/**
 * Whichever curiosity the reader has just explored to, or null.
 *
 * Nearest first, so standing between two answers with the one actually being
 * looked at. Anything already found is not found again: this is a card shown
 * once, not a place that keeps announcing itself every time the map passes
 * over it.
 *
 * The whole cost of this is a distance for each entry in a list of a dozen,
 * and it is asked only when the camera has come to rest, so panning across a
 * continent costs nothing at all.
 */
export function foundAt(
  curiosities: readonly Curiosity[],
  camera: { center: [number, number]; zoom: number },
  already: readonly string[],
): Curiosity | null {
  if (!(camera.zoom >= FIND_ZOOM)) return null;
  const middle: GeoPoint = { lon: camera.center[0], lat: camera.center[1] };
  const found = new Set(already);

  let best: Curiosity | null = null;
  let away = Number.POSITIVE_INFINITY;
  for (const one of curiosities) {
    if (found.has(one.id)) continue;
    const miles = haversineMiles(middle, one.place);
    if (miles > FIND_MILES) continue;
    if (miles < away) {
      away = miles;
      best = one;
    }
  }
  return best;
}

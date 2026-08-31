import { isDesktopRuntime } from "./settings";

/**
 * What a machine thinks each storm is about to do.
 *
 * ProbSevere is the National Severe Storms Laboratory's model for how likely a
 * storm is to turn severe in the next hour. It reads the radar, the satellite,
 * the lightning and the environment around each cell and gives back four
 * percentages: severe weather of any kind, and then hail, wind and a tornado.
 *
 * It is a model rather than an observation, and the layer says so. A high
 * number is not a warning and a low one is not a promise.
 */

export interface StormObject {
  id: string;
  rings: Array<Array<[number, number]>>;
  severe: number;
  hail: number;
  wind: number;
  tornado: number;
  /** The measurements behind it, named as the file names them. */
  attributes: Array<[string, string]>;
}

export interface ProbSevereReading {
  observed: string;
  storms: StormObject[];
}

/** Read natively, so a browser preview has none of it. */
export function probSevereAvailable(): boolean {
  return isDesktopRuntime();
}

export async function fetchProbSevere(): Promise<ProbSevereReading> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProbSevereReading>("probsevere_reading");
}

/** Published about every two minutes, so this is roughly one reading behind. */
export const PROBSEVERE_REFRESH_MS = 2 * 60_000;

/**
 * Below this the model is saying it does not expect anything, and drawing
 * every cell in the country would bury the ones it does.
 */
export const PROBSEVERE_FLOOR = 10;

/**
 * When the reading was taken, from the stamp the file carries.
 *
 * It is written `20260830_230841 UTC`, which no date parser reads on its own.
 *
 * `Date.UTC` rolls impossible parts over rather than refusing them: month 99
 * becomes a date eight years out and minute 61 becomes the next hour. A stamp
 * that cannot be read has to come back as nothing, or the layer draws whatever
 * the rollover landed on and calls it current.
 */
export function readingTime(observed: string): number | null {
  const found = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(observed);
  if (!found) return null;
  const [, year, month, day, hour, minute, second] = found.map(Number);
  // A time part that rolls over stays on the same day, so reading the date
  // back cannot see it.
  if (hour > 23 || minute > 59 || second > 60) return null;
  const at = Date.UTC(year, month - 1, day, hour, minute, second);
  // Everything else the rollover moves shows up in the date that comes back:
  // month 99 lands eight years out, and the thirty-first of April lands in
  // May.
  const back = new Date(at);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return at;
}

/**
 * How far ahead of this machine's clock a reading may be stamped, in minutes.
 *
 * Clock skew of a minute or two is ordinary. A stamp days ahead is a mistake
 * somewhere, and drawing it as current would be drawing storms that have not
 * happened.
 */
export const AHEAD_MINUTES = 5;

/** Whether a reading is close enough to now to be worth drawing. */
export function isCurrentReading(
  observed: string,
  now: number,
  staleMinutes: number,
): boolean {
  const at = readingTime(observed);
  if (at === null) return false;
  const age = (now - at) / 60_000;
  return age >= -AHEAD_MINUTES && age <= staleMinutes;
}

/** The storms worth drawing, as the map takes them. */
export function probSevereFeatures(
  reading: ProbSevereReading,
  floor = PROBSEVERE_FLOOR,
): Record<string, unknown> {
  const features = reading.storms
    .filter((storm) => storm.severe >= floor)
    .map((storm) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: storm.rings },
      properties: {
        id: storm.id,
        severe: storm.severe,
        hail: storm.hail,
        wind: storm.wind,
        tornado: storm.tornado,
        // Flattened, because a popup reads a list and MapLibre carries only
        // flat values on a feature.
        detail: storm.attributes
          .map(([name, value]) => `${name} ${value}`)
          .join(" · "),
      },
    }));
  return { type: "FeatureCollection", features };
}

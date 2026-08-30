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
 */
export function readingTime(observed: string): number | null {
  const found = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(observed);
  if (!found) return null;
  const [, year, month, day, hour, minute, second] = found;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
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

import { translate } from "../i18n";
import type { AppSettings } from "./settings";

/**
 * A calmer way to read the same weather.
 *
 * A lot of people follow weather closely because it frightens them, and this
 * app is otherwise tuned for the reader who wants more detail rather than
 * less. Calm is for the other one. It is a presentation, not a filter, and the
 * line between those is the whole feature:
 *
 * - **It never hides, downgrades or delays a warning.** The same alerts arrive
 *   at the same moment through the same path, drawn in the same colours the
 *   office publishes, and the panel says so where the mode is switched on. A
 *   mode that quietened a tornado warning would be the most dangerous thing
 *   this app could ship.
 * - **It mutes the app, not the weather.** What goes quiet is the chrome:
 *   pulsing, accents, the seasonal decoration, the effects. The reflectivity
 *   ramp, the warning outline, the severity word and every figure stay exactly
 *   as they are.
 * - **Speculative guidance is put away, not deleted.** Probability layers are
 *   off by default in this mode and one press from being back, and turning
 *   the mode off puts them exactly as they were.
 * - **The words change.** An alert says what to do rather than how bad it
 *   could be, written by hand in each language.
 */

/**
 * Layers that speculate rather than report, put away while calm is on.
 *
 * Restored to whatever they were when the mode is turned off, because they
 * are the reader's own settings and a mode borrowing them has to give them
 * back.
 */
export const SPECULATIVE_LAYERS = ["probSevere", "stormCells"] as const;

/**
 * The settings with the speculative layers put away, and a note of what they
 * were.
 *
 * Borrowed rather than changed. The note is what makes it a mode instead of
 * an edit: without it, a reader who switched calm on and off again lost the
 * probability layer for good, which is the opposite of "leaving the mode
 * restores everything".
 */
export function putSpeculationAway(settings: AppSettings): AppSettings {
  const borrowed: Record<string, boolean> = {};
  const layers = { ...settings.layers };
  for (const layer of SPECULATIVE_LAYERS) {
    borrowed[layer] = layers[layer];
    layers[layer] = false;
  }
  return { ...settings, calm: true, layers, calmBorrowed: borrowed };
}

/** The settings with the speculative layers exactly as they were. */
export function giveSpeculationBack(settings: AppSettings): AppSettings {
  const layers = { ...settings.layers };
  for (const layer of SPECULATIVE_LAYERS) {
    const was = settings.calmBorrowed[layer];
    if (typeof was === "boolean") layers[layer] = was;
  }
  return { ...settings, calm: false, layers, calmBorrowed: {} };
}

/**
 * What to do about a warning, from the office's own name for the product.
 *
 * Keyed on the product rather than on the app's own hazard grouping, and this
 * is not a detail. The grouping is deliberately coarse: `alertType` puts a
 * tsunami warning, an evacuation order and a hazardous materials warning in
 * the same bucket as a tornado, because all four mean move now and none of
 * them should sit behind a switch nobody would think to look under. Advice
 * written for that bucket told a tsunami warning to go to the lowest floor,
 * which is the opposite of what saves somebody, and told an evacuation order
 * to shelter in place.
 *
 * So: an exact hazard gets its own words, and anything this does not
 * recognise gets a line that sends the reader to the office's own
 * instruction. A general line is not the best answer; wrong advice is very
 * much the worst one.
 */
export function calmAdvice(headline: string): string {
  const name = headline.toLowerCase();

  // Move away and upward. Nothing about these is a sheltering hazard.
  if (name.includes("tsunami")) return translate("calm.advice.tsunami");
  if (name.includes("evacuation")) return translate("calm.advice.evacuate");
  if (
    name.includes("hazardous materials") ||
    name.includes("radiological") ||
    name.includes("nuclear") ||
    name.includes("shelter in place")
  ) {
    return translate("calm.advice.shelterInPlace");
  }
  if (name.includes("civil danger")) return translate("calm.advice.civil");

  // Get low and inside, away from windows.
  if (name.includes("tornado") || name.includes("extreme wind")) {
    return translate("calm.advice.tornado");
  }

  if (name.includes("rip current") || name.includes("high surf")) {
    return translate("calm.advice.surf");
  }
  if (name.includes("flood") || name.includes("dam break")) {
    return translate("calm.advice.flood");
  }
  if (
    name.includes("hurricane") ||
    name.includes("typhoon") ||
    name.includes("tropical") ||
    name.includes("storm surge")
  ) {
    return translate("calm.advice.tropical");
  }
  if (name.includes("thunderstorm") || name.includes("lightning")) {
    return translate("calm.advice.thunderstorm");
  }
  if (
    name.includes("winter") ||
    name.includes("snow") ||
    name.includes("ice") ||
    name.includes("blizzard") ||
    name.includes("cold")
  ) {
    return translate("calm.advice.winter");
  }
  if (name.includes("heat")) return translate("calm.advice.heat");
  if (name.includes("fire") || name.includes("smoke")) {
    return translate("calm.advice.fire");
  }

  return translate("calm.advice.general");
}

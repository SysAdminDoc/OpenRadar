import { translate } from "../i18n";
import type { AlertType } from "./alertTypes";

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
 *   ramp, the warning outline and every figure stay exactly as they are.
 * - **Speculative guidance is put away, not deleted.** Probability layers are
 *   off by default in this mode and one press from being back, because a
 *   forecast probability is the part that keeps somebody awake and it is also
 *   the part they may want to check.
 * - **The words change.** An alert says what to do rather than how bad it
 *   could be, written by hand in each language rather than generated.
 */

/** Layers that speculate rather than report. Off in this mode by default. */
export const SPECULATIVE_LAYERS = ["probSevere", "stormCells"] as const;

/**
 * What to do about a kind of warning, in the reader's own language.
 *
 * The plainest thing that is true. Written by hand for each kind: a sentence
 * assembled from parts reads like an app talking, and this is the one place
 * where the wording is the point.
 *
 * A kind with nothing written for it falls back to the general line rather
 * than to the office's own headline, which is where the how-bad-it-could-be
 * wording lives.
 */
export function calmAdvice(kind: AlertType | string): string {
  switch (kind) {
    case "tornado":
      return translate("calm.advice.tornado");
    case "thunderstorm":
      return translate("calm.advice.thunderstorm");
    case "flood":
      return translate("calm.advice.flood");
    case "winter":
      return translate("calm.advice.winter");
    case "tropical":
      return translate("calm.advice.tropical");
    case "heat":
      return translate("calm.advice.heat");
    case "fire":
      return translate("calm.advice.fire");
    default:
      return translate("calm.advice.general");
  }
}

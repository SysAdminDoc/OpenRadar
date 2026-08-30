import type { StringKey } from "../i18n";

/**
 * The kinds of alert a reader can switch off.
 *
 * The service publishes over a hundred product names, and listing them all
 * would be a wall of switches nobody reads. These are the groups people
 * actually think in: the ones that mean take cover, the ones about water, the
 * ones about winter, and the rest. A product that matches nothing falls in
 * "other", so a new product type appears rather than vanishing.
 */
export type AlertType =
  | "tornado"
  | "thunderstorm"
  | "flood"
  | "winter"
  | "tropical"
  | "fire"
  | "heat"
  | "other";

export const ALERT_TYPES: Array<{ id: AlertType; key: StringKey }> = [
  { id: "tornado", key: "alertType.tornado" },
  { id: "thunderstorm", key: "alertType.thunderstorm" },
  { id: "flood", key: "alertType.flood" },
  { id: "winter", key: "alertType.winter" },
  { id: "tropical", key: "alertType.tropical" },
  { id: "fire", key: "alertType.fire" },
  { id: "heat", key: "alertType.heat" },
  { id: "other", key: "alertType.other" },
];

/**
 * Which group a product name belongs to.
 *
 * Order matters: a flash flood emergency is water rather than a thunderstorm,
 * and a tropical storm warning is tropical rather than wind, so the more
 * specific words are looked for first.
 */
export function alertType(prodType: string): AlertType {
  const name = prodType.toLowerCase();

  // Highest first, and by hazard rather than by wording. A product that can
  // kill somebody in the next ten minutes must not sit behind a switch nobody
  // would think to look under: a tsunami is not a flood to anybody deciding
  // whether to leave, and the eyewall wind of a hurricane is not a
  // thunderstorm.
  if (
    name.includes("tornado") ||
    name.includes("tsunami") ||
    name.includes("extreme wind") ||
    name.includes("civil danger") ||
    name.includes("evacuation") ||
    name.includes("shelter in place") ||
    name.includes("radiological") ||
    name.includes("hazardous materials") ||
    name.includes("nuclear")
  ) {
    return "tornado";
  }

  if (
    name.includes("hurricane") ||
    name.includes("tropical") ||
    name.includes("storm surge") ||
    name.includes("typhoon")
  ) {
    return "tropical";
  }

  if (
    name.includes("flood") ||
    name.includes("seiche") ||
    name.includes("dam break") ||
    name.includes("high surf") ||
    name.includes("rip current") ||
    name.includes("coastal flood") ||
    name.includes("lakeshore flood")
  ) {
    return "flood";
  }

  if (
    name.includes("winter") ||
    name.includes("snow") ||
    name.includes("blizzard") ||
    name.includes("ice storm") ||
    name.includes("sleet") ||
    // "freezing" rather than "freeze", or Freezing Rain and Freezing Fog fall
    // through to the bottom of the list. Both are the reason people crash.
    name.includes("freez") ||
    name.includes("frost") ||
    name.includes("wind chill") ||
    name.includes("cold") ||
    name.includes("avalanche")
  ) {
    return "winter";
  }

  if (
    name.includes("fire") ||
    name.includes("smoke") ||
    name.includes("red flag")
  ) {
    return "fire";
  }

  if (name.includes("heat")) return "heat";

  if (
    name.includes("thunderstorm") ||
    name.includes("wind") ||
    name.includes("squall") ||
    name.includes("hail") ||
    // Blowing dust and a dust storm are the same hazard and belong together.
    name.includes("dust") ||
    name.includes("marine")
  ) {
    return "thunderstorm";
  }

  return "other";
}

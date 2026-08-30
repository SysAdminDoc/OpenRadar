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
  if (name.includes("tornado") || name.includes("dust storm")) return "tornado";
  if (
    name.includes("flood") ||
    name.includes("seiche") ||
    name.includes("tsunami")
  ) {
    return "flood";
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
    name.includes("winter") ||
    name.includes("snow") ||
    name.includes("ice") ||
    name.includes("blizzard") ||
    name.includes("freeze") ||
    name.includes("frost") ||
    name.includes("wind chill") ||
    name.includes("cold")
  ) {
    return "winter";
  }
  // "Red Flag Warning" is the commonest fire product and carries neither
  // word, which is exactly the sort of thing that puts an alert in the wrong
  // group and hides it behind a switch nobody thought they had touched.
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
    name.includes("hail")
  ) {
    return "thunderstorm";
  }
  return "other";
}

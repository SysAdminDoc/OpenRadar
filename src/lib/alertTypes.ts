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

/**
 * The switches, each with what it is called and what it actually covers.
 *
 * The detail line is not decoration. Grouping is by hazard rather than by
 * wording, so a switch holds products whose names do not resemble its own: a
 * tsunami warning and a nuclear plant warning are with the tornado warnings
 * because all three are somebody telling you to move now. A reader in Honolulu
 * who turned off a switch labelled only "Tornado", because tornadoes are not
 * their weather, would have lost tsunami warnings from the map and from the
 * watch without being told.
 */
export const ALERT_TYPES: Array<{
  id: AlertType;
  key: StringKey;
  detailKey: StringKey;
}> = [
  {
    id: "tornado",
    key: "alertType.tornado",
    detailKey: "alertType.tornadoDetail",
  },
  {
    id: "thunderstorm",
    key: "alertType.thunderstorm",
    detailKey: "alertType.thunderstormDetail",
  },
  { id: "flood", key: "alertType.flood", detailKey: "alertType.floodDetail" },
  {
    id: "winter",
    key: "alertType.winter",
    detailKey: "alertType.winterDetail",
  },
  {
    id: "tropical",
    key: "alertType.tropical",
    detailKey: "alertType.tropicalDetail",
  },
  { id: "fire", key: "alertType.fire", detailKey: "alertType.fireDetail" },
  { id: "heat", key: "alertType.heat", detailKey: "alertType.heatDetail" },
  { id: "other", key: "alertType.other", detailKey: "alertType.otherDetail" },
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

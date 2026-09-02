import type { StringKey } from "../i18n";
import { alertType, type AlertType } from "./alertTypes";
import type { LayerSettings } from "./settings";
import type { Level2ProductId } from "./level2";

/**
 * The layer that explains a warning.
 *
 * The app usually already holds the thing that answers "why is this warning
 * out": the rainfall totals behind a flash flood, the velocity couplet behind
 * a tornado warning, the band of snow behind a squall. A reader has to know
 * to go and find it, which means the people who would learn most from it are
 * the people who never see it.
 *
 * So a warning's popup offers one action that turns that layer on. What it
 * does is switch layers, and never anything else: it does not restyle the
 * warning, does not move the camera, and does not touch the polygon's own
 * presentation. The pairing is a suggestion about where to look, not a claim
 * about the hazard.
 */

export interface AlertPairing {
  /** Stable, so a popup button and the action that runs are one thing. */
  id: string;
  /** What the button says. */
  key: StringKey;
  /**
   * Which product names this is for.
   *
   * Read against the service's own product name rather than the coarse
   * switch group, because "flash flood warning" and "flood advisory" want
   * different answers and both are `flood`.
   */
  matches: (prodType: string) => boolean;
  /** The switches it turns on. Nothing else in settings is touched. */
  layers: Partial<Record<keyof LayerSettings, boolean>>;
  /** And the single-site product, for a pairing about the sweep itself. */
  radarProduct?: Level2ProductId;
}

/**
 * Most specific first: a flash flood emergency is matched by the flash flood
 * rule rather than the general flood one.
 */
export const ALERT_PAIRINGS: AlertPairing[] = [
  {
    id: "flash-flood-rainfall",
    key: "pairing.rainfall",
    matches: (name) => name.includes("flash flood"),
    // What has already fallen, which is the question a flash flood warning
    // raises and the radar picture does not answer.
    layers: { qpeHour: true },
  },
  {
    id: "flood-rainfall",
    key: "pairing.rainfallDay",
    matches: (name) => name.includes("flood"),
    layers: { qpeDay: true },
  },
  {
    id: "tornado-velocity",
    key: "pairing.velocity",
    matches: (name) => name.includes("tornado"),
    // The couplet the warning was issued on, at whichever site is nearest.
    layers: { rotationTracks: true },
    radarProduct: "velocity",
  },
  {
    id: "thunderstorm-hail",
    key: "pairing.hail",
    matches: (name) =>
      name.includes("severe thunderstorm") || name.includes("hail"),
    layers: { hail: true },
  },
  {
    id: "snow-squall-type",
    key: "pairing.precipType",
    matches: (name) => name.includes("snow squall"),
    // A squall is a band of heavy snow with a wind behind it, and what is
    // falling is the part radar reflectivity alone will not tell you.
    layers: { precipType: true },
  },
  {
    id: "winter-type",
    key: "pairing.precipType",
    matches: (name) =>
      name.includes("winter") ||
      name.includes("snow") ||
      name.includes("ice storm") ||
      name.includes("blizzard"),
    layers: { precipType: true },
  },
  {
    id: "tropical-surge",
    key: "pairing.surge",
    matches: (name) =>
      name.includes("storm surge") ||
      name.includes("hurricane") ||
      name.includes("tropical storm"),
    layers: { surge: true },
  },
  {
    id: "fire-smoke",
    key: "pairing.smoke",
    matches: (name) => name.includes("red flag") || name.includes("fire"),
    layers: { smoke: true, wildfires: true },
  },
];

/**
 * The groups that have no layer to hand a reader, and why.
 *
 * Written down rather than left out, so a hazard with nothing to show is a
 * decision somebody made and a new one is a gap a test points at.
 */
export const UNPAIRED: Partial<Record<AlertType, string>> = {
  heat: "Nothing this app draws explains a heat warning. The forecast panel already carries temperature, and turning a layer on would be pretending otherwise.",
  other:
    "A group that holds everything from a tsunami to a civil emergency. There is no one layer that explains all of it, and guessing per product would be a pairing nobody could predict.",
};

/** The pairing for a product name, or nothing when the group has none. */
export function pairingFor(prodType: string): AlertPairing | null {
  const name = String(prodType ?? "").toLowerCase();
  if (!name) return null;
  return ALERT_PAIRINGS.find((pairing) => pairing.matches(name)) ?? null;
}

/** The pairing named by a popup's action, for the caller that applies it. */
export function pairingById(id: string): AlertPairing | null {
  return ALERT_PAIRINGS.find((pairing) => pairing.id === id) ?? null;
}

/** Which switch group a product name falls in, re-exported for the tests. */
export function groupOf(prodType: string): AlertType {
  return alertType(prodType);
}

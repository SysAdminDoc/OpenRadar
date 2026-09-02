import type { StringKey } from "../i18n";

/**
 * What the radar itself says is falling at the site being read.
 *
 * The dual-polarisation classification is the winter answer at site scale:
 * not how much is coming back, but whether it is rain, wet snow, dry snow or
 * hail. It is the radar's own algorithm's opinion of its own volume rather
 * than an observation of the ground, and everything that draws it says so.
 *
 * The classes, their colours and their order all arrive with the data. A
 * colour table copied to this side of the boundary drifts, and then the
 * legend and the map disagree about what a colour means, which is worse than
 * either of them being wrong on its own.
 */

/** The two products that carry one, and what each is. */
export const CLASSIFICATION_PRODUCTS = ["N0H", "HHC"] as const;
export type ClassificationProduct = (typeof CLASSIFICATION_PRODUCTS)[number];

export function isClassificationProduct(
  value: unknown,
): value is ClassificationProduct {
  return CLASSIFICATION_PRODUCTS.some((product) => product === value);
}

/** What each product is called in the reader's language. */
export const CLASSIFICATION_PRODUCT_KEYS = {
  N0H: "classification.lowestTilt",
  HHC: "classification.hybridScan",
} as const satisfies Record<ClassificationProduct, StringKey>;

export interface ClassArea {
  class: string;
  fromDegrees: number;
  toDegrees: number;
  nearKm: number;
  farKm: number;
  /** The wedge as longitude and latitude, closed. */
  ring: Array<[number, number]>;
}

export interface ClassStyle {
  class: string;
  /** The key the copy is looked up under. */
  id: string;
  color: string;
}

export interface Classification {
  station: string;
  /** When the volume was taken, not when the product was generated. */
  observed: string;
  product: ClassificationProduct;
  features: ClassArea[];
  legend: ClassStyle[];
}

/** How long a volume's classification is worth drawing, in minutes. */
export const CLASSIFICATION_STALE_MINUTES = 20;

/** One a volume, so this is roughly one scan. */
export const CLASSIFICATION_REFRESH_MS = 4 * 60_000;

export async function fetchClassification(
  station: string,
  product: ClassificationProduct,
): Promise<Classification> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Classification>("level3_classification", { station, product });
}

/**
 * The wedges as the map takes them.
 *
 * One feature per run of gates rather than one per gate: a sweep is mostly
 * one class at a time, and a real one comes to a couple of thousand areas out
 * of four hundred thousand gates.
 */
export function classificationFeatures(
  report: Classification,
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: report.features.map((area) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [area.ring] },
      properties: {
        class: area.class,
        nearKm: area.nearKm,
        farKm: area.farKm,
      },
    })),
  };
}

/**
 * The fill colour, as a match on the class name.
 *
 * Built from the legend the product arrived with, so the map cannot be
 * painting one thing while the legend names another. A class with no colour
 * falls through to the same grey the algorithm's own "unknown" uses, which is
 * the honest answer to a class this build has never seen.
 */
export function classificationPaint(legend: ClassStyle[]): unknown {
  const match: unknown[] = ["match", ["get", "class"]];
  for (const style of legend) match.push(style.class, style.color);
  match.push("#8f97a3");
  return match;
}

import type { GeoPoint } from "./geo";
import type { Level2ProductId } from "./level2";

/**
 * A vertical slice through the volume on screen, drawn between two points.
 *
 * The picture is height against distance rather than a map, so everything it
 * needs a label for travels with it: how long the line is, how far up the
 * picture reaches, which cuts put anything in it, and which volume it came
 * from. A reader cannot check any of that against the map, so the panel has to
 * say it.
 */
export interface CrossSection {
  station: string;
  siteName: string;
  productId: Level2ProductId;
  product: string;
  unit: string;
  /** True when a loaded colour table drew this rather than the built-in ramp. */
  paletteApplied: boolean;
  /** True when the high-contrast ramps drew this. */
  highContrast: boolean;
  /** True when the velocity in the slice was unfolded. */
  dealiased: boolean;
  /** The two points, as longitude and latitude. */
  from: [number, number];
  to: [number, number];
  distanceKm: number;
  topKm: number;
  /** The lowest and highest cut that put a reading in the picture. */
  lowestCut: number | null;
  highestCut: number | null;
  /** Every cut the volume holds, whether or not it reached the line. */
  tilts: number[];
  collected: string;
  volume: string;
  width: number;
  height: number;
  image: string;
  source: {
    kind: "recent" | "archive" | "local";
    label: string;
    url: string | null;
  };
}

/** Which volume to cut, in the same three ways a sweep is asked for. */
export type SectionSource =
  | { kind: "recent"; station: string }
  | { kind: "archive"; station: string; at: string }
  | { kind: "local"; path: string };

export async function fetchCrossSection(
  source: SectionSource,
  from: GeoPoint,
  to: GeoPoint,
  product: Level2ProductId,
  dealias: boolean,
  threshold: number | null,
  highContrast: boolean,
): Promise<CrossSection> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CrossSection>("level2_cross_section", {
    station: source.kind === "local" ? null : source.station,
    at: source.kind === "archive" ? source.at : null,
    path: source.kind === "local" ? source.path : null,
    product,
    from: [from.lon, from.lat],
    to: [to.lon, to.lat],
    dealias,
    threshold,
    highContrast,
  });
}

/**
 * Where along the bottom of the picture a distance sits, as a percentage.
 *
 * The labels are drawn over the image rather than into it, so they follow the
 * reader's units and language without the slice being taken again.
 */
export function distancePosition(
  section: CrossSection,
  km: number,
): number | null {
  if (!(section.distanceKm > 0)) return null;
  const at = (km / section.distanceKm) * 100;
  return at >= 0 && at <= 100 ? at : null;
}

/** Where up the side of the picture a height sits, as a percentage. */
export function heightPosition(
  section: CrossSection,
  km: number,
): number | null {
  if (!(section.topKm > 0)) return null;
  const at = (km / section.topKm) * 100;
  return at >= 0 && at <= 100 ? at : null;
}

/**
 * The distances worth labelling along the bottom, in kilometres.
 *
 * A round step that gives four or five labels, whatever the line's length: a
 * fixed step puts one label on a short slice and forty on a long one.
 */
export function distanceTicks(section: CrossSection): number[] {
  const span = section.distanceKm;
  if (!(span > 0)) return [];
  const steps = [1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((size) => span / size <= 5) ?? 200;
  const ticks: number[] = [];
  for (let at = 0; at <= span + 1e-9; at += step) ticks.push(at);
  return ticks;
}

/** The heights worth labelling up the side, in kilometres. */
export function heightTicks(section: CrossSection): number[] {
  const ticks: number[] = [];
  for (let at = 0; at <= section.topKm + 1e-9; at += 3) ticks.push(at);
  return ticks;
}

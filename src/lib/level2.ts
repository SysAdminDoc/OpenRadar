import { isDesktopRuntime } from "./settings";
import { translate, type StringKey } from "../i18n";

/** Below this the national mosaic is the better picture, and cheaper. */
export const SINGLE_SITE_MIN_ZOOM = 8;
/** A volume lands every four to six minutes, so asking more often is waste. */
export const SWEEP_REFRESH_MS = 2 * 60_000;

export const LEVEL2_PRODUCTS = [
  { id: "reflectivity", key: "product.reflectivity", unit: "dBZ" },
  { id: "velocity", key: "product.velocity", unit: "m/s" },
  { id: "spectrum-width", key: "product.spectrumWidth", unit: "m/s" },
  {
    id: "differential-reflectivity",
    key: "product.differential",
    unit: "dB",
  },
  {
    id: "correlation-coefficient",
    key: "product.correlation",
    unit: "",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  key: StringKey;
  unit: string;
}>;

/** What a product is called, in whatever language the workspace is in. */
export function level2ProductLabel(id: Level2ProductId): string {
  const found = LEVEL2_PRODUCTS.find((product) => product.id === id);
  return found ? translate(found.key) : id;
}

export type Level2ProductId = (typeof LEVEL2_PRODUCTS)[number]["id"];

export function isLevel2Product(value: unknown): value is Level2ProductId {
  return LEVEL2_PRODUCTS.some((product) => product.id === value);
}

export interface SweepImage {
  station: string;
  siteName: string;
  /** The product this sweep answers, as the panel asked for it. */
  productId: Level2ProductId;
  /** True when a loaded colour table drew this rather than the built-in ramp. */
  paletteApplied: boolean;
  /** True when the velocity drawn here has been unfolded. */
  dealiased: boolean;
  product: string;
  unit: string;
  elevationDegrees: number;
  tilts: number[];
  tiltIndex: number;
  collected: string;
  west: number;
  south: number;
  east: number;
  north: number;
  image: string;
  volume: string;
}

/**
 * Decoding a Level II volume is native work, so the browser preview stays on
 * the mosaic rather than pretending it has a site to show.
 */
export function level2Available(): boolean {
  return isDesktopRuntime();
}

export function isSingleSiteViewport(zoom: number): boolean {
  return zoom >= SINGLE_SITE_MIN_ZOOM;
}

export async function nearestSite(
  lon: number,
  lat: number,
): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("level2_nearest_site", {
    latitude: lat,
    longitude: lon,
  });
}

export async function fetchSweep(
  station: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_sweep", {
    station,
    product,
    tilt,
    dealias,
  });
}

/** The four corners MapLibre wants, clockwise from the top left. */
export function sweepCorners(
  sweep: SweepImage,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [sweep.west, sweep.north],
    [sweep.east, sweep.north],
    [sweep.east, sweep.south],
    [sweep.west, sweep.south],
  ];
}

export function sweepAgeMinutes(sweep: SweepImage, nowMs: number): number {
  const collected = Date.parse(sweep.collected);
  if (!Number.isFinite(collected)) return 0;
  return Math.max(0, Math.floor((nowMs - collected) / 60_000));
}

/** Earth's radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;
/**
 * The four-thirds earth model. A radar beam bends slightly downward in normal
 * air, and pretending the earth is a third larger than it is accounts for that
 * without modelling refraction.
 */
const REFRACTION = 4 / 3;
const FEET_PER_KM = 3280.84;

/**
 * How high above the radar the centre of the beam is, in feet, at a given
 * distance and tilt.
 *
 * This is the difference between a couplet at two thousand feet and one at
 * twenty: the same picture at the same tilt means something else entirely
 * eighty miles further out, because the beam has climbed.
 */
export function beamHeightFeet(
  rangeKm: number,
  elevationDegrees: number,
): number {
  if (!Number.isFinite(rangeKm) || rangeKm < 0) return 0;
  const effective = EARTH_RADIUS_KM * REFRACTION;
  const angle = (elevationDegrees * Math.PI) / 180;
  const height =
    Math.sqrt(
      rangeKm * rangeKm +
        effective * effective +
        2 * rangeKm * effective * Math.sin(angle),
    ) - effective;
  return height * FEET_PER_KM;
}

/** Where the site is, read back from the extent its sweep was drawn to. */
export function sweepSite(sweep: SweepImage): { lon: number; lat: number } {
  return {
    lon: (sweep.west + sweep.east) / 2,
    lat: (sweep.south + sweep.north) / 2,
  };
}

import { isDesktopRuntime } from "./settings";

/** Below this the national mosaic is the better picture, and cheaper. */
export const SINGLE_SITE_MIN_ZOOM = 8;
/** A volume lands every four to six minutes, so asking more often is waste. */
export const SWEEP_REFRESH_MS = 2 * 60_000;

export const LEVEL2_PRODUCTS = [
  { id: "reflectivity", label: "Reflectivity", unit: "dBZ" },
  { id: "velocity", label: "Velocity", unit: "m/s" },
  { id: "spectrum-width", label: "Spectrum width", unit: "m/s" },
  {
    id: "differential-reflectivity",
    label: "Differential reflectivity",
    unit: "dB",
  },
  {
    id: "correlation-coefficient",
    label: "Correlation coefficient",
    unit: "",
  },
] as const;

export type Level2ProductId = (typeof LEVEL2_PRODUCTS)[number]["id"];

export function isLevel2Product(value: unknown): value is Level2ProductId {
  return LEVEL2_PRODUCTS.some((product) => product.id === value);
}

export interface SweepImage {
  station: string;
  siteName: string;
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
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_sweep", { station, product, tilt });
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

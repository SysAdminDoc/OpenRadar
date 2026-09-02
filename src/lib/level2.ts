import { isDesktopRuntime } from "./settings";
import { translate, type StringKey } from "../i18n";
import { nativeErrorParams } from "./nativeError";
import { en } from "../i18n/en";

/** Below this the national mosaic is the better picture, and cheaper. */
export const SINGLE_SITE_MIN_ZOOM = 8;
/** A volume lands every four to six minutes, so asking more often is waste. */
export const SWEEP_REFRESH_MS = 2 * 60_000;

/**
 * How often to ask while the volume in progress is what is being drawn.
 *
 * The radar publishes a piece every eleven or twelve seconds, so this is close
 * enough that a new one is on screen within half a minute of being made, and
 * far enough apart that most asks have something new to answer with.
 */
export const LIVE_REFRESH_MS = 20_000;

export const LEVEL2_PRODUCTS = [
  { id: "reflectivity", key: "product.reflectivity", unit: "dBZ" },
  { id: "velocity", key: "product.velocity", unit: "m/s" },
  {
    id: "storm-relative-velocity",
    key: "product.stormRelative",
    unit: "m/s",
  },
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
  // A terminal radar's alone: reflectivity to 225 nautical miles on 300 m
  // gates. A WSR-88D's capabilities leave it out.
  {
    id: "long-range-reflectivity",
    key: "product.longRange",
    unit: "dBZ",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  key: StringKey;
  unit: string;
}>;

export type Level2ProductId = (typeof LEVEL2_PRODUCTS)[number]["id"];

/** Which kind of radar drew a sweep, which decides its products and reach. */
export type RadarKind = "WSR-88D" | "TDWR";

export function isLevel2Product(value: unknown): value is Level2ProductId {
  return LEVEL2_PRODUCTS.some((product) => product.id === value);
}

/** The motion subtracted from a storm relative sweep. */
export interface StormMotion {
  speedMs: number;
  fromDegrees: number;
  /** True when the viewer gave it rather than the sweep being read for it. */
  manual: boolean;
}

export interface SweepImage {
  station: string;
  siteName: string;
  /** The product this sweep answers, as the panel asked for it. */
  productId: Level2ProductId;
  /** True when a loaded colour table drew this rather than the built-in ramp. */
  paletteApplied: boolean;
  /**
   * True when the high-contrast ramps drew this.
   *
   * The picture on screen was drawn when it was asked for, so the legend
   * follows this rather than the preference as it stands now: a reader who has
   * just turned contrast on is still looking at the sweep they had.
   */
  highContrast: boolean;
  /** True when the velocity drawn here has been unfolded. */
  dealiased: boolean;
  /** What was taken out to make a storm relative sweep, when one was. */
  stormMotion: StormMotion | null;
  product: string;
  unit: string;
  elevationDegrees: number;
  tilts: number[];
  tiltIndex: number;
  /**
   * True when the sector on screen came from the volume being swept now.
   *
   * False for a sweep the archive answered, including one asked for live at a
   * cut the radar has not reached yet: nothing then on screen is live, and the
   * legend must not say otherwise.
   */
  live: boolean;
  /** How many cuts the volume in progress has published. Zero when not live. */
  liveTilts: number;
  collected: string;
  west: number;
  south: number;
  east: number;
  north: number;
  image: string;
  volume: string;
  source: {
    kind: "recent" | "archive" | "local";
    label: string;
    url: string | null;
  };
  /** Which kind of radar drew this. */
  radar: RadarKind;
  /** How far the picture reaches from the site, in kilometres. */
  rangeKm: number;
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
  motion: [number, number] | null,
  // Hide anything weaker than this, in the product's own unit.
  threshold: number | null,
  // Draw the volume being swept now over the last one the radar finished.
  live: boolean,
  // Draw with the ramps built for a reader who has asked for more contrast.
  highContrast: boolean,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_sweep", {
    station,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    live,
    highContrast,
  });
}

export async function fetchArchiveSweep(
  station: string,
  at: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  threshold: number | null,
  highContrast: boolean,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_archive_sweep", {
    station,
    at,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    highContrast,
  });
}

export async function fetchLocalSweep(
  path: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  threshold: number | null,
  highContrast: boolean,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_local_sweep", {
    path,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    highContrast,
  });
}

/** Opens the operating system's picker without granting general file access. */
export async function pickArchiveFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: translate("radar.openArchiveTitle"),
    directory: false,
    multiple: false,
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * How old the live part of a sweep is, in whole seconds, or null.
 *
 * Measured from when the radar collected the cut rather than from when it was
 * fetched, so a slow download shows as what it is. A sweep the archive
 * answered has no live part and gets nothing.
 */
export function liveAgeSeconds(sweep: SweepImage, now: number): number | null {
  if (!sweep.live) return null;
  const collected = Date.parse(sweep.collected);
  if (Number.isNaN(collected)) return null;
  // A clock a little behind the radar's would otherwise read as the future.
  return Math.max(0, Math.round((now - collected) / 1000));
}

/**
 * What the native side said went wrong, in the reader's own language.
 *
 * The command rejects with a code, the parts of the message, and the English
 * sentence it would otherwise have sent. Anything with wording of its own is
 * written here; anything without falls back to that sentence, which is better
 * than a code nobody can read.
 */
export function sweepErrorText(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const named = failure as {
      code?: unknown;
      args?: unknown;
      text?: unknown;
    };
    const args = Array.isArray(named.args) ? named.args : [];
    const params = nativeErrorParams(String(named.code), args);
    const key = `radar.error.${String(named.code)}`;
    // A build that has never heard of this failure has no wording for it, and
    // asking for one that is not there throws rather than answering.
    if (key in en) return translate(key as StringKey, params);
    if (typeof named.text === "string" && named.text) return named.text;
  }
  if (typeof failure === "string") return failure;
  if (failure instanceof Error) return failure.message;
  // Something with no shape this build recognises. Saying the volume listing
  // could not be read would be a specific diagnosis of something else.
  return translate("radar.error.unknown");
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

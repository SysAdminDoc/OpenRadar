import { isDesktopRuntime } from "../settings";
import type { GaugeQpePeriod } from "../gaugeQpe";
import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lightningGrids";
import type { AzShearLevel, RotationPeriod } from "../rotationTrack";
import type { CappiField, CubeLevel } from "../cappi";
import { withinLoop, type RadarFrame, type RadarProvider } from "./types";

/**
 * MRMS is the national grid NOAA builds by merging every radar in the network.
 * It is finer and better quality controlled than the RIDGE mosaic, but it ships
 * as GRIB2 rather than as pictures, so the tiles are drawn on this machine and
 * served to the map over a local scheme.
 */
export const MRMS_HOST = "mrms.localhost";

/**
 * Every grid the native side can decode, as values rather than only as a type.
 *
 * A runtime list so other code can be held to it. The layer table names one of
 * these per MRMS-backed switch, and without something to check against, a
 * renamed id there fails silently by reporting a made-up observation time.
 */
/**
 * The deepest zoom the map may ask an MRMS tile for.
 *
 * Written once because it is a promise to the native side rather than a
 * matter of taste: the tile handler answers a transparent pixel past its own
 * ceiling, so a map asking deeper goes blank rather than wrong. Held to it by
 * `never asks for a tile the native side refuses`.
 */
export const MRMS_MAX_ZOOM = 12;

export const MRMS_PRODUCT_IDS = [
  "composite",
  "rotation",
  "rotation-30",
  "rotation-120",
  "rotation-240",
  "rotation-1440",
  "az-shear-low",
  "az-shear-mid",
  "mesh",
  "vil-density",
  "shi",
  "posh",
  "vii",
  "lightning",
  "lightning-1min",
  "lightning-15min",
  "lightning-30min",
  "lightning-probability-30min",
  "lightning-probability-60min",
  "lightning-jump",
  "lightning-jump-max",
  "reflectivity-minus-10c",
  "reflectivity-minus-20c",
  "echo-tops",
  "vil",
  "precip-rate",
  "qpe-hour",
  "qpe-day",
  "gauge-qpe-hour",
  "gauge-qpe-day",
  "gauge-qpe-three-day",
  "ffg-hour",
  "ffg-three-hour",
  "unit-streamflow",
  "hail-swath",
  "precip-type",
  // One row each for the three fields the network publishes through the whole
  // depth of its merged grid. Which height is a separate choice, because
  // ninety-nine ids would be the same three products said thirty-three times.
  "cappi-reflectivity",
  "cappi-rhohv",
  "cappi-zdr",
] as const;

export type MrmsProductId = (typeof MRMS_PRODUCT_IDS)[number];

/** Which grid the period switch is pointing at. */
export const GAUGE_QPE_PRODUCTS: Record<GaugeQpePeriod, MrmsProductId> = {
  "1h": "gauge-qpe-hour",
  "24h": "gauge-qpe-day",
  "72h": "gauge-qpe-three-day",
};

/** Which track the window beside the rotation switch is pointing at. */
export const ROTATION_PRODUCTS: Record<RotationPeriod, MrmsProductId> = {
  "30m": "rotation-30",
  "1h": "rotation",
  "2h": "rotation-120",
  "4h": "rotation-240",
  "24h": "rotation-1440",
};

/** Which slab the height beside the shear switch is pointing at. */
export const AZ_SHEAR_PRODUCTS: Record<AzShearLevel, MrmsProductId> = {
  low: "az-shear-low",
  mid: "az-shear-mid",
};

/** Which window the density switch is pointing at. */
export const LIGHTNING_DENSITY_PRODUCTS: Record<
  LightningWindow,
  MrmsProductId
> = {
  "1m": "lightning-1min",
  "5m": "lightning",
  "15m": "lightning-15min",
  "30m": "lightning-30min",
};

/** Which forecast the chance-of-lightning switch is pointing at. */
export const LIGHTNING_FORECAST_PRODUCTS: Record<
  LightningForecast,
  MrmsProductId
> = {
  "30m": "lightning-probability-30min",
  "60m": "lightning-probability-60min",
};

/** Which jump grid the switch beside it is pointing at. */
export const LIGHTNING_JUMP_PRODUCTS: Record<LightningJump, MrmsProductId> = {
  now: "lightning-jump",
  max: "lightning-jump-max",
};

/** Which of the merged fields the height switch is pointing at. */
export const CAPPI_PRODUCTS: Record<CappiField, MrmsProductId> = {
  reflectivity: "cappi-reflectivity",
  correlation: "cappi-rhohv",
  differential: "cappi-zdr",
};

/** Which temperature the isothermal reflectivity is sampled at. */
export const ISOTHERM_PRODUCTS: Record<IsothermLevel, MrmsProductId> = {
  minus10: "reflectivity-minus-10c",
  minus20: "reflectivity-minus-20c",
};

export interface MrmsProductInfo {
  id: MrmsProductId;
  label: string;
  unit: string;
  floor: number;
  /** Each ramp stop as its value and its colour, for the legend. */
  stops: Array<[number, string]>;
  /**
   * For a grid whose numbers are names rather than a quantity: the value, its
   * colour, and a stable name the page translates.
   */
  categories?: Array<[number, string, string]>;
}

interface MrmsFrame {
  time: number;
  key: string;
}

/**
 * A custom scheme is `mrms://localhost/...` on macOS and Linux but
 * `http://mrms.localhost/...` on Windows, and only Tauri knows which.
 */
let tileBase: string | null = null;

async function base(): Promise<string> {
  if (tileBase) return tileBase;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  // The trailing marker is stripped back off, which leaves the scheme and host
  // however this platform spells them.
  const sample = convertFileSrc("openradar", "mrms");
  tileBase = sample.slice(0, sample.lastIndexOf("openradar"));
  return tileBase;
}

/**
 * The generation is part of the address rather than a header, because a tile
 * is fetched by the map and cached by the map. A new colour table means a new
 * address, so nothing drawn with the old one is shown again.
 */
/**
 * The regions the network publishes separately, with the extent of each read
 * out of the grids themselves rather than taken from documentation.
 *
 * They do not overlap and they are not one picture: each is its own
 * projection at its own resolution, so a view over Honolulu has to ask for
 * the Hawaii grid and not a CONUS one that stops two thousand miles short.
 */
export const DOMAINS: Array<{
  id: string;
  box: { west: number; south: number; east: number; north: number };
}> = [
  {
    id: "CONUS",
    box: { west: -129.995, south: 19.995, east: -59.995, north: 54.995 },
  },
  {
    id: "ALASKA",
    box: { west: -175.995, south: 49.995, east: -125.995, north: 71.995 },
  },
  {
    id: "HAWAII",
    box: { west: -163.9975, south: 14.9975, east: -150.9975, north: 25.9975 },
  },
  {
    id: "GUAM",
    box: { west: 140.0025, south: 8.9975, east: 150.0025, north: 17.9975 },
  },
  {
    id: "CARIB",
    box: { west: -89.995, south: 9.995, east: -59.995, north: 24.995 },
  },
];

/** Which region a place falls in, or nothing when it falls in none. */
export function domainFor(
  center: [number, number] | undefined,
): (typeof DOMAINS)[number] | null {
  if (!center) return null;
  const [lon, lat] = center;
  return (
    DOMAINS.find(
      ({ box }) =>
        lon >= box.west &&
        lon <= box.east &&
        lat >= box.south &&
        lat <= box.north,
    ) ?? null
  );
}

export function tileUrl(
  root: string,
  product: MrmsProductId,
  time: number,
  palette = 0,
  // Hide anything below this, in the product's own unit. It is part of the
  // address for the same reason the palette is: a different threshold is a
  // different picture and must not be served out of the map's own cache.
  threshold: number | null = null,
  /** Which region's grid, since each is published on its own. */
  domain = "CONUS",
  // Draw on the ramp built for a reader who asked for more contrast. In the
  // address for the same reason the other two are: it is a different picture,
  // and the map's own cache must not serve one for the other.
  highContrast = false,
  // Which height of the merged grid, for the three products published at more
  // than one. In the address like the rest: a different height is a different
  // picture and the map's own cache must not serve one for the other.
  level: CubeLevel | null = null,
  // Read between the cells rather than take the nearest one. In the address
  // like the rest: it is a different picture, and neither the map's own tile
  // cache nor the native side's may serve one for the other.
  smooth = false,
): string {
  const floor =
    threshold !== null && Number.isFinite(threshold) ? `&min=${threshold}` : "";
  const contrast = highContrast ? "&hc=1" : "";
  const height = level ? `&level=${level}` : "";
  const between = smooth ? "&smooth=1" : "";
  return `${root}${domain}/${product}/${time}/{z}/{x}/{y}.png?p=${palette}${floor}${contrast}${height}${between}`;
}

/** The base URL for the local tile scheme, once Tauri has spelled it out. */
export async function tileRoot(): Promise<string> {
  return base();
}

export async function mrmsProducts(
  /** Which ramp the legends are to be built from. */
  highContrast = false,
): Promise<MrmsProductInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MrmsProductInfo[]>("mrms_products", { highContrast });
}

export async function mrmsFrames(
  product: MrmsProductId,
  limit: number,
  /** Which region's grid, since each is published on its own. */
  domain?: string,
  /** Which height, for the three products published at more than one. */
  level?: CubeLevel,
): Promise<MrmsFrame[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MrmsFrame[]>("mrms_frames", { product, limit, domain, level });
}

/** The grids are decoded here, so a browser preview has none of this. */
export function mrmsAvailable(): boolean {
  return isDesktopRuntime();
}

/** Two-minute frames, so an hour is thirty of them. */
export function frameLimit(loopMinutes: number): number {
  return Math.max(5, Math.min(60, Math.ceil(loopMinutes / 2)));
}

/**
 * Every frame is a fifty megabyte grid to decode, so a two-hour loop at the
 * full two-minute cadence would be sixty of them. The loop is thinned to span
 * the same window in coarser steps, and the newest frame is always kept: how
 * old the picture is matters, how finely the past is sliced does not.
 */
export const MAX_LOOP_FRAMES = 20;

export function thinFrames<T>(frames: T[], most = MAX_LOOP_FRAMES): T[] {
  if (frames.length <= most || most < 1) return frames;
  const step = Math.ceil(frames.length / most);
  const kept: T[] = [];
  // Counting back from the newest keeps it, whatever the step works out to.
  for (let at = frames.length - 1; at >= 0; at -= step)
    kept.unshift(frames[at]);
  return kept;
}

export const mrmsProvider: RadarProvider & {
  paletteGeneration: number;
  threshold: number | null;
  highContrast: boolean;
} = {
  id: "mrms",
  label: "NOAA MRMS",
  attribution:
    '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>',
  attributionUrl: "https://www.nssl.noaa.gov/projects/mrms/",
  host: MRMS_HOST,
  // Every region the network publishes.
  coverage: DOMAINS.map((domain) => domain.box),
  // The five grids are published separately, at their own resolutions, so
  // which one is being watched is part of what the timeline is a timeline of.
  regionAt: (lon, lat) => domainFor([lon, lat])?.id ?? null,
  // Tiles are drawn locally, so the only budget that matters is the listing.
  tileBudgetLimit: 100_000,
  discoveryBudgetLimit: 30,
  budgetWindowMs: 60_000,
  /** Bumped when a colour table is loaded, so the tiles are drawn again. */
  paletteGeneration: 0,
  /** Hide anything below this, in dBZ, as the reader asked. */
  threshold: null,
  /** Draw on the ramp built for more contrast, as the reader asked. */
  highContrast: false,
  fetchFrames: async (
    loopMinutes: number,
    _signal?: AbortSignal,
    center?: [number, number],
  ) => {
    // Which region the view is over. Falling back to the lower forty-eight
    // keeps a view outside every grid drawing the picture it drew before,
    // which is nothing, rather than failing the whole chain.
    const domain = domainFor(center) ?? DOMAINS[0];
    const [root, frames] = await Promise.all([
      base(),
      mrmsFrames("composite", frameLimit(loopMinutes), domain.id),
    ]);
    return withinLoop(
      thinFrames(frames).map((frame): RadarFrame => ({
        providerId: "mrms",
        time: frame.time,
        tileUrl: tileUrl(
          root,
          "composite",
          frame.time,
          mrmsProvider.paletteGeneration,
          mrmsProvider.threshold,
          domain.id,
          mrmsProvider.highContrast,
        ),
        tileSize: 256,
        // The grid is one kilometre and holds no more detail past ten, but the
        // DRAWING does: a tile made for zoom ten and blown up to fill zoom
        // twelve shows its own pixel grid as blocks. Held to what the native
        // side will actually serve by `the map never asks for a tile the
        // native side refuses`.
        maxZoom: MRMS_MAX_ZOOM,
        attribution:
          '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>',
      })),
      loopMinutes,
    );
  },
};

/**
 * The colour table in force, as a number that goes in every tile address.
 * The provider builds those addresses inside fetchFrames, which takes no such
 * argument, so it is set here rather than threaded through the interface every
 * provider shares.
 */
export function setMrmsPaletteGeneration(generation: number) {
  mrmsProvider.paletteGeneration = generation;
}

/**
 * The threshold in force for the mosaic, set the same way and for the same
 * reason: it goes in every tile address, and the provider builds those inside
 * fetchFrames where no such argument reaches.
 *
 * Returns whether it changed, since a changed threshold means every frame has
 * to be asked for again.
 */
export function setMrmsThreshold(value: number | null): boolean {
  const next = value !== null && Number.isFinite(value) ? value : null;
  if (mrmsProvider.threshold === next) return false;
  mrmsProvider.threshold = next;
  return true;
}

/**
 * The ramp in force for the mosaic, set the same way and for the same reason.
 *
 * Returns whether it changed, since a changed ramp means every frame has to be
 * asked for again: the tiles are drawn on this machine, and the ones already
 * held were drawn the other way.
 */
export function setMrmsHighContrast(value: boolean): boolean {
  if (mrmsProvider.highContrast === value) return false;
  mrmsProvider.highContrast = value;
  return true;
}

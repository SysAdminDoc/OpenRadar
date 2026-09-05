import { useEffect, useMemo, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import { log } from "../lib/log";
import {
  mrmsAvailable,
  mrmsFrames,
  mrmsProducts,
  tileRoot,
  tileUrl,
  GAUGE_QPE_PRODUCTS,
  ROTATION_PRODUCTS,
  AZ_SHEAR_PRODUCTS,
  ISOTHERM_PRODUCTS,
  CAPPI_PRODUCTS,
  LIGHTNING_DENSITY_PRODUCTS,
  LIGHTNING_FORECAST_PRODUCTS,
  LIGHTNING_JUMP_PRODUCTS,
  type MrmsProductId,
  type MrmsProductInfo,
} from "../lib/providers/mrms";
import type { GaugeQpePeriod } from "../lib/gaugeQpe";
import type { AzShearLevel, RotationPeriod } from "../lib/rotationTrack";
import type { LayerSettings } from "../lib/settings";
import type { StringKey } from "../i18n";
import { useHighContrast } from "./useClock";

/** The grids land every two minutes, so this is the useful refresh. */
const REFRESH_MS = 2 * 60_000;

/**
 * The three switches that stand for more than one grid, and which one each is
 * pointing at.
 *
 * One shape rather than three arguments, because every caller that resolves a
 * switch to a grid needs all three and a caller that forgot one would silently
 * draw the default window.
 */
export interface MrmsChoices {
  gaugeQpePeriod: GaugeQpePeriod;
  rotationPeriod: RotationPeriod;
  lightningWindow: LightningWindow;
  lightningForecastWindow: LightningForecast;
  lightningJumpWindow: LightningJump;
  isothermLevel: IsothermLevel;
  azShearLevel: AzShearLevel;
  /** Which of the three merged fields the height switch is showing. */
  cappiField: CappiField;
  /** Which height of the merged grid all three are read at. */
  cappiLevel: CubeLevel;
}

import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lib/lightningGrids";
import type { CappiField, CubeLevel } from "../lib/cappi";

/** Which layer switch drives which MRMS product. */
export const MRMS_LAYERS: Array<{
  layer: keyof LayerSettings;
  product: MrmsProductId;
}> = [
  // Like the gauge-corrected accumulation below, these two name their default
  // so the table stays a plain map; the hook swaps in whichever window or
  // height the reader chose. See `ROTATION_PRODUCTS` and `AZ_SHEAR_PRODUCTS`.
  { layer: "rotationTracks", product: "rotation" },
  { layer: "azShear", product: "az-shear-low" },
  { layer: "hail", product: "mesh" },
  { layer: "hailSwath", product: "hail-swath" },
  { layer: "vilDensity", product: "vil-density" },
  { layer: "shi", product: "shi" },
  { layer: "posh", product: "posh" },
  { layer: "vii", product: "vii" },
  // Four windows, two forecasts, two jump grids and two temperatures, one
  // switch each; the entry names the default and the hook swaps in whichever
  // the reader chose. See the four maps in `providers/mrms.ts`.
  { layer: "lightningDensity", product: "lightning" },
  { layer: "lightningForecast", product: "lightning-probability-30min" },
  { layer: "lightningJump", product: "lightning-jump-max" },
  { layer: "isothermReflectivity", product: "reflectivity-minus-10c" },
  { layer: "echoTops", product: "echo-tops" },
  { layer: "vil", product: "vil" },
  { layer: "precipRate", product: "precip-rate" },
  { layer: "qpeHour", product: "qpe-hour" },
  { layer: "qpeDay", product: "qpe-day" },
  // The product behind this one is whichever period the reader has chosen;
  // the entry names the default so the table stays a plain map, and the hook
  // below swaps it. See `GAUGE_QPE_PRODUCTS`.
  { layer: "gaugeQpe", product: "gauge-qpe-day" },
  { layer: "ffgHour", product: "ffg-hour" },
  { layer: "ffgThreeHour", product: "ffg-three-hour" },
  { layer: "unitStreamflow", product: "unit-streamflow" },
  { layer: "precipType", product: "precip-type" },
  // One switch over three fields at any of thirty-three heights; the entry
  // names the default and the hook swaps in whichever the reader chose. See
  // `CAPPI_PRODUCTS` and `levelFor`.
  { layer: "cappi", product: "cappi-reflectivity" },
];

/**
 * What each grid is called in the reader's language.
 *
 * The native side names its own products, in English, and the legend beside
 * the map was showing that name whatever language the workspace was in. These
 * are the same names in the catalogue, so nothing is lost: a rotation track
 * still says it covers the past hour, in whichever language.
 */
const LABEL_KEYS: Record<MrmsProductId, StringKey> = {
  // The composite is the radar timeline rather than a grid with its own
  // legend, so it never reaches this, but the map has to be complete.
  composite: "chrome.composite",
  rotation: "mrms.rotation",
  "rotation-30": "mrms.rotation30",
  "rotation-120": "mrms.rotation120",
  "rotation-240": "mrms.rotation240",
  "rotation-1440": "mrms.rotation1440",
  "az-shear-low": "mrms.azShearLow",
  "az-shear-mid": "mrms.azShearMid",
  mesh: "mrms.mesh",
  "vil-density": "mrms.vilDensity",
  shi: "mrms.shi",
  posh: "mrms.posh",
  vii: "mrms.vii",
  "hail-swath": "mrms.hailSwath",
  lightning: "mrms.lightning",
  "lightning-1min": "mrms.lightning1min",
  "lightning-15min": "mrms.lightning15min",
  "lightning-30min": "mrms.lightning30min",
  "lightning-probability-30min": "mrms.lightningProbability30",
  "lightning-probability-60min": "mrms.lightningProbability60",
  "lightning-jump": "mrms.lightningJump",
  "lightning-jump-max": "mrms.lightningJumpMax",
  "reflectivity-minus-10c": "mrms.reflectivityMinus10c",
  "reflectivity-minus-20c": "mrms.reflectivityMinus20c",
  "echo-tops": "mrms.echoTops",
  vil: "mrms.vil",
  "precip-rate": "mrms.precipRate",
  "qpe-hour": "mrms.qpeHour",
  "qpe-day": "mrms.qpeDay",
  "gauge-qpe-hour": "mrms.gaugeQpeHour",
  "gauge-qpe-day": "mrms.gaugeQpeDay",
  "gauge-qpe-three-day": "mrms.gaugeQpeThreeDay",
  "ffg-hour": "mrms.ffgHour",
  "ffg-three-hour": "mrms.ffgThreeHour",
  "unit-streamflow": "mrms.unitStreamflow",
  "precip-type": "mrms.precipType",
  "cappi-reflectivity": "mrms.cappiReflectivity",
  "cappi-rhohv": "mrms.cappiRhohv",
  "cappi-zdr": "mrms.cappiZdr",
};

/**
 * The grid behind a switch.
 *
 * The table above is a plain map from switch to grid, which every layer needs
 * and three cannot have: the gauge-corrected accumulation is one switch over
 * three windows, the rotation track one switch over five, and the merged shear
 * one switch over two heights, and which grid each means is whichever the
 * reader picked. Named and exported so those choices are checkable on their
 * own; getting one wrong draws the right layer over the wrong number of hours
 * or the wrong slab of the storm, which looks entirely normal.
 */
export function productFor(
  layer: keyof LayerSettings,
  product: MrmsProductId,
  choices: MrmsChoices,
): MrmsProductId {
  if (layer === "gaugeQpe") return GAUGE_QPE_PRODUCTS[choices.gaugeQpePeriod];
  if (layer === "rotationTracks") {
    return ROTATION_PRODUCTS[choices.rotationPeriod];
  }
  if (layer === "azShear") return AZ_SHEAR_PRODUCTS[choices.azShearLevel];
  if (layer === "lightningDensity") {
    return LIGHTNING_DENSITY_PRODUCTS[choices.lightningWindow];
  }
  if (layer === "lightningForecast") {
    return LIGHTNING_FORECAST_PRODUCTS[choices.lightningForecastWindow];
  }
  if (layer === "lightningJump") {
    return LIGHTNING_JUMP_PRODUCTS[choices.lightningJumpWindow];
  }
  if (layer === "isothermReflectivity") {
    return ISOTHERM_PRODUCTS[choices.isothermLevel];
  }
  if (layer === "cappi") return CAPPI_PRODUCTS[choices.cappiField];
  return product;
}

/**
 * The height a grid is read at, or nothing for one published at one height.
 *
 * The height is not part of the product id, so it has to travel beside it
 * everywhere the id goes: into the listing that says when the grid was
 * published, and into the tile address. Passing it where it does not belong
 * would ask the bucket for a folder that does not exist, so this answers for
 * the three families and nothing else.
 */
export function levelFor(
  product: MrmsProductId,
  choices: MrmsChoices,
): CubeLevel | undefined {
  return CAPPI_PRODUCT_IDS.has(product) ? choices.cappiLevel : undefined;
}

const CAPPI_PRODUCT_IDS = new Set<MrmsProductId>(Object.values(CAPPI_PRODUCTS));

/**
 * When the grid behind a switch was published, in milliseconds, or undefined
 * where that switch is drawing nothing.
 *
 * Here rather than at the one call site because the failure is silent: the
 * diagnostics report looked the time up by the record's source id, which
 * names the family for the one switch that covers three windows and matches
 * no grid at all. A missing time is reported as "observed just now", so a
 * product published hours behind was described as current.
 */
export function mrmsTimeFor(
  drawn: readonly MrmsLayer[],
  layer: keyof LayerSettings,
  choices: MrmsChoices,
): number | undefined {
  const entry = MRMS_LAYERS.find((known) => known.layer === layer);
  if (!entry) return undefined;
  const product = productFor(entry.layer, entry.product, choices);
  const found = drawn.find((one) => one.product === product);
  // Seconds on the way in, because that is what the grids publish, and
  // milliseconds on the way out, because that is what a record holds.
  return found ? found.time * 1000 : undefined;
}

export interface MrmsLayer {
  product: MrmsProductId;
  /**
   * Which height of the merged grid this one is drawn at, for the three
   * products published at more than one.
   *
   * On the layer rather than only inside `tileUrl`, because anything else
   * that asks for this grid has to ask for the same one: an export that left
   * it out wrote the half kilometre grid under the name of whatever height
   * was on screen.
   */
  level?: CubeLevel;
  /**
   * The name the native side gives the grid, which is English wherever the
   * reader is. `labelKey` is the one to show; this one is for a log line or a
   * file name.
   */
  label: string;
  /** The catalogue key for the layer switch this grid is behind. */
  labelKey: StringKey;
  unit: string;
  tileUrl: string;
  /** When the grid was valid, so the legend can say how old it is. */
  time: number;
  stops: Array<[number, string]>;
  /**
   * For a grid whose numbers are names: the value, its colour, and the name
   * the page translates. The legend lists these instead of a gradient.
   */
  categories?: Array<[number, string, string]>;
}

export interface MrmsOverlayState {
  layers: MrmsLayer[];
  error: string | null;
}

/**
 * Rotation tracks and hail size are the two MRMS products worth a switch of
 * their own. Both are drawn from the same locally decoded grids the radar
 * composite uses, so turning one on costs a listing and nothing more.
 */
export function useMrmsOverlays(options: {
  ready: boolean;
  layers: LayerSettings;
  pageVisible: boolean;
  /** Bumped when a colour table is loaded, so the tiles are drawn again. */
  paletteGeneration: number;
  /** Which grid each of the switches that stands for several is pointing at. */
  choices: MrmsChoices;
}): MrmsOverlayState {
  const { ready, layers, pageVisible, paletteGeneration, choices } = options;
  const [catalog, setCatalog] = useState<MrmsProductInfo[]>([]);
  const [times, setTimes] = useState<Partial<Record<MrmsProductId, number>>>(
    {},
  );
  const [root, setRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The grids are drawn on this machine, so the ramp is part of the tile
  // address and part of what the catalogue has to hand the legend.
  const highContrast = useHighContrast();

  const available = mrmsAvailable();
  // A stable key for the set of switches that are on, so panning does not
  // restart the polling.
  const wanted = MRMS_LAYERS.filter(({ layer }) => layers[layer])
    .map(({ layer, product }) => productFor(layer, product, choices))
    .join(",");
  // The height is not part of a product id, so it is not in the key above,
  // and it is a different picture: without it here a reader moving the height
  // slider kept the grid from the height before it.
  const height = choices.cappiLevel;

  useEffect(() => {
    if (!ready || !available || !wanted) return;
    let open = true;
    void Promise.all([tileRoot(), mrmsProducts(highContrast)])
      .then(([base, list]) => {
        if (!open) return;
        setRoot(base);
        setCatalog(list);
      })
      .catch((failure: unknown) => {
        if (!open) return;
        log.warn(
          "radar",
          failure instanceof Error
            ? failure.message
            : "The MRMS products could not be listed.",
        );
      });
    return () => {
      open = false;
    };
  }, [available, highContrast, ready, wanted]);

  useEffect(() => {
    if (!ready || !available || !wanted) return;
    let open = true;
    const products = wanted.split(",") as MrmsProductId[];

    const refresh = async () => {
      try {
        const found = await Promise.all(
          products.map(async (product) => {
            const frames = await mrmsFrames(
              product,
              1,
              undefined,
              levelFor(product, choices),
            );
            return [product, frames.at(-1)?.time ?? 0] as const;
          }),
        );
        if (!open) return;
        // Only what is switched on now. A product that was turned off and back
        // on must not draw the grid it had an hour ago while it waits for a
        // fresh one.
        setTimes(Object.fromEntries(found.filter(([, time]) => time > 0)));
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The MRMS grids did not answer.";
        log.warn("radar", message);
        setError(message);
      }
    };

    // The first ask, in the place it has always been: before the
    // visibility check below, so a hidden window still reads once.
    // Not with no network, where it is one more failure in the log.
    if (isOnline()) void refresh();

    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const stop = pollWhileOnline(() => void refresh(), REFRESH_MS, false);
    return () => {
      open = false;
      stop();
    };
    // `choices` is a new object every render; the field is already folded
    // into `wanted` and the height is the rest of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, height, pageVisible, ready, wanted]);

  return useMemo(() => {
    if (!root || !wanted) return { layers: [], error: null };
    const on = new Set(wanted.split(","));
    return {
      layers: catalog
        .filter((entry) => on.has(entry.id) && times[entry.id])
        .map((entry) => ({
          product: entry.id,
          level: levelFor(entry.id, choices),
          label: entry.label,
          labelKey: LABEL_KEYS[entry.id],
          unit: entry.unit,
          time: times[entry.id] ?? 0,
          tileUrl: tileUrl(
            root,
            entry.id,
            times[entry.id] ?? 0,
            paletteGeneration,
            null,
            "CONUS",
            highContrast,
            levelFor(entry.id, choices) ?? null,
          ),
          stops: entry.stops,
          ...(entry.categories ? { categories: entry.categories } : {}),
        })),
      error,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    error,
    height,
    highContrast,
    paletteGeneration,
    root,
    times,
    wanted,
  ]);
}

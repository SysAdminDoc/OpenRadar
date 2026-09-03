import { useEffect, useMemo, useState } from "react";
import { log } from "../lib/log";
import {
  mrmsAvailable,
  mrmsFrames,
  mrmsProducts,
  tileRoot,
  tileUrl,
  type MrmsProductId,
  type MrmsProductInfo,
} from "../lib/providers/mrms";
import type { LayerSettings } from "../lib/settings";
import type { StringKey } from "../i18n";
import { useHighContrast } from "./useClock";

/** The grids land every two minutes, so this is the useful refresh. */
const REFRESH_MS = 2 * 60_000;

/** Which layer switch drives which MRMS product. */
export const MRMS_LAYERS: Array<{
  layer: keyof LayerSettings;
  product: MrmsProductId;
}> = [
  { layer: "rotationTracks", product: "rotation" },
  { layer: "hail", product: "mesh" },
  { layer: "hailSwath", product: "hail-swath" },
  { layer: "lightningDensity", product: "lightning" },
  { layer: "echoTops", product: "echo-tops" },
  { layer: "vil", product: "vil" },
  { layer: "precipRate", product: "precip-rate" },
  { layer: "qpeHour", product: "qpe-hour" },
  { layer: "qpeDay", product: "qpe-day" },
  { layer: "ffgHour", product: "ffg-hour" },
  { layer: "ffgThreeHour", product: "ffg-three-hour" },
  { layer: "unitStreamflow", product: "unit-streamflow" },
  { layer: "precipType", product: "precip-type" },
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
  mesh: "mrms.mesh",
  "hail-swath": "mrms.hailSwath",
  lightning: "mrms.lightning",
  "echo-tops": "mrms.echoTops",
  vil: "mrms.vil",
  "precip-rate": "mrms.precipRate",
  "qpe-hour": "mrms.qpeHour",
  "qpe-day": "mrms.qpeDay",
  "ffg-hour": "mrms.ffgHour",
  "ffg-three-hour": "mrms.ffgThreeHour",
  "unit-streamflow": "mrms.unitStreamflow",
  "precip-type": "mrms.precipType",
};

export interface MrmsLayer {
  product: MrmsProductId;
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
}): MrmsOverlayState {
  const { ready, layers, pageVisible, paletteGeneration } = options;
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
    .map(({ product }) => product)
    .join(",");

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
            const frames = await mrmsFrames(product, 1);
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

    void refresh();
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, [available, pageVisible, ready, wanted]);

  return useMemo(() => {
    if (!root || !wanted) return { layers: [], error: null };
    const on = new Set(wanted.split(","));
    return {
      layers: catalog
        .filter((entry) => on.has(entry.id) && times[entry.id])
        .map((entry) => ({
          product: entry.id,
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
          ),
          stops: entry.stops,
          ...(entry.categories ? { categories: entry.categories } : {}),
        })),
      error,
    };
  }, [catalog, error, highContrast, paletteGeneration, root, times, wanted]);
}

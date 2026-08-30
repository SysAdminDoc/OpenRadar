import { useEffect, useMemo, useState } from "react";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/settings";

/** A file lands every twenty seconds; asking once a minute is plenty. */
const REFRESH_MS = 60_000;

export interface Flash {
  latitude: number;
  longitude: number;
  energyJoules: number;
  areaSquareKm: number;
  time: number;
}

export interface FlashWindow {
  satellite: string;
  windowMinutes: number;
  observed: number;
  flashes: Flash[];
  trimmed: boolean;
}

export interface LightningState {
  /** The flashes as GeoJSON, ready for the map, or null when the layer is off. */
  points: Record<string, unknown> | null;
  window: FlashWindow | null;
  error: string | null;
}

/** GLM files are decoded natively, so a browser preview has none of this. */
export function lightningAvailable(): boolean {
  return isDesktopRuntime();
}

/**
 * The newest flash is drawn brightest, so a viewer can tell which way a storm
 * is moving from the trail behind it.
 */
export function flashPoints(window: FlashWindow): Record<string, unknown> {
  const newest = window.observed || window.flashes.at(-1)?.time || 0;
  const span = window.windowMinutes * 60;
  return {
    type: "FeatureCollection",
    features: window.flashes.map((flash) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [flash.longitude, flash.latitude],
      },
      properties: {
        // One at the newest end of the window, nearly nothing at the oldest.
        age:
          span > 0 ? Math.max(0, Math.min(1, (newest - flash.time) / span)) : 0,
      },
    })),
  };
}

export function useLightning(options: {
  ready: boolean;
  enabled: boolean;
  pageVisible: boolean;
}): LightningState {
  const { ready, enabled, pageVisible } = options;
  const [window_, setWindow] = useState<FlashWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wanted = ready && enabled && lightningAvailable();

  useEffect(() => {
    if (!wanted) return;
    let open = true;

    const refresh = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const next = await invoke<FlashWindow>("lightning_flashes");
        if (!open) return;
        setWindow(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The lightning feed did not answer.";
        log.warn("lightning", message);
        // A stale flash map is worse than none: lightning that has stopped is
        // exactly what a viewer needs to know about.
        setWindow(null);
        setError(message);
      }
    };

    void refresh();
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = globalThis.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      open = false;
      globalThis.clearInterval(timer);
    };
  }, [pageVisible, wanted]);

  return useMemo(
    () => ({
      points: wanted && window_ ? flashPoints(window_) : null,
      window: wanted ? window_ : null,
      error: wanted ? error : null,
    }),
    [error, wanted, window_],
  );
}

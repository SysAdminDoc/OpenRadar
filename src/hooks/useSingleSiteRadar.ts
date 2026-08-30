import { useEffect, useMemo, useRef, useState } from "react";
import {
  SWEEP_REFRESH_MS,
  fetchSweep,
  isSingleSiteViewport,
  level2Available,
  nearestSite,
  type Level2ProductId,
  type SweepImage,
} from "../lib/level2";
import { log } from "../lib/log";
import type { RadarSettings } from "../lib/settings";

export interface SingleSiteState {
  /** The sweep on the map, or null while the mosaic is still the picture. */
  sweep: SweepImage | null;
  /** The site being drawn or fetched, which the panel names. */
  station: string | null;
  loading: boolean;
  error: string | null;
  /** True while a single site is what the map should be showing. */
  active: boolean;
}

/**
 * Level II is a close-in view of one site. This decides which site that is,
 * asks the native side for the sweep, and keeps it fresh while the view stays
 * close in.
 */
export function useSingleSiteRadar(options: {
  ready: boolean;
  radar: RadarSettings;
  center: [number, number];
  zoom: number;
  pageVisible: boolean;
  /** Bumped when a colour table is loaded, so the sweep is drawn again. */
  paletteGeneration: number;
}): SingleSiteState {
  const { ready, radar, center, zoom, pageVisible, paletteGeneration } =
    options;
  // The site, and the coarse position it was resolved for. A site found for
  // somewhere else is not an answer to where the map is now, which is what
  // kept KDMX on screen over Bermuda.
  const [nearby, setNearby] = useState<{ site: string; near: string } | null>(
    null,
  );
  const [sweep, setSweep] = useState<SweepImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted =
    ready &&
    level2Available() &&
    radar.enabled &&
    radar.singleSite &&
    isSingleSiteViewport(zoom);

  // Panning within a site's coverage must not restart the fetch, so the site
  // is resolved from a coarse position rather than the exact centre.
  const near = `${center[0].toFixed(1)},${center[1].toFixed(1)}`;

  // A held site wins outright, so nothing has to be resolved or stored for it.
  const station = radar.station ?? (nearby?.near === near ? nearby.site : null);

  useEffect(() => {
    if (!wanted || radar.station) return;
    let open = true;
    const [lon, lat] = near.split(",").map(Number);
    void nearestSite(lon, lat)
      .then((found) => {
        // No answer means the view is outside every site's coverage, and the
        // position it was asked about is remembered either way so a later
        // view cannot inherit the answer.
        if (open) setNearby(found ? { site: found, near } : null);
      })
      .catch((failure: unknown) => {
        if (!open) return;
        log.warn(
          "radar",
          failure instanceof Error
            ? failure.message
            : "No radar site could be resolved.",
        );
      });
    return () => {
      open = false;
    };
  }, [near, radar.station, wanted]);

  // A reply that arrives after the view has moved on must not be drawn.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!wanted || !station) return;
    let open = true;
    const product: Level2ProductId = radar.product;

    const refresh = async () => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const next = await fetchSweep(
          station,
          product,
          radar.tilt,
          radar.dealias,
          radar.stormMotion
            ? [radar.stormMotion.speedMs, radar.stormMotion.fromDegrees]
            : null,
        );
        if (!open || request !== requestRef.current) return;
        setSweep(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open || request !== requestRef.current) return;
        // A Tauri command rejects with the string the error serialized to.
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The radar site did not answer.";
        log.warn("radar", `${station}: ${message}`);
        // The previous sweep is a different product, tilt, or moment. Leaving
        // it drawn under a label that now says something else is worse than
        // handing the map back to the mosaic.
        setSweep(null);
        setError(message);
      } finally {
        if (open && request === requestRef.current) setLoading(false);
      }
    };

    void refresh();
    // A hidden window keeps whatever it has rather than polling behind itself.
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = window.setInterval(() => void refresh(), SWEEP_REFRESH_MS);
    return () => {
      open = false;
      window.clearInterval(timer);
    };
    // A new colour table redraws the sweep, which is drawn natively.
  }, [
    pageVisible,
    paletteGeneration,
    radar.dealias,
    radar.product,
    radar.stormMotion,
    radar.tilt,
    station,
    wanted,
  ]);

  return useMemo(() => {
    // A sweep of a different site, product, or tilt is not an answer to the
    // question being asked now, whatever it was an answer to before.
    const asked =
      sweep !== null &&
      sweep.station === station &&
      sweep.tiltIndex === radar.tilt &&
      sweep.productId === radar.product;
    const current = wanted && asked ? sweep : null;
    return {
      sweep: current,
      station: wanted ? station : null,
      loading: Boolean(wanted && station && loading),
      error: wanted ? error : null,
      active: Boolean(current),
    };
  }, [error, loading, radar.product, radar.tilt, station, sweep, wanted]);
}

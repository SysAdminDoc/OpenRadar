import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_OVERLAY,
  OVERLAY_ADAPTERS,
  boundsContain,
  padBounds,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayId,
} from "../lib/overlays";

export interface OverlayState {
  data: OverlayData;
  fetchedAt: number | null;
  error: string | null;
}

export type OverlayStates = Record<OverlayId, OverlayState>;

export const IDLE_OVERLAY: OverlayState = {
  data: EMPTY_OVERLAY,
  fetchedAt: null,
  error: null,
};

const POLL_MS = 30_000;
/** Fetch half a viewport past the edges so a short pan needs no new request. */
const BOUNDS_PADDING = 0.5;

interface Coverage {
  bounds: OverlayBounds;
  at: number;
}

export function shouldRefetch(
  adapter: OverlayAdapter,
  coverage: Coverage | undefined,
  viewport: OverlayBounds,
  now: number,
): boolean {
  if (!coverage) return true;
  if (now - coverage.at >= adapter.refreshMs) return true;
  return !boundsContain(coverage.bounds, viewport);
}

function boundsKey(bounds: OverlayBounds | null): string {
  if (!bounds) return "";
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(2))
    .join(",");
}

export function useOverlays(
  enabled: Record<OverlayId, boolean>,
  viewport: OverlayBounds | null,
): OverlayStates {
  const [states, setStates] = useState<OverlayStates>(() => ({
    alerts: IDLE_OVERLAY,
    earthquakes: IDLE_OVERLAY,
    wildfires: IDLE_OVERLAY,
  }));
  const coverageRef = useRef<Partial<Record<OverlayId, Coverage>>>({});
  const controllersRef = useRef(new Map<OverlayId, AbortController>());

  const enabledKey = OVERLAY_ADAPTERS.map((adapter) =>
    enabled[adapter.id] ? adapter.id : "",
  ).join(",");
  const viewportKey = boundsKey(viewport);

  useEffect(() => {
    const controllers = controllersRef.current;
    const coverage = coverageRef.current;

    for (const adapter of OVERLAY_ADAPTERS) {
      if (enabled[adapter.id]) continue;
      controllers.get(adapter.id)?.abort();
      controllers.delete(adapter.id);
      delete coverage[adapter.id];
    }

    if (!viewport) return;
    const padded = padBounds(viewport, BOUNDS_PADDING);

    const run = () => {
      for (const adapter of OVERLAY_ADAPTERS) {
        if (!enabled[adapter.id]) continue;
        if (controllers.has(adapter.id)) continue;
        if (
          !shouldRefetch(adapter, coverage[adapter.id], viewport, Date.now())
        ) {
          continue;
        }

        const controller = new AbortController();
        controllers.set(adapter.id, controller);
        void adapter
          .fetchData(padded, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return;
            coverage[adapter.id] = { bounds: padded, at: Date.now() };
            setStates((current) => ({
              ...current,
              [adapter.id]: { data, fetchedAt: Date.now(), error: null },
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            const message =
              error instanceof Error ? error.message : "The request failed.";
            // The last good snapshot stays on the map; only the label changes.
            setStates((current) => ({
              ...current,
              [adapter.id]: { ...current[adapter.id], error: message },
            }));
          })
          .finally(() => {
            controllers.delete(adapter.id);
          });
      }
    };

    run();
    const timer = window.setInterval(run, POLL_MS);
    return () => window.clearInterval(timer);
    // The keys stand in for `enabled` and `viewport`, which are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, viewportKey]);

  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  // A disabled overlay reports nothing, so the map drops its layers without a
  // second render pass.
  return useMemo(
    () => ({
      alerts: enabled.alerts ? states.alerts : IDLE_OVERLAY,
      earthquakes: enabled.earthquakes ? states.earthquakes : IDLE_OVERLAY,
      wildfires: enabled.wildfires ? states.wildfires : IDLE_OVERLAY,
    }),
    [enabled.alerts, enabled.earthquakes, enabled.wildfires, states],
  );
}

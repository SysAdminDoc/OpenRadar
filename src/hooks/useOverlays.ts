import { useEffect, useMemo, useRef, useState } from "react";
import { log } from "../lib/log";
import {
  EMPTY_OVERLAY,
  OVERLAY_ADAPTERS,
  boundsContain,
  boundsOverlap,
  padBounds,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayId,
} from "../lib/overlays";

export interface OverlayState {
  data: OverlayData;
  /** The padded box the snapshot was fetched for, or null for a global feed. */
  bounds: OverlayBounds | null;
  fetchedAt: number | null;
  error: string | null;
}

export type OverlayStates = Record<OverlayId, OverlayState>;

export const IDLE_OVERLAY: OverlayState = {
  data: EMPTY_OVERLAY,
  bounds: null,
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
  // A worldwide feed already holds every feature, so panning changes nothing.
  if (adapter.global) return false;
  return !boundsContain(coverage.bounds, viewport);
}

/** A snapshot from somewhere else must not be drawn over the current view. */
export function coversViewport(
  adapter: OverlayAdapter,
  state: OverlayState,
  viewport: OverlayBounds | null,
): boolean {
  if (adapter.global || !state.bounds || !viewport) return true;
  return boundsOverlap(state.bounds, viewport);
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
    tropical: IDLE_OVERLAY,
    spcOutlooks: IDLE_OVERLAY,
    spcDiscussions: IDLE_OVERLAY,
  }));
  const coverageRef = useRef<Partial<Record<OverlayId, Coverage>>>({});
  const requestsRef = useRef(
    new Map<
      OverlayId,
      { controller: AbortController; bounds: OverlayBounds }
    >(),
  );

  const enabledKey = OVERLAY_ADAPTERS.map((adapter) =>
    enabled[adapter.id] ? adapter.id : "",
  ).join(",");
  const viewportKey = boundsKey(viewport);

  useEffect(() => {
    const requests = requestsRef.current;
    const coverage = coverageRef.current;

    for (const adapter of OVERLAY_ADAPTERS) {
      if (enabled[adapter.id]) continue;
      requests.get(adapter.id)?.controller.abort();
      requests.delete(adapter.id);
      delete coverage[adapter.id];
    }

    if (!viewport) return;
    const padded = padBounds(viewport, BOUNDS_PADDING);

    // A request issued for an area the user has left would stamp coverage with
    // the wrong box and leave the map showing somewhere else.
    for (const [id, request] of requests) {
      const adapter = OVERLAY_ADAPTERS.find((candidate) => candidate.id === id);
      if (!adapter || adapter.global) continue;
      if (boundsContain(request.bounds, viewport)) continue;
      request.controller.abort();
      requests.delete(id);
    }

    const run = () => {
      for (const adapter of OVERLAY_ADAPTERS) {
        if (!enabled[adapter.id]) continue;
        if (requests.has(adapter.id)) continue;
        if (
          !shouldRefetch(adapter, coverage[adapter.id], viewport, Date.now())
        ) {
          continue;
        }

        const controller = new AbortController();
        requests.set(adapter.id, { controller, bounds: padded });
        void adapter
          .fetchData(padded, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return;
            coverage[adapter.id] = { bounds: padded, at: Date.now() };
            setStates((current) => ({
              ...current,
              [adapter.id]: {
                data,
                bounds: adapter.global ? null : padded,
                fetchedAt: Date.now(),
                error: null,
              },
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            const message =
              error instanceof Error ? error.message : "The request failed.";
            log.warn("overlay", `${adapter.label} failed: ${message}`);
            // The last good snapshot stays on the map; only the label changes.
            setStates((current) => ({
              ...current,
              [adapter.id]: { ...current[adapter.id], error: message },
            }));
          })
          .finally(() => {
            // A newer request may already own the slot.
            if (requests.get(adapter.id)?.controller === controller) {
              requests.delete(adapter.id);
            }
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
    const requests = requestsRef.current;
    return () => {
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
    };
  }, []);

  // A disabled layer reports nothing, and so does a snapshot of somewhere the
  // user has already left, so the map drops both without a second render pass.
  return useMemo(() => {
    const visible = {} as OverlayStates;
    for (const adapter of OVERLAY_ADAPTERS) {
      const state = states[adapter.id];
      visible[adapter.id] =
        enabled[adapter.id] && coversViewport(adapter, state, viewport)
          ? state
          : IDLE_OVERLAY;
    }
    return visible;
  }, [enabled, states, viewport]);
}

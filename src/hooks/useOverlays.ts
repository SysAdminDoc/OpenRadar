import { useEffect, useMemo, useRef, useState } from "react";
import { isOnline, noteReached } from "../lib/online";
import { log } from "../lib/log";
import {
  EMPTY_OVERLAY,
  OVERLAY_ADAPTERS,
  boundsContain,
  boundsOverlap,
  padBounds,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayChoices,
  type OverlayData,
  type OverlayId,
} from "../lib/overlays";

export interface OverlayState {
  data: OverlayData;
  /** The padded box the snapshot was fetched for, or null for a global feed. */
  bounds: OverlayBounds | null;
  fetchedAt: number | null;
  error: string | null;
  /** What the layer drew without, when it drew something. See `OverlayData`. */
  partial: string | null;
  /**
   * Which question this answers.
   *
   * Beside the data rather than only in the coverage record, so a snapshot
   * that answers a question nobody is asking any more can be told apart
   * where the map is drawn rather than by writing state from an effect.
   */
  variant: string;
}

export type OverlayStates = Record<OverlayId, OverlayState>;

export const IDLE_OVERLAY: OverlayState = {
  data: EMPTY_OVERLAY,
  bounds: null,
  fetchedAt: null,
  error: null,
  partial: null,
  variant: "",
};

const POLL_MS = 30_000;
/** Fetch half a viewport past the edges so a short pan needs no new request. */
const BOUNDS_PADDING = 0.5;

interface Coverage {
  bounds: OverlayBounds;
  at: number;
  /** Which of several things the snapshot is of, for a layer that offers a choice. */
  variant: string;
}

export function shouldRefetch(
  adapter: OverlayAdapter,
  coverage: Coverage | undefined,
  viewport: OverlayBounds,
  now: number,
  choices: OverlayChoices,
): boolean {
  if (!coverage) return true;
  // Before freshness and before coverage: a snapshot of Day 1 is not a stale
  // Day 3, it is the wrong picture, and it would sit on the map until its
  // refresh came round.
  if (coverage.variant !== variantOf(adapter, choices)) return true;
  // A window that has already happened does not get newer. Without this a
  // parked replay asked the archive for the same fixed past afternoon every
  // five minutes for as long as the panel stayed open.
  const replaying = choices.replay !== null;
  if (!replaying && now - coverage.at >= adapter.refreshMs) return true;
  // A worldwide feed already holds every feature, so panning changes nothing.
  // The archive path is not one: it is asked by point and radius, so the box
  // matters there even for an adapter whose live feed covers the country.
  if (adapter.global && !replaying) return false;
  return !boundsContain(coverage.bounds, viewport);
}

/** What the adapter is drawing, or the empty string when it has no choice. */
export function variantOf(
  adapter: OverlayAdapter,
  choices: OverlayChoices,
): string {
  return adapter.variant?.(choices) ?? "";
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
  choices: OverlayChoices,
): OverlayStates {
  const [states, setStates] = useState<OverlayStates>(() => ({
    alerts: IDLE_OVERLAY,
    earthquakes: IDLE_OVERLAY,
    wildfires: IDLE_OVERLAY,
    smoke: IDLE_OVERLAY,
    metar: IDLE_OVERLAY,
    riverGauges: IDLE_OVERLAY,
    tropical: IDLE_OVERLAY,
    spcOutlooks: IDLE_OVERLAY,
    spcDiscussions: IDLE_OVERLAY,
    stormReports: IDLE_OVERLAY,
    wpcExcessiveRain: IDLE_OVERLAY,
    wpcWinterSeverity: IDLE_OVERLAY,
  }));
  const coverageRef = useRef<Partial<Record<OverlayId, Coverage>>>({});
  const requestsRef = useRef(
    new Map<
      OverlayId,
      { controller: AbortController; bounds: OverlayBounds; variant: string }
    >(),
  );

  const enabledKey = OVERLAY_ADAPTERS.map((adapter) =>
    enabled[adapter.id] ? adapter.id : "",
  ).join(",");
  const viewportKey = boundsKey(viewport);
  // A change here is a different picture rather than a stale one, so it goes
  // in the effect keys: waiting for the poll would leave the day the reader
  // just left on the map for up to half a minute.
  const variantKey = OVERLAY_ADAPTERS.map((adapter) =>
    variantOf(adapter, choices),
  ).join(",");

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
    // Per adapter, because one of them is asked for the screen exactly.
    const boxFor = (adapter: OverlayAdapter) =>
      padBounds(viewport, adapter.boundsPadding ?? BOUNDS_PADDING);

    // A request issued for an area the user has left would stamp coverage with
    // the wrong box and leave the map showing somewhere else. So would one
    // issued for a day they have since switched away from: the slot below is
    // skipped while a request is in flight, so a variant that changed
    // mid-request would have painted the old day under the new day's heading
    // and left it there until the next poll.
    for (const [id, request] of requests) {
      const adapter = OVERLAY_ADAPTERS.find((candidate) => candidate.id === id);
      if (!adapter) continue;
      if (request.variant !== variantOf(adapter, choices)) {
        request.controller.abort();
        requests.delete(id);
        continue;
      }
      // A worldwide feed's request stands whatever the camera does, except on
      // the archive path, which is asked by point and radius.
      if (adapter.global && choices.replay === null) continue;
      if (boundsContain(request.bounds, viewport)) continue;
      request.controller.abort();
      requests.delete(id);
    }

    const run = () => {
      // Nothing is asked for while there is no network. Every adapter kept
      // its own timer running and failing: a line in the log every thirty
      // seconds per switched-on layer, an error stamped over each one's last
      // good snapshot, and no way for a reader to tell "this service is
      // down" from "this machine is not connected". The snapshots stay on
      // the map either way; only the asking stops.
      if (!isOnline()) return;
      for (const adapter of OVERLAY_ADAPTERS) {
        if (!enabled[adapter.id]) continue;
        if (requests.has(adapter.id)) continue;
        if (
          !shouldRefetch(
            adapter,
            coverage[adapter.id],
            viewport,
            Date.now(),
            choices,
          )
        ) {
          continue;
        }

        const controller = new AbortController();
        const box = boxFor(adapter);
        // The question this request is being made for, read once: whatever
        // comes back answers this one and nothing later.
        const asking = variantOf(adapter, choices);
        requests.set(adapter.id, {
          controller,
          bounds: box,
          variant: asking,
        });
        void adapter
          .fetchData(box, controller.signal, choices)
          .then((data) => {
            if (controller.signal.aborted) return;
            // Something came back, which is the only thing that proves the
            // workspace can see. The browser's `online` event does not: a
            // laptop on a captive portal reports online and reaches nothing,
            // and clearing the line on it put a reader straight back into
            // polling and failing having just been told all was well.
            noteReached();
            coverage[adapter.id] = {
              bounds: box,
              at: Date.now(),
              variant: asking,
            };
            setStates((current) => ({
              ...current,
              [adapter.id]: {
                data,
                bounds: adapter.global ? null : box,
                fetchedAt: Date.now(),
                error: null,
                partial: data.partial ?? null,
                variant: asking,
              },
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            const message =
              error instanceof Error ? error.message : "The request failed.";
            log.warn("overlay", `${adapter.label} failed: ${message}`);
            // The last good snapshot stays on the map; only the label changes.
            // Unless it answers a different question, in which case there is
            // nothing left to keep: what is drawn is cleared where the map
            // reads the state, and the coverage goes so the next run asks.
            const held = coverage[adapter.id]?.variant;
            const stale = held !== undefined && held !== asking;
            if (stale) delete coverage[adapter.id];
            setStates((current) => ({
              ...current,
              [adapter.id]: stale
                ? { ...IDLE_OVERLAY, error: message, variant: asking }
                : // The note described the snapshot that just failed to be
                  // replaced, and the error is the newer statement. Keeping
                  // both would leave a note about an answer nobody has.
                  {
                    ...current[adapter.id],
                    error: message,
                    partial: null,
                    variant: asking,
                  },
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
    // And the first thing that happens when it comes back is an ask, rather
    // than up to thirty seconds of a map nobody has told about the network.
    window.addEventListener("online", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
    };
    // The keys stand in for `enabled` and `viewport`, which are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, variantKey, viewportKey]);

  useEffect(() => {
    const requests = requestsRef.current;
    return () => {
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
    };
  }, []);

  // A disabled layer reports nothing, and neither does a snapshot of
  // somewhere the reader has already left or of a day they have already left,
  // so the map drops all three without a second render pass.
  //
  // The day is the one that could not be settled anywhere else. Ending a
  // replay while the machine is offline changes the question and asks
  // nothing, because `run` returns before it makes a request, so the 2011
  // reports and outlook stayed drawn over the present until some later
  // request happened to succeed or fail. Nothing in an effect can clear it:
  // a `setState` in an effect body is rejected outright here. Comparing
  // during render is the same shape the rest of the app uses for "which
  // question does this answer".
  return useMemo(() => {
    const visible = {} as OverlayStates;
    for (const adapter of OVERLAY_ADAPTERS) {
      const state = states[adapter.id];
      visible[adapter.id] =
        enabled[adapter.id] &&
        state.variant === variantOf(adapter, choices) &&
        coversViewport(adapter, state, viewport)
          ? state
          : IDLE_OVERLAY;
    }
    return visible;
  }, [enabled, states, viewport, choices]);
}

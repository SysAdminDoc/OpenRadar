import { useEffect, useMemo, useRef, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/settings";

/** A file lands every twenty seconds; asking once a minute is plenty. */
export const REFRESH_MS = 60_000;

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
  /** True when the cap cut the window, so the legend can say so. */
  trimmed: boolean;
  /** How many of the window's files were read, and how many there were. */
  filesRead: number;
  filesExpected: number;
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
 * The flashes as the map draws them, each carrying when it happened.
 *
 * How old a flash is belongs to the clock, not to the collection, so it is not
 * worked out here. Ageing them at build time meant rebuilding the whole
 * collection and pushing it through setData on every tick of the clock, and
 * since the ages were measured against the fetch's own newest flash rather
 * than against now, the fade did not actually advance between fetches: the
 * same collection was uploaded again every minute to no effect. The layer
 * fades them from the clock instead, which is a repaint rather than a reload.
 */
export function flashPoints(window: FlashWindow): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: window.flashes.map((flash) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [flash.longitude, flash.latitude],
      },
      properties: {
        // Seconds, as the feed gives it.
        at: flash.time,
      },
    })),
  };
}

/**
 * How old each flash is now, as a fraction of the window it has used up.
 *
 * This is a MapLibre expression rather than a number because it is evaluated
 * per feature at draw time. Handing it to the layer as a paint property means
 * a tick of the clock is a repaint, not a reload of every flash on screen.
 *
 * `nowMs` is the clock in milliseconds; the feature's `at` is in seconds,
 * which is what the feed gives.
 */
export function flashAgeExpression(
  nowMs: number,
  windowMinutes: number,
): unknown {
  // A window of no length would divide by zero and paint every flash the same
  // colour with no way to tell which.
  const span = Math.max(1, windowMinutes * 60);
  return [
    "min",
    1,
    ["max", 0, ["/", ["-", nowMs / 1000, ["get", "at"]], span]],
  ];
}

/** The colour ramp, brightest at the newest end. */
export function flashColorExpression(
  nowMs: number,
  windowMinutes: number,
): unknown {
  return [
    "interpolate",
    ["linear"],
    flashAgeExpression(nowMs, windowMinutes),
    0,
    "#fef9c3",
    1,
    "#f59e0b",
  ];
}

/** The fade, from nearly solid to a faint trail behind the storm. */
export function flashOpacityExpression(
  nowMs: number,
  windowMinutes: number,
): unknown {
  return [
    "interpolate",
    ["linear"],
    flashAgeExpression(nowMs, windowMinutes),
    0,
    0.95,
    1,
    0.25,
  ];
}

export function useLightning(options: {
  ready: boolean;
  enabled: boolean;
  pageVisible: boolean;
  /**
   * Keep asking even while the window is hidden.
   *
   * True when the lightning watch is on. A watch that only works while
   * somebody is looking at the map is not a watch: the reader minimised the
   * window, or put it in the tray, precisely so it could tell them something
   * they were not watching for.
   */
  keepPollingWhileHidden?: boolean;
  /** Milliseconds, ticking once a minute, for judging what is still current. */
  clock: number;
}): LightningState {
  const {
    ready,
    enabled,
    pageVisible,
    keepPollingWhileHidden = false,
    clock,
  } = options;
  const [window_, setWindow] = useState<FlashWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Interval ticks and visibility changes share one native read. The command
  // cannot be aborted, so starting another one would let its older answer land
  // after the newer window.
  const inFlightRef = useRef<Promise<FlashWindow> | null>(null);

  const wanted = ready && enabled && lightningAvailable();

  useEffect(() => {
    if (!wanted) return;
    let open = true;
    let requestGeneration = 0;

    const loadWindow = () => {
      let pending = inFlightRef.current;
      if (!pending) {
        pending = import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke<FlashWindow>("lightning_flashes"),
        );
        inFlightRef.current = pending;
        void pending.then(
          () => {
            if (inFlightRef.current === pending) inFlightRef.current = null;
          },
          () => {
            if (inFlightRef.current === pending) inFlightRef.current = null;
          },
        );
      }
      return pending;
    };

    const refresh = async () => {
      const request = ++requestGeneration;
      try {
        const next = await loadWindow();
        if (!open || request !== requestGeneration) return;
        setWindow(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open || request !== requestGeneration) return;
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

    // The first ask, in the place it has always been: before the
    // visibility check below, so a hidden window still reads once.
    // Not with no network, where it is one more failure in the log.
    if (isOnline()) void refresh();

    if (!pageVisible && !keepPollingWhileHidden) {
      return () => {
        open = false;
        requestGeneration += 1;
      };
    }
    const stop = pollWhileOnline(() => void refresh(), REFRESH_MS, false);
    return () => {
      open = false;
      requestGeneration += 1;
      stop();
    };
  }, [keepPollingWhileHidden, pageVisible, wanted]);

  // Built once per fetch. What the map does with them changes every tick; what
  // they are does not.
  const points = useMemo(
    () => (window_ ? flashPoints(window_) : null),
    [window_],
  );

  return useMemo(() => {
    // A window is the picture only while it is recent. Switching the layer off
    // and back on half an hour later would otherwise redraw those flashes at
    // full brightness, and lightning that has stopped is exactly the thing a
    // viewer needs to be told about.
    const current =
      window_ &&
      clock - window_.observed * 1000 < (window_.windowMinutes + 5) * 60_000
        ? window_
        : null;
    return {
      points: wanted && current ? points : null,
      window: wanted ? current : null,
      error: wanted ? error : null,
    };
    // The points themselves are built from the window alone, above, so a tick
    // of the clock can decide the window is too old to draw without rebuilding
    // every flash in it.
  }, [clock, error, points, wanted, window_]);
}

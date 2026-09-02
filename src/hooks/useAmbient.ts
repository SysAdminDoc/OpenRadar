import { useEffect, useRef, useState } from "react";
import { metarOverlay } from "../lib/overlays/metar";
import { haversineMiles } from "../lib/geo";
import { log } from "../lib/log";
import { ambientObservation, type AmbientObservation } from "../lib/ambient";

/**
 * How often the station is asked, which is not often.
 *
 * A routine METAR is hourly. Ten minutes catches a special within ten minutes
 * of it being issued and costs six requests an hour, against a layer that
 * asks once a minute while it is on screen.
 */
const POLL_MS = 10 * 60_000;

/** How far around the watched place to look for a station, in degrees. */
const BOX_DEGREES = 0.75;

/** Frames a second the window has to manage for the effect to stay on. */
const FLOOR_FPS = 30;

/** How long each measurement runs, and how many bad ones end it. */
const SAMPLE_MS = 4000;
const STRIKES = 2;

export interface AmbientState {
  /** The observation the chrome is drawing, or null for a plain workspace. */
  seen: AmbientObservation | null;
  /**
   * True when the window could not keep up and the effect took itself off.
   *
   * Sticky for the session. A decorative animation that costs the radar loop
   * its frame budget is a bug wearing a costume, and one that comes back the
   * moment the machine recovers is the same bug with a stutter.
   */
  dropped: boolean;
}

/**
 * The weather where the reader watches, for the treatment on the chrome.
 *
 * Off until asked for. When it is on it does three things and no more: it
 * reads the nearest station every ten minutes, it forgets what it read once
 * the report is too old to speak for the present, and it measures whether the
 * window is keeping up and stands itself down if it is not.
 */
export function useAmbient(options: {
  enabled: boolean;
  center: [number, number];
  /** Milliseconds, ticking once a minute, so staleness is noticed. */
  clock: number;
  /** Motion is the whole effect, so this decides whether it runs at all. */
  reducedMotion: boolean;
  /**
   * How long each frame-rate measurement runs.
   *
   * A budget rather than a detail: shorten it and the effect gives up sooner,
   * lengthen it and a passing stall is forgiven. Four seconds is long enough
   * that one slow second does not end it and short enough that a window which
   * has stopped painting is noticed inside ten.
   */
  sampleMs?: number;
}): AmbientState {
  const { enabled, clock, reducedMotion, sampleMs = SAMPLE_MS } = options;
  const [lon, lat] = options.center;
  const [report, setReport] = useState<{
    raw: string;
    station: string;
    observed: number | null;
  } | null>(null);
  const [dropped, setDropped] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReport(null);
      return;
    }
    const controller = new AbortController();
    let live = true;

    const read = async () => {
      try {
        const data = await metarOverlay.fetchData(
          {
            west: lon - BOX_DEGREES,
            south: lat - BOX_DEGREES,
            east: lon + BOX_DEGREES,
            north: lat + BOX_DEGREES,
          },
          controller.signal,
        );
        if (!live) return;
        let best: (typeof data.features)[number] | null = null;
        let nearest = Number.POSITIVE_INFINITY;
        for (const feature of data.features) {
          const [stationLon, stationLat] = feature.geometry.coordinates as [
            number,
            number,
          ];
          const away = haversineMiles(
            { lon, lat },
            { lon: stationLon, lat: stationLat },
          );
          if (away < nearest) {
            nearest = away;
            best = feature;
          }
        }
        setReport(
          best
            ? {
                raw: String(best.properties.raw ?? ""),
                station: String(best.properties.id ?? ""),
                // The service publishes the observation time in seconds.
                observed:
                  typeof best.properties.observed === "number"
                    ? best.properties.observed * 1000
                    : null,
              }
            : null,
        );
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        // A station that cannot be reached is a plain workspace, not an error
        // in front of somebody: this is decoration.
        log.info(
          "ambient",
          failure instanceof Error ? failure.message : "No station answered.",
        );
        setReport(null);
      }
    };

    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [enabled, lat, lon]);

  const seen =
    enabled && !dropped && report
      ? ambientObservation(report.raw, report.observed, report.station, clock)
      : null;

  // Measured rather than assumed. The effect is CSS and should cost nothing,
  // and "should" is not a budget: this counts frames while it is on screen
  // and takes it off if the window is not keeping up.
  const running = Boolean(seen) && !reducedMotion;
  const strikesRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    let frames = 0;
    let handle = requestAnimationFrame(function tick() {
      frames += 1;
      handle = requestAnimationFrame(tick);
    });
    const timer = window.setInterval(() => {
      const fps = (frames * 1000) / sampleMs;
      frames = 0;
      if (fps >= FLOOR_FPS) {
        strikesRef.current = 0;
        return;
      }
      strikesRef.current += 1;
      if (strikesRef.current < STRIKES) return;
      log.info(
        "ambient",
        `The window managed ${Math.round(fps)} frames a second, so the ambient effect stopped.`,
      );
      setDropped(true);
    }, sampleMs);
    return () => {
      cancelAnimationFrame(handle);
      window.clearInterval(timer);
    };
  }, [running, sampleMs]);

  return { seen, dropped };
}

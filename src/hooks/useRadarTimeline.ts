import { useEffect, useMemo, useRef, useState } from "react";
import {
  coverageKey,
  fetchHrrrRun,
  fetchRadarTimeline,
  hrrrFrames,
  isConusViewport,
  recordFailure,
  recordSuccess,
  type HrrrRun,
  type RadarProvider,
} from "../lib/providers";
import { log } from "../lib/log";
import { animationIntervalMs, type RadarFrame } from "../lib/radar";

const REFRESH_MS = 5 * 60_000;
/** Always fetch the longest loop so changing the setting needs no new request. */
export const MAX_LOOP_MINUTES = 120;

export interface RadarTimelineState {
  frames: RadarFrame[];
  frameIndex: number;
  playing: boolean;
  source: RadarProvider | null;
  error: string | null;
  /** The newest observation, which is what staleness is measured against. */
  newestObserved: RadarFrame | undefined;
  setPlaying: (playing: boolean) => void;
  selectFrame: (index: number) => void;
}

export function framesWithinLoop(
  frames: RadarFrame[],
  loopMinutes: number,
): RadarFrame[] {
  const newest = frames.at(-1)?.time ?? 0;
  const cutoff = newest - loopMinutes * 60;
  return frames.filter((frame) => frame.time >= cutoff);
}

/**
 * A refresh must not yank the playhead away from a frame the user is looking
 * at. It only jumps to the newest frame while playing, when the user was
 * already on the newest frame, or when the frame they had is gone.
 */
export function nextSelection(
  previous: RadarFrame[],
  selected: number | null,
  incoming: RadarFrame[],
  playing: boolean,
): number | null {
  // Following the newest frame means the newest observation. A forecast tail is
  // hours ahead by design, and jumping there mid-loop is not "following live".
  const observed = incoming.filter((frame) => !frame.forecast);
  const newest = (observed.at(-1) ?? incoming.at(-1))?.time ?? null;
  if (selected === null || playing) return newest;
  if (previous.filter((frame) => !frame.forecast).at(-1)?.time === selected) {
    return newest;
  }
  return incoming.some((frame) => frame.time === selected) ? selected : newest;
}

/**
 * When the selected frame disappears, the nearest surviving time is far less
 * jarring than jumping to whichever end of the loop happens to be last.
 */
export function nearestFrameIndex(
  frames: RadarFrame[],
  selected: number | null,
): number {
  if (!frames.length) return 0;
  if (selected === null) return frames.length - 1;

  let bestIndex = frames.length - 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, frame] of frames.entries()) {
    if (frame.time === selected) return index;
    const distance = Math.abs(frame.time - selected);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function useRadarTimeline(options: {
  ready: boolean;
  center: [number, number];
  loopMinutes: number;
  animationSpeed: number;
  futureRadar: boolean;
  pageVisible: boolean;
}): RadarTimelineState {
  const {
    ready,
    center,
    loopMinutes,
    animationSpeed,
    futureRadar,
    pageVisible,
  } = options;
  const [observed, setObserved] = useState<RadarFrame[]>([]);
  const [run, setRun] = useState<HrrrRun | null>(null);
  const [source, setSource] = useState<RadarProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Panning inside one provider's footprint must not refetch, so the effect
  // keys on the covering chain rather than the raw center.
  const coverage = coverageKey(center[0], center[1]);
  // HRRR reflectivity covers the lower forty-eight only, so Alaska, Hawaii,
  // Puerto Rico, and Guam get no forecast tail even though NOAA radar reaches
  // them.
  const inModelDomain = isConusViewport(center[0], center[1]);
  const newestObservedTime = observed.at(-1)?.time ?? 0;

  const forecast = useMemo(
    () =>
      // The tail is only meaningful next to an observation, and recomputing it
      // from the newest one means it can never open a gap or double back over a
      // frame that has since been observed.
      run && futureRadar && inModelDomain && newestObservedTime
        ? hrrrFrames(run, newestObservedTime)
        : [],
    [futureRadar, inModelDomain, newestObservedTime, run],
  );

  // What a refresh needs to know without re-subscribing on every change.
  const liveRef = useRef({ selected, playing, center, forecast, observed });
  useEffect(() => {
    liveRef.current = { selected, playing, center, forecast, observed };
  }, [center, forecast, observed, playing, selected]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let mounted = true;

    const refresh = async () => {
      try {
        const timeline = await fetchRadarTimeline(
          liveRef.current.center,
          MAX_LOOP_MINUTES,
          controller.signal,
        );
        if (!mounted) return;
        const live = liveRef.current;
        // The playhead may be sitting on a forecast frame, which this refresh
        // does not replace, so both halves take part in the decision.
        const kept = nextSelection(
          [...live.observed, ...live.forecast],
          live.selected,
          [...timeline.frames, ...live.forecast],
          live.playing,
        );
        liveRef.current = {
          ...live,
          observed: timeline.frames,
          selected: kept,
        };
        setSource(timeline.provider);
        setError(null);
        setObserved(timeline.frames);
        setSelected(kept);
      } catch (failure) {
        if (
          !mounted ||
          (failure instanceof DOMException && failure.name === "AbortError")
        ) {
          return;
        }
        log.error(
          "radar",
          failure instanceof Error
            ? failure.message
            : "The radar request failed",
        );
        setError("Radar temporarily unavailable");
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [ready, coverage]);

  useEffect(() => {
    if (!ready || !futureRadar || !inModelDomain) return;
    const controller = new AbortController();
    let mounted = true;

    const refresh = async () => {
      try {
        const next = await fetchHrrrRun(controller.signal);
        if (!mounted) return;
        setRun(next);
        // The run index carries no frames of its own; the tail is derived.
        recordSuccess("hrrr", 0);
      } catch (failure) {
        if (
          !mounted ||
          (failure instanceof DOMException && failure.name === "AbortError")
        ) {
          return;
        }
        const message =
          failure instanceof Error ? failure.message : "The request failed.";
        recordFailure("hrrr", message);
        log.warn("radar", `Future radar failed: ${message}`);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [futureRadar, inModelDomain, ready]);

  // The loop window applies to what has been observed. Forecast frames extend
  // the tail, so they must not drag the cutoff forward with them.
  const frames = useMemo(
    () => [...framesWithinLoop(observed, loopMinutes), ...forecast],
    [forecast, loopMinutes, observed],
  );

  const frameIndex = useMemo(
    () => nearestFrameIndex(frames, selected),
    [frames, selected],
  );

  useEffect(() => {
    if (!playing || !pageVisible || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setSelected((current) => {
        const index = nearestFrameIndex(frames, current);
        return frames[(index + 1) % frames.length].time;
      });
    }, animationIntervalMs(animationSpeed));
    return () => window.clearInterval(timer);
  }, [animationSpeed, frames, pageVisible, playing]);

  const newestObserved = observed.at(-1);

  return useMemo(
    () => ({
      frames,
      frameIndex,
      playing,
      source,
      error,
      newestObserved,
      setPlaying,
      selectFrame: (index: number) => {
        const frame = frames[index];
        if (!frame) return;
        setPlaying(false);
        setSelected(frame.time);
      },
    }),
    [error, frameIndex, frames, newestObserved, playing, source],
  );
}

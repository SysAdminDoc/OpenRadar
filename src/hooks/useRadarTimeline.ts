import { useEffect, useMemo, useRef, useState } from "react";
import {
  coverageKey,
  fetchRadarTimeline,
  type RadarProvider,
} from "../lib/providers";
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
  const newest = incoming.at(-1)?.time ?? null;
  if (selected === null || playing) return newest;
  if (previous.at(-1)?.time === selected) return newest;
  return incoming.some((frame) => frame.time === selected) ? selected : newest;
}

export function useRadarTimeline(options: {
  ready: boolean;
  center: [number, number];
  loopMinutes: number;
  animationSpeed: number;
  pageVisible: boolean;
}): RadarTimelineState {
  const { ready, center, loopMinutes, animationSpeed, pageVisible } = options;
  const [allFrames, setAllFrames] = useState<RadarFrame[]>([]);
  const [source, setSource] = useState<RadarProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // What a refresh needs to know without re-subscribing on every change.
  const liveRef = useRef({ frames: allFrames, selected, playing, center });
  useEffect(() => {
    liveRef.current = { frames: allFrames, selected, playing, center };
  }, [allFrames, selected, playing, center]);

  // Panning inside one provider's footprint must not refetch, so the effect
  // keys on the covering chain rather than the raw center.
  const coverage = coverageKey(center[0], center[1]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let mounted = true;

    const refresh = async () => {
      const live = liveRef.current;
      try {
        const timeline = await fetchRadarTimeline(
          live.center,
          MAX_LOOP_MINUTES,
          controller.signal,
        );
        if (!mounted) return;
        const kept = nextSelection(
          liveRef.current.frames,
          liveRef.current.selected,
          timeline.frames,
          liveRef.current.playing,
        );
        liveRef.current = {
          ...liveRef.current,
          frames: timeline.frames,
          selected: kept,
        };
        setSource(timeline.provider);
        setError(null);
        setAllFrames(timeline.frames);
        setSelected(kept);
      } catch (failure) {
        if (
          !mounted ||
          (failure instanceof DOMException && failure.name === "AbortError")
        ) {
          return;
        }
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

  const frames = useMemo(
    () => framesWithinLoop(allFrames, loopMinutes),
    [allFrames, loopMinutes],
  );

  const frameIndex = useMemo(() => {
    if (!frames.length) return 0;
    const index = frames.findIndex((frame) => frame.time === selected);
    return index >= 0 ? index : frames.length - 1;
  }, [frames, selected]);

  useEffect(() => {
    if (!playing || !pageVisible || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setSelected((current) => {
        const index = frames.findIndex((frame) => frame.time === current);
        return frames[(index + 1) % frames.length].time;
      });
    }, animationIntervalMs(animationSpeed));
    return () => window.clearInterval(timer);
  }, [animationSpeed, frames, pageVisible, playing]);

  return useMemo(
    () => ({
      frames,
      frameIndex,
      playing,
      source,
      error,
      setPlaying,
      selectFrame: (index: number) => {
        const frame = frames[index];
        if (!frame) return;
        setPlaying(false);
        setSelected(frame.time);
      },
    }),
    [error, frameIndex, frames, playing, source],
  );
}

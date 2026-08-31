import {
  useSyncExternalStore,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isOnline, isOnlineOnServer, subscribeOnline } from "../lib/online";
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
import { setMrmsHighContrast, setMrmsThreshold } from "../lib/providers/mrms";
import { useHighContrast } from "./useClock";
import { animationIntervalMs, type RadarFrame } from "../lib/radar";
import { translate } from "../i18n";

export interface ArchiveReplay {
  /** Identifies the replay, so selecting the same one twice changes nothing. */
  id: string;
  label: string;
  attributionUrl: string;
  frames: RadarFrame[];
  /** The moment the replay is about, which is where the playhead starts. */
  focusTime: number;
}

interface Selection {
  time: number | null;
  /** The replay the time was picked in, or null for the live loop. */
  replay: string | null;
}

const REFRESH_MS = 5 * 60_000;
/** Always fetch the longest loop so changing the setting needs no new request. */
export const MAX_LOOP_MINUTES = 120;

export interface RadarTimelineState {
  frames: RadarFrame[];
  frameIndex: number;
  playing: boolean;
  source: RadarProvider | null;
  /** What the timeline says it is showing, live provider or archive. */
  sourceLabel: string | null;
  /** The credit for whoever served the frames on screen. */
  attribution: { label: string; url: string } | null;
  error: string | null;
  /**
   * True while the loop on screen is the last one that arrived rather than a
   * fresh one. The frames are still worth showing, but the user has to be told
   * they are not live.
   */
  cached: boolean;
  /** How old the served bytes were, in seconds, or null for a live fetch. */
  cachedAgeSeconds: number | null;
  /**
   * When these frames reached this machine, in milliseconds.
   *
   * Not the moment somebody asks about them. A provenance record that used
   * the time of the question said every picture had arrived just now, which
   * made staleness unmeasurable and an offline export look live.
   */
  fetchedAt: number;
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
  /** Frames from a past event, which stand in for the live loop while set. */
  archive?: ArchiveReplay | null;
  /** Bumped when a colour table is loaded, so locally drawn tiles refresh. */
  paletteGeneration?: number;
  /**
   * Hide anything below this in the mosaic, in dBZ. Part of the tile address,
   * so a change means asking for every frame again.
   */
  mosaicThreshold?: number | null;
}): RadarTimelineState {
  const {
    ready,
    center,
    loopMinutes,
    animationSpeed,
    futureRadar,
    pageVisible,
    archive = null,
    paletteGeneration = 0,
    mosaicThreshold = null,
  } = options;
  // The provider builds its own tile addresses inside fetchFrames, where no
  // argument of ours reaches, so this is put where it can read it before the
  // effect below asks for frames.
  setMrmsThreshold(mosaicThreshold);
  // The same goes for the ramp: the mosaic tiles are drawn on this machine,
  // so asking for more contrast is asking for a different picture.
  const highContrast = useHighContrast();
  setMrmsHighContrast(highContrast);
  const [observed, setObserved] = useState<RadarFrame[]>([]);
  const [run, setRun] = useState<HrrrRun | null>(null);
  const [source, setSource] = useState<RadarProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshFailed, setLastRefreshFailed] = useState(false);
  // Set from the age the native side reports on a reply it served from disk,
  // which is the only thing here that actually knows where the bytes came
  // from. Guessing from navigator.onLine misses a captive portal and a dead
  // service, both of which look online and both of which come off the cache.
  // How old the bytes were when the disk served them, or null for a live
  // fetch. Kept as the age rather than reduced to a flag, because "the picture
  // came off the disk" and "the picture is forty minutes old" are different
  // things to tell somebody, and the second is the one they asked about.
  const [cachedAgeSeconds, setCachedAgeSeconds] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const servedFromCache = cachedAgeSeconds !== null;
  const refreshRef = useRef<(() => void) | null>(null);
  const wasOfflineRef = useRef(false);
  // A machine with no network is showing the last view whether or not the most
  // recent refresh happened to fail: the tiles under it came off the disk.
  const online = useSyncExternalStore(
    subscribeOnline,
    isOnline,
    isOnlineOnServer,
  );
  const cached = lastRefreshFailed || servedFromCache || !online;
  // The playhead remembers which loop it was set in. A time picked in one
  // replay says nothing about where to sit in another, or back on live radar,
  // so a selection from a different loop is simply ignored rather than having
  // to be cleared out by an effect.
  const [selection, setSelection] = useState<Selection>({
    time: null,
    replay: null,
  });
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

  // Entering a replay puts the playhead on the moment it is about; leaving one
  // puts it back on the newest live frame.
  const replayId = archive?.id ?? null;
  const selected =
    selection.replay === replayId
      ? selection.time
      : (archive?.focusTime ?? null);

  // What a refresh needs to know without re-subscribing on every change.
  const liveRef = useRef({
    selected,
    playing,
    center,
    forecast,
    observed,
    replayId,
  });
  useEffect(() => {
    liveRef.current = {
      selected,
      playing,
      center,
      forecast,
      observed,
      replayId,
    };
  }, [center, forecast, observed, playing, replayId, selected]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let mounted = true;
    let requestGeneration = 0;

    const refresh = async () => {
      const request = ++requestGeneration;
      try {
        const timeline = await fetchRadarTimeline(
          liveRef.current.center,
          MAX_LOOP_MINUTES,
          controller.signal,
        );
        if (!mounted || request !== requestGeneration) return;
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
        setLastRefreshFailed(false);
        setCachedAgeSeconds(timeline.cachedAgeSeconds);
        setFetchedAt(Date.now());
        setObserved(timeline.frames);
        // A refresh only ever decides where the live loop should sit. While a
        // replay is up it must leave the playhead alone: writing to the live
        // selection would make the replay's own selection look stale and throw
        // the viewer back to the moment they started from.
        setSelection((current) =>
          live.replayId === null ? { time: kept, replay: null } : current,
        );
      } catch (failure) {
        if (
          !mounted ||
          request !== requestGeneration ||
          (failure instanceof DOMException && failure.name === "AbortError")
        ) {
          return;
        }
        log.error(
          "radar",
          failure instanceof Error
            ? failure.message
            : translate("radar.requestFailed"),
        );
        // Frames already on screen are worth more than an error message in
        // their place. They came from the cache or from the last refresh that
        // worked, and either way the map still shows weather; it just has to
        // say so rather than passing them off as live.
        if (liveRef.current.observed.length) {
          setLastRefreshFailed(true);
          setError(null);
        } else {
          setLastRefreshFailed(false);
          setError(translate("radar.unavailable"));
        }
      }
    };

    void refresh();
    // Held so a reconnection can ask for a fresh loop straight away rather
    // than waiting out the rest of the interval. Five minutes of stale radar
    // labelled as live is exactly what the label exists to prevent.
    refreshRef.current = () => void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      mounted = false;
      requestGeneration += 1;
      refreshRef.current = null;
      controller.abort();
      window.clearInterval(timer);
    };
    // A new colour table, a new threshold, or a new ramp means the locally
    // drawn tiles have to be asked for again under their new address.
  }, [ready, coverage, paletteGeneration, mosaicThreshold, highContrast]);

  // A machine that has just found the network again has a loop on screen
  // that is at least as old as the outage. Asking again now is the difference
  // between coming back within a second and coming back within five minutes.
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    refreshRef.current?.();
  }, [online]);

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
    () =>
      archive
        ? archive.frames
        : [...framesWithinLoop(observed, loopMinutes), ...forecast],
    [archive, forecast, loopMinutes, observed],
  );

  const frameIndex = useMemo(
    () => nearestFrameIndex(frames, selected),
    [frames, selected],
  );

  useEffect(() => {
    if (!playing || !pageVisible || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setSelection((current) => {
        const at =
          current.replay === replayId
            ? current.time
            : (archive?.focusTime ?? null);
        const index = nearestFrameIndex(frames, at);
        return {
          time: frames[(index + 1) % frames.length].time,
          replay: replayId,
        };
      });
    }, animationIntervalMs(animationSpeed));
    return () => window.clearInterval(timer);
  }, [
    animationSpeed,
    archive?.focusTime,
    frames,
    pageVisible,
    playing,
    replayId,
  ]);

  // Staleness is about the live feed. A replay is old on purpose, so it must
  // not be measured against the clock.
  const newestObserved = archive ? undefined : observed.at(-1);
  const attribution = useMemo(
    () =>
      archive
        ? { label: archive.label, url: archive.attributionUrl }
        : source
          ? { label: source.label, url: source.attributionUrl }
          : null,
    [archive, source],
  );
  const sourceLabel = attribution?.label ?? null;

  return useMemo(
    () => ({
      frames,
      frameIndex,
      playing,
      source,
      sourceLabel,
      attribution,
      error,
      cached,
      cachedAgeSeconds,
      fetchedAt,
      newestObserved,
      setPlaying,
      selectFrame: (index: number) => {
        const frame = frames[index];
        if (!frame) return;
        setPlaying(false);
        setSelection({ time: frame.time, replay: replayId });
      },
    }),
    [
      attribution,
      cached,
      cachedAgeSeconds,
      fetchedAt,
      error,
      frameIndex,
      frames,
      newestObserved,
      playing,
      replayId,
      source,
      sourceLabel,
    ],
  );
}

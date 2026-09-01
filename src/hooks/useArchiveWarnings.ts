import { useEffect, useMemo, useState } from "react";
import {
  archiveCoverage,
  archiveWarningsAt,
  archiveWarningsUrl,
  parseArchiveWarnings,
  type ArchiveCoverage,
} from "../lib/archiveWarnings";
import { log } from "../lib/log";
import type { OverlayData } from "../lib/overlays";
import { cachedUrl } from "../lib/tileCache";
import { translate } from "../i18n";
import type { ArchiveReplay } from "./useRadarTimeline";

export interface ArchiveWarnings {
  /** The polygons in force at the frame on screen, or null when there is no replay. */
  data: OverlayData | null;
  /** What the archive can say about the period being replayed. */
  coverage: ArchiveCoverage;
  /** Shown where a layer note goes, when the archive could not answer. */
  error: string | null;
}

/**
 * What was fetched, and which replay it belongs to.
 *
 * Kept together rather than in two pieces, so a frame from a new replay can
 * never be filtered against the last one's polygons. It also means the effect
 * clears nothing on the way in: everything the render reads is compared
 * against the replay it is for, and an answer for a replay that is no longer
 * on screen is simply not the one that matches.
 */
interface Loaded {
  id: string;
  data: OverlayData | null;
  error: string | null;
}

/**
 * The warnings that were in force while an archived storm was on the map.
 *
 * One request for the whole replay window, then a filter per frame. A replay
 * is a few dozen frames the reader scrubs back and forth through, and the
 * archive answers a six-hour window in one response, so asking per frame would
 * be a request every time the playhead moved: slower for the reader and rude
 * to a service that publishes for nothing.
 */
export function useArchiveWarnings(options: {
  replay: ArchiveReplay | null;
  /** The time on screen, in seconds, as radar frames carry it. */
  frameTime: number | null;
}): ArchiveWarnings {
  const { replay, frameTime } = options;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const window = useMemo(() => {
    if (!replay?.frames.length) return null;
    return {
      id: replay.id,
      from: replay.frames[0].time * 1000,
      to: replay.frames[replay.frames.length - 1].time * 1000,
    };
  }, [replay]);

  const coverage = window ? archiveCoverage(window.from) : "full";

  useEffect(() => {
    // Nothing to ask for, and nothing to clear: what is held is keyed to the
    // replay it came from, so it stops matching on its own.
    if (!window || archiveCoverage(window.from) === "none") return;

    let mounted = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          cachedUrl(archiveWarningsUrl(window.from, window.to)),
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) {
          throw new Error(`the archive returned ${response.status}`);
        }
        const data = parseArchiveWarnings(await response.json());
        if (!mounted) return;
        setLoaded({ id: window.id, data, error: null });
      } catch (failure) {
        if (!mounted || controller.signal.aborted) return;
        log.warn(
          "alerts",
          failure instanceof Error ? failure.message : "the archive failed",
        );
        // The radar is the point of a replay and it is already on screen, so
        // this is a note beside the layer rather than anything louder.
        setLoaded({
          id: window.id,
          data: null,
          error: translate("replay.warningsUnavailable"),
        });
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [window]);

  // Only an answer for the replay on screen counts, which is what makes the
  // effect's lack of a reset safe.
  const held = window && loaded?.id === window.id ? loaded : null;

  const data = useMemo(
    () =>
      held && frameTime !== null
        ? archiveWarningsAt(held.data, frameTime * 1000)
        : null,
    [held, frameTime],
  );

  return { data, coverage, error: held?.error ?? null };
}

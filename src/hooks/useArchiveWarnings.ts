import { useEffect, useMemo, useState } from "react";
import {
  archiveCoverage,
  archiveTagsUrl,
  archiveWarningsAt,
  ARCHIVE_REQUIRED_URLS,
  archiveWarningsUrls,
  parseArchiveTags,
  parseArchiveWarnings,
  type ArchiveCoverage,
} from "../lib/archiveWarnings";
import { log } from "../lib/log";
import type { OverlayData } from "../lib/overlays";
import { cachedUrl } from "../lib/tileCache";
import { translate } from "../i18n";
import type { ArchiveReplay } from "./useRadarTimeline";

export interface ArchiveWarnings {
  /** The polygons in force at the frame on screen, or null when there is none. */
  data: OverlayData | null;
  /** What the archive can say about the period being replayed. */
  coverage: ArchiveCoverage;
  /** True while the window is being fetched, so nothing reports an empty sky. */
  loading: boolean;
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
  key: string;
  data: OverlayData | null;
  error: string | null;
}

/**
 * The warnings that were in force while an archived storm was on the map.
 *
 * Two requests for the whole replay window, then a filter per frame. A replay
 * is a few dozen frames the reader scrubs back and forth through, and asking
 * per frame would be a request every time the playhead moved: slower for the
 * reader and rude to a service that publishes for nothing.
 */
export function useArchiveWarnings(options: {
  replay: ArchiveReplay | null;
  /** False when the reader has the warnings layer switched off. */
  enabled: boolean;
  /** The time on screen, in seconds, as radar frames carry it. */
  frameTime: number | null;
}): ArchiveWarnings {
  const { replay, enabled, frameTime } = options;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const window = useMemo(() => {
    if (!replay?.frames.length) return null;
    const from = replay.frames[0].time * 1000;
    const to = replay.frames[replay.frames.length - 1].time * 1000;
    // Keyed by what is actually being asked for rather than by the replay
    // object, which is rebuilt on every selection: choosing the same storm
    // twice asks the same question and should not ask it again.
    return { key: `${from}:${to}`, from, to };
  }, [replay]);

  const coverage = window ? archiveCoverage(window.from) : "full";
  const wanted = Boolean(window) && enabled && coverage !== "none";

  useEffect(() => {
    // Nothing to ask for, and nothing to clear: what is held is keyed to the
    // window it came from, so it stops matching on its own.
    if (!window || !wanted) return;

    let mounted = true;
    const controller = new AbortController();
    const ask = async (url: string) => {
      const response = await fetch(cachedUrl(url), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`the archive returned ${response.status}`);
      }
      return response.json();
    };

    void (async () => {
      try {
        // The polygons are the feature and the tags are what an office added
        // to them, so a tag feed that fails is a warning drawn without its
        // damage threat rather than no warning at all.
        // The first request is the short window and carries most of what is
        // in force at any frame; the rest are the flood products, which are a
        // second and a third request because the service filters on at most
        // two phenomena at a time. One of those failing is a class of warning
        // missing rather than a map with nothing on it, so it fails with a
        // note beside the layer and the polygons still draw. Letting it take
        // the whole layer down would be worse than the bug this replaced.
        const urls = archiveWarningsUrls(window.from, window.to);
        let short = 0;
        const [polygons, tags] = await Promise.all([
          Promise.all(
            urls.map((url, at) =>
              at < ARCHIVE_REQUIRED_URLS
                ? ask(url)
                : ask(url).catch(() => {
                    short += 1;
                    return null;
                  }),
            ),
          ),
          ask(archiveTagsUrl(window.from, window.to)).catch(() => null),
        ]);
        if (!mounted) return;
        setLoaded({
          key: window.key,
          data: parseArchiveWarnings(polygons, parseArchiveTags(tags)),
          error: short ? translate("replay.warningsSome") : null,
        });
      } catch (failure) {
        if (!mounted || controller.signal.aborted) return;
        log.warn(
          "alerts",
          failure instanceof Error ? failure.message : "the archive failed",
        );
        // The radar is the point of a replay and it is already on screen, so
        // this is a note beside the layer rather than anything louder.
        setLoaded({
          key: window.key,
          data: null,
          error: translate("replay.warningsUnavailable"),
        });
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [window, wanted]);

  // Only an answer for the window on screen counts, which is what makes the
  // effect's lack of a reset safe. `wanted` is in it as well as in the effect:
  // without it, switching the layer off after the archive had loaded stopped
  // the fetching and left the polygons on the map, with the Alerts panel
  // saying the layer was off beside a map that was still drawing it.
  const held = window && wanted && loaded?.key === window.key ? loaded : null;

  const data = useMemo(
    () =>
      held && frameTime !== null
        ? archiveWarningsAt(held.data, frameTime * 1000)
        : null,
    [held, frameTime],
  );

  return {
    data,
    coverage,
    loading: wanted && !held,
    error: held?.error ?? null,
  };
}

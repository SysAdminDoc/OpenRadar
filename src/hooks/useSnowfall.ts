import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchSnowfall,
  snowfallAvailable,
  type SnowfallAnalysis,
  type SnowfallWindow,
} from "../lib/snowfall";
import { log } from "../lib/log";
import { pollWhileOnline } from "../lib/poll";
import { failureSentence } from "../lib/serviceAnswer";
import { translate } from "../i18n";

/**
 * How often the office is asked again.
 *
 * It publishes at 00Z and 12Z, so nothing changes for twelve hours at a time
 * and asking every half hour is already generous. What it buys is that the
 * map picks up a new analysis within half an hour of it landing rather than
 * whenever the reader happens to toggle something.
 */
export const SNOWFALL_REFRESH_MS = 30 * 60_000;

export interface SnowfallState {
  analysis: SnowfallAnalysis | null;
  loading: boolean;
  error: string | null;
}

/** What was asked for, so an answer to a different question is not drawn. */
interface Asked {
  chosen: SnowfallWindow;
  highContrast: boolean;
}

function same(asked: Asked, now: Asked): boolean {
  return asked.chosen === now.chosen && asked.highContrast === now.highContrast;
}

/**
 * The most recent national snowfall analysis for the window chosen.
 *
 * One picture rather than a tile lane, so panning and zooming ask for
 * nothing: the file covers the whole country and the map is only moving over
 * a picture it already has. Changing the window, or the contrast the grid is
 * coloured against, is a different picture and is fetched.
 *
 * Both the picture and the failure are held with the question they answer
 * beside them, and neither is surfaced under a different one. A 72-hour total
 * left on screen under the words "24 hours", for the second it takes the next
 * one to arrive, is a wrong number rather than a slow one.
 */
export function useSnowfall(options: {
  ready: boolean;
  enabled: boolean;
  window: SnowfallWindow;
  highContrast: boolean;
}): SnowfallState {
  // Named `chosen` here rather than `window`, which is the browser's own.
  const { ready, enabled, window: chosen, highContrast } = options;
  const [held, setHeld] = useState<
    (Asked & { analysis: SnowfallAnalysis }) | null
  >(null);
  const [failed, setFailed] = useState<(Asked & { message: string }) | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // One counter for this effect alone. A picture that lands after the reader
  // has moved to another window is not the answer to the question on screen.
  const requestRef = useRef(0);

  const wanted = ready && enabled && snowfallAvailable();

  useEffect(() => {
    if (!wanted) return;

    const refresh = async () => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const analysis = await fetchSnowfall(chosen, highContrast);
        if (!mounted.current || request !== requestRef.current) return;
        setHeld({ chosen, highContrast, analysis });
        setFailed(null);
      } catch (failure: unknown) {
        if (!mounted.current || request !== requestRef.current) return;
        const message =
          typeof failure === "string"
            ? failure
            : failureSentence(failure, translate("snowfall.unanswered"));
        log.warn("snowfall", `${chosen}: ${message}`);
        setFailed({ chosen, highContrast, message });
      } finally {
        if (mounted.current && request === requestRef.current) {
          setLoading(false);
        }
      }
    };

    return pollWhileOnline(() => void refresh(), SNOWFALL_REFRESH_MS);
  }, [chosen, highContrast, wanted]);

  return useMemo(() => {
    const now = { chosen, highContrast };
    const analysis = wanted && held && same(held, now) ? held.analysis : null;
    return {
      analysis,
      loading: wanted && loading && !analysis,
      error: wanted && failed && same(failed, now) ? failed.message : null,
    };
  }, [chosen, failed, held, highContrast, loading, wanted]);
}

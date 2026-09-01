import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchForecastSmoke,
  forecastSmokeAvailable,
  sameInstant,
  type SmokeField,
} from "../lib/forecastSmoke";
import { log } from "../lib/log";

/** How many hours are kept on the page. A six-hour tail is six of them. */
export const FORECAST_SMOKE_HELD = 24;

/**
 * How long an hour answered by an older cycle is trusted before it is asked
 * for again. The native side leaves a missing cycle alone for ten minutes,
 * so asking sooner would only be answered from what it already holds; asking
 * never would leave the tail on the old cycle for as long as it was drawn.
 */
export const FALLBACK_RETRY_MS = 10 * 60_000;

export interface ForecastSmokeState {
  /** The hour on screen, or null when the playhead is not on a forecast frame. */
  field: SmokeField | null;
  loading: boolean;
  error: string | null;
}

/** A field, the cycle the tail was on when it was asked for, and when. */
interface Held {
  under: string | null;
  field: SmokeField;
  at: number;
}

/**
 * Whether a held field still answers for its hour.
 *
 * One from the cycle the tail is on does for as long as it is held. One the
 * native side fell back to, because that cycle had not published, is worth
 * asking about again after a while: the cycle lands, and the hour should
 * come from it rather than from the one before.
 */
function stillGood(entry: Held, now: number): boolean {
  if (entry.under === null) return true;
  if (sameInstant(entry.field.init, entry.under)) return true;
  return now - entry.at < FALLBACK_RETRY_MS;
}

/**
 * The model's smoke for the hour the playhead is on.
 *
 * Playback crosses a forecast hour every four frames and comes back round
 * every loop, so what has been fetched is kept, keyed on the hour, and only
 * an hour never seen is asked for. A fetch the playhead has moved on from is
 * kept when it lands rather than thrown away: it is the answer for its hour,
 * and the next pass through the loop wants it. Only the loading and error
 * state follow the latest request. The native side keeps the painted field
 * too, so a repeat costs nothing there either. When the tail moves to a new
 * cycle everything held under the old one stops matching and is refetched,
 * which is what keeps the legend's cycle honest.
 */
export function useForecastSmoke(options: {
  ready: boolean;
  enabled: boolean;
  /** The hour wanted, RFC 3339 on the hour, or null on an observed frame. */
  valid: string | null;
  /** The cycle the reflectivity tail is drawn from, so the two agree. */
  preferredInit: string | null;
}): ForecastSmokeState {
  const { ready, enabled, valid, preferredInit } = options;
  const [held, setHeld] = useState<Held[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<{
    valid: string;
    message: string;
  } | null>(null);
  // Read inside the effect rather than listed as a dependency, so a fetch
  // landing for one hour does not restart the request for another.
  const heldRef = useRef(held);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);
  // Whether the hook is still mounted, for a fetch that lands after it is
  // not. Nothing else is abandoned: a late answer is still the answer.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requestRef = useRef(0);

  const wanted = ready && enabled && forecastSmokeAvailable() && valid !== null;

  useEffect(() => {
    if (!wanted || !valid) return;
    if (
      heldRef.current.some(
        (entry) =>
          entry.under === preferredInit &&
          sameInstant(entry.field.valid, valid) &&
          stillGood(entry, Date.now()),
      )
    ) {
      return;
    }

    const refresh = async () => {
      const request = ++requestRef.current;
      setLoading(true);
      try {
        const field = await fetchForecastSmoke(valid, preferredInit);
        if (!mounted.current) return;
        setHeld((previous) =>
          [
            ...previous.filter(
              (entry) =>
                !(
                  entry.under === preferredInit &&
                  sameInstant(entry.field.valid, valid)
                ),
            ),
            { under: preferredInit, field, at: Date.now() },
          ].slice(-FORECAST_SMOKE_HELD),
        );
        if (request === requestRef.current) setFailed(null);
      } catch (failure: unknown) {
        if (!mounted.current || request !== requestRef.current) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The forecast smoke did not arrive.";
        log.warn("smoke", `${valid}: ${message}`);
        setFailed({ valid, message });
      } finally {
        if (mounted.current && request === requestRef.current) {
          setLoading(false);
        }
      }
    };

    void refresh();
  }, [preferredInit, valid, wanted]);

  return useMemo(() => {
    const field =
      wanted && valid
        ? (held.find(
            (entry) =>
              entry.under === preferredInit &&
              sameInstant(entry.field.valid, valid),
          )?.field ?? null)
        : null;
    return {
      field,
      loading: wanted && loading && !field,
      error:
        wanted && valid && failed && sameInstant(failed.valid, valid)
          ? failed.message
          : null,
    };
  }, [failed, held, loading, preferredInit, valid, wanted]);
}

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

export interface ForecastSmokeState {
  /** The hour on screen, or null when the playhead is not on a forecast frame. */
  field: SmokeField | null;
  loading: boolean;
  error: string | null;
}

/** A field, and the cycle the tail was on when it was asked for. */
interface Held {
  under: string | null;
  field: SmokeField;
}

/**
 * The model's smoke for the hour the playhead is on.
 *
 * Playback crosses a forecast hour every four frames and comes back round
 * every loop, so what has been fetched is kept, keyed on the hour, and only
 * an hour never seen is asked for. The native side keeps the painted field
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

  const wanted = ready && enabled && forecastSmokeAvailable() && valid !== null;

  useEffect(() => {
    if (!wanted || !valid) return;
    if (
      heldRef.current.some(
        (entry) =>
          entry.under === preferredInit &&
          sameInstant(entry.field.valid, valid),
      )
    ) {
      return;
    }
    let open = true;

    const refresh = async () => {
      setLoading(true);
      try {
        const field = await fetchForecastSmoke(valid, preferredInit);
        if (!open) return;
        setHeld((previous) =>
          [
            ...previous.filter(
              (entry) =>
                !(
                  entry.under === preferredInit &&
                  sameInstant(entry.field.valid, valid)
                ),
            ),
            { under: preferredInit, field },
          ].slice(-FORECAST_SMOKE_HELD),
        );
        setFailed(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The forecast smoke did not arrive.";
        log.warn("smoke", `${valid}: ${message}`);
        setFailed({ valid, message });
      } finally {
        if (open) setLoading(false);
      }
    };

    void refresh();
    return () => {
      open = false;
    };
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

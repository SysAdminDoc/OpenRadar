import { useEffect, useMemo, useState } from "react";
import { log } from "../lib/log";
import {
  WIND_REFRESH_MS,
  fetchWind,
  windAvailable,
  type WindField,
} from "../lib/wind";

export interface WindState {
  field: WindField | null;
  error: string | null;
  /** True when the layer is wanted but the field has not arrived yet. */
  loading: boolean;
}

/**
 * The wind field the particle layer animates.
 *
 * A run is published every six hours, so this is not a fast-moving thing: it
 * is read when the layer is switched on and then left alone until the next run
 * could plausibly be out.
 */
export function useWind(options: {
  ready: boolean;
  enabled: boolean;
  pageVisible: boolean;
}): WindState {
  const { ready, enabled, pageVisible } = options;
  const [field, setField] = useState<WindField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wanted = ready && enabled && windAvailable();

  useEffect(() => {
    if (!wanted) return;
    let open = true;

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await fetchWind();
        if (!open) return;
        setField(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The wind field did not arrive.";
        log.warn("wind", message);
        setError(message);
      } finally {
        if (open) setLoading(false);
      }
    };

    void refresh();
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = window.setInterval(() => void refresh(), WIND_REFRESH_MS);
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, [pageVisible, wanted]);

  return useMemo(
    () => ({
      field: wanted ? field : null,
      error: wanted ? error : null,
      loading: wanted && loading && !field,
    }),
    [error, field, loading, wanted],
  );
}

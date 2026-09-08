import { useEffect, useMemo, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import { log } from "../lib/log";
import {
  WIND_REFRESH_MS,
  fetchWind,
  windAvailable,
  type WindField,
} from "../lib/wind";
import { failureSentence } from "../lib/serviceAnswer";
import { useLatestReply } from "./useLatestReply";
import { translate } from "../i18n";

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
  const latest = useLatestReply();

  const wanted = ready && enabled && windAvailable();

  useEffect(() => {
    if (!wanted) return;
    const reply = latest();

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await fetchWind();
        if (!reply.current()) return;
        setField(next);
        setError(null);
      } catch (failure: unknown) {
        if (!reply.current()) return;
        const message =
          typeof failure === "string"
            ? failure
            : failureSentence(failure, translate("wind.unread"));
        log.warn("wind", message);
        setError(message);
      } finally {
        if (reply.current()) setLoading(false);
      }
    };

    // The first ask, in the place it has always been: before the
    // visibility check below, so a hidden window still reads once.
    // Not with no network, where it is one more failure in the log.
    if (isOnline()) void refresh();

    if (!pageVisible) {
      return () => {
        reply.close();
      };
    }
    const stop = pollWhileOnline(() => void refresh(), WIND_REFRESH_MS, false);
    return () => {
      reply.close();
      stop();
    };
  }, [latest, pageVisible, wanted]);

  return useMemo(
    () => ({
      field: wanted ? field : null,
      error: wanted ? error : null,
      loading: wanted && loading && !field,
    }),
    [error, field, loading, wanted],
  );
}

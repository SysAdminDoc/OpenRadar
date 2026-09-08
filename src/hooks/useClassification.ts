import { useEffect, useMemo, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import {
  CLASSIFICATION_REFRESH_MS,
  CLASSIFICATION_STALE_MINUTES,
  classificationFeatures,
  fetchClassification,
  type Classification,
  type ClassificationProduct,
} from "../lib/classification";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/runtime";
import { translate } from "../i18n";
import { failureSentence } from "../lib/serviceAnswer";
import { useLatestReply } from "./useLatestReply";

/** Level III is decoded natively, so a browser preview has none of it. */
export function classificationAvailable(): boolean {
  return isDesktopRuntime();
}

export interface ClassificationState {
  /** The volume's answer, or null when there is nothing worth drawing. */
  report: Classification | null;
  /** The same, as the map takes it. */
  features: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}

/**
 * What the radar says is falling at whichever site is being read.
 *
 * Tied to that site rather than to the map, for the same reason the storm
 * cells are: this is one radar's own account of one volume, and showing it
 * over another site's picture would be two moments on one screen.
 */
export function useClassification(options: {
  ready: boolean;
  enabled: boolean;
  station: string | null;
  product: ClassificationProduct;
  pageVisible: boolean;
  /** Milliseconds, ticking once a minute, for judging what is still current. */
  clock: number;
}): ClassificationState {
  const { ready, enabled, station, product, pageVisible, clock } = options;
  const [report, setReport] = useState<Classification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted =
    ready && enabled && classificationAvailable() && station !== null;

  const latest = useLatestReply();
  useEffect(() => {
    // Nothing is cleared here. What comes back is gated below on the question
    // being asked now, so a report for a site or a product nobody is looking
    // at is never drawn whatever is still held.
    if (!wanted || !station) return;
    const reply = latest();

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await fetchClassification(station, product);
        if (!reply.current()) return;
        setReport(next);
        setError(null);
      } catch (failure: unknown) {
        if (!reply.current()) return;
        // A native rejection is a string this app wrote; anything else goes
        // through the shared reader, which keeps a sentence this app wrote
        // and never prints the engine's own words at somebody.
        const message =
          typeof failure === "string"
            ? failure
            : failureSentence(failure, translate("classification.unread"));
        log.warn("radar", `${station} ${product}: ${message}`);
        // Drawing the last volume's classification over a newer picture would
        // be worse than drawing none: this is the layer that says what is
        // falling, and it has to be about the volume on screen.
        setReport(null);
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
    const stop = pollWhileOnline(
      () => void refresh(),
      CLASSIFICATION_REFRESH_MS,
    );
    return () => {
      reply.close();
      stop();
    };
  }, [latest, pageVisible, product, station, wanted]);

  const current = useMemo(() => {
    if (!report || !wanted) return null;
    // An answer about another site, or about the other product, is not an
    // answer to the question being asked now.
    if (report.station !== station || report.product !== product) return null;
    const observed = Date.parse(report.observed);
    if (!Number.isFinite(observed)) return null;
    const minutes = (clock - observed) / 60_000;
    return minutes <= CLASSIFICATION_STALE_MINUTES ? report : null;
  }, [clock, product, report, station, wanted]);

  const features = useMemo(
    () => (current ? classificationFeatures(current) : null),
    [current],
  );

  return { report: current, features, loading, error };
}

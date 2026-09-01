import { useEffect, useMemo, useState } from "react";
import {
  CLASSIFICATION_REFRESH_MS,
  CLASSIFICATION_STALE_MINUTES,
  classificationFeatures,
  fetchClassification,
  type Classification,
  type ClassificationProduct,
} from "../lib/classification";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/settings";

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

  useEffect(() => {
    // Nothing is cleared here. What comes back is gated below on the question
    // being asked now, so a report for a site or a product nobody is looking
    // at is never drawn whatever is still held.
    if (!wanted || !station) return;
    let open = true;

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await fetchClassification(station, product);
        if (!open) return;
        setReport(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The classification could not be read.";
        log.warn("radar", `${station} ${product}: ${message}`);
        // Drawing the last volume's classification over a newer picture would
        // be worse than drawing none: this is the layer that says what is
        // falling, and it has to be about the volume on screen.
        setReport(null);
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
    const timer = window.setInterval(
      () => void refresh(),
      CLASSIFICATION_REFRESH_MS,
    );
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, [pageVisible, product, station, wanted]);

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

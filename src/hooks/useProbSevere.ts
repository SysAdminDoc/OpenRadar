import { useEffect, useMemo, useState } from "react";
import { isOnline } from "../lib/online";
import { pollWhileOnline } from "../lib/poll";
import { log } from "../lib/log";
import {
  PROBSEVERE_REFRESH_MS,
  fetchProbSevere,
  isCurrentReading,
  probSevereAvailable,
  probSevereFeatures,
  type ProbSevereReading,
} from "../lib/probsevere";
import { translate } from "../i18n";

export interface ProbSevereState {
  reading: ProbSevereReading | null;
  features: Record<string, unknown> | null;
  error: string | null;
}

/** A reading older than this is about storms that have moved on. */
const STALE_MINUTES = 15;

/**
 * What the model says about the storms on the map.
 *
 * A reading is published about every two minutes for the whole country, so
 * there is nothing to key on the view: one read serves whatever is on screen.
 */
export function useProbSevere(options: {
  ready: boolean;
  enabled: boolean;
  pageVisible: boolean;
  /** Milliseconds, ticking once a minute, for judging what is still current. */
  clock: number;
}): ProbSevereState {
  const { ready, enabled, pageVisible, clock } = options;
  const [reading, setReading] = useState<ProbSevereReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wanted = ready && enabled && probSevereAvailable();

  useEffect(() => {
    if (!wanted) return;
    let open = true;

    const refresh = async () => {
      try {
        const next = await fetchProbSevere();
        if (!open) return;
        setReading(next);
        setError(null);
      } catch (failure: unknown) {
        if (!open) return;
        const message =
          typeof failure === "string"
            ? failure
            : failure instanceof Error
              ? failure.message
              : "The severe probabilities could not be read.";
        log.warn("radar", message);
        // A reading nobody could refresh is a reading about storms that have
        // moved on, and this is a layer somebody might act on.
        setReading(null);
        setError(message);
      }
    };

    // The first ask, in the place it has always been: before the
    // visibility check below, so a hidden window still reads once.
    // Not with no network, where it is one more failure in the log.
    if (isOnline()) void refresh();

    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const stop = pollWhileOnline(
      () => void refresh(),
      PROBSEVERE_REFRESH_MS,
      false,
    );
    return () => {
      open = false;
      stop();
    };
  }, [pageVisible, wanted]);

  const current = useMemo(() => {
    if (!reading || !wanted) return null;
    return isCurrentReading(reading.observed, clock, STALE_MINUTES)
      ? reading
      : null;
  }, [clock, reading, wanted]);

  // A reading that arrived but is not worth drawing is not the same as no
  // reading at all, and the reader has to be told which they have. Switching
  // the layer on and getting a blank map with no message was the worst of it.
  const stale = reading !== null && current === null;

  const features = useMemo(
    () => (current ? probSevereFeatures(current) : null),
    [current],
  );

  if (!wanted) return { reading: null, features: null, error: null };
  return {
    reading: current,
    features,
    error: error ?? (stale ? translate("probSevere.stale") : null),
  };
}

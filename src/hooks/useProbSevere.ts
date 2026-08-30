import { useEffect, useMemo, useState } from "react";
import { log } from "../lib/log";
import {
  PROBSEVERE_REFRESH_MS,
  fetchProbSevere,
  probSevereAvailable,
  probSevereFeatures,
  readingTime,
  type ProbSevereReading,
} from "../lib/probsevere";

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

    void refresh();
    if (!pageVisible) {
      return () => {
        open = false;
      };
    }
    const timer = window.setInterval(
      () => void refresh(),
      PROBSEVERE_REFRESH_MS,
    );
    return () => {
      open = false;
      window.clearInterval(timer);
    };
  }, [pageVisible, wanted]);

  const current = useMemo(() => {
    if (!reading || !wanted) return null;
    const at = readingTime(reading.observed);
    if (at === null) return null;
    return (clock - at) / 60_000 <= STALE_MINUTES ? reading : null;
  }, [clock, reading, wanted]);

  const features = useMemo(
    () => (current ? probSevereFeatures(current) : null),
    [current],
  );

  return { reading: current, features, error: wanted ? error : null };
}

import { useEffect, useRef, useState } from "react";
import {
  fetchMelting,
  meltingAvailable,
  type MeltingLayer,
  type NoLayer,
} from "../lib/melting";
import { log } from "../lib/log";
import { pollWhileOnline } from "../lib/poll";

/**
 * How often the held station is asked again.
 *
 * A volume takes four to six minutes and the high cuts come last in it, so
 * asking more often than that is asking the same scan the same question. It
 * decodes a volume to answer, which is why it is not asked at all unless the
 * one product that reads it is on screen.
 */
export const MELTING_REFRESH_MS = 5 * 60_000;

/**
 * The melting layer at the held radar, or the reason there is none.
 *
 * Only asked for while the hail size product is on screen, because that is
 * the one the height is read against and decoding a volume for a line nobody
 * is looking at is a fetch and a decode for nothing.
 */
export function useMelting(options: {
  station: string | null;
  ready: boolean;
}): MeltingLayer | NoLayer | null {
  const { station, ready } = options;
  const [found, setFound] = useState<MeltingLayer | NoLayer | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wanted = ready && station !== null && meltingAvailable();

  useEffect(() => {
    if (!wanted || !station) return;
    const ask = async () => {
      try {
        const answer = await fetchMelting(station);
        if (mounted.current) setFound(answer);
      } catch (failure) {
        // A volume that would not decode is not a sky with no melting layer
        // in it, so nothing is shown rather than a wrong reason.
        log.warn(
          "melting",
          `${station}: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
        if (mounted.current) setFound(null);
      }
    };
    return pollWhileOnline(() => void ask(), MELTING_REFRESH_MS);
  }, [station, wanted]);

  return wanted ? found : null;
}

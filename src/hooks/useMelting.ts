import { useEffect, useState } from "react";
import {
  fetchMelting,
  meltingAvailable,
  type MeltingLayer,
  type NoLayer,
} from "../lib/melting";
import { log } from "../lib/log";
import { pollWhileOnline } from "../lib/poll";
import { useLatestReply } from "./useLatestReply";

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
  // The answer with the station it is an answer about beside it. A volume
  // takes seconds to tens of seconds to reach and decode, so a reader
  // switching sites would otherwise read the old site's melting layer under
  // the new site's heading until the new one landed. Held together rather
  // than cleared in an effect, which the linter refuses and which would put
  // a render between the two anyway.
  const [found, setFound] = useState<{
    station: string;
    layer: MeltingLayer | NoLayer | null;
  } | null>(null);
  const latest = useLatestReply();
  const wanted = ready && station !== null && meltingAvailable();

  useEffect(() => {
    if (!wanted || !station) return;
    const reply = latest();
    const ask = async () => {
      try {
        const answer = await fetchMelting(station);
        // Only if this is still the run the hook is waiting on. A cached
        // volume for one site can land after a slow one for another, and the
        // slow one would then overwrite it for a full refresh interval.
        if (reply.current()) setFound({ station, layer: answer });
      } catch (failure) {
        // A volume that would not decode is not a sky with no melting layer
        // in it, so nothing is shown rather than a wrong reason.
        log.warn(
          "melting",
          `${station}: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
        if (reply.current()) setFound({ station, layer: null });
      }
    };
    const stop = pollWhileOnline(() => void ask(), MELTING_REFRESH_MS);
    return () => {
      stop();
      reply.close();
    };
  }, [latest, station, wanted]);

  return wanted && found?.station === station ? found.layer : null;
}

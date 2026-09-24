import { useEffect, useState } from "react";
import { floodReadingAt, type FloodReading } from "../lib/flashFlood";
import type { GeoPoint } from "../lib/geo";
import { pollWhileOnline } from "../lib/poll";
import { useLatestReply } from "./useLatestReply";

/**
 * How often the four panels are read again while somebody is looking.
 *
 * The grids behind them are published every two minutes, and the worst of
 * them, the hourly rain against guidance, is rewritten on that cycle too.
 */
export const FLOOD_REFRESH_MS = 2 * 60_000;

/** The four panels at a point, and whether an answer for it is in. */
export interface FloodReadingState {
  /** The newest reading, or null where the app cannot read one here. */
  reading: FloodReading | null;
  /** True until the first answer for this point has come back. */
  loading: boolean;
}

/**
 * The four-panel reading at a point, kept current while it is wanted.
 *
 * The answer is held with the point it was asked for rather than cleared
 * when the point moves, so the reading shown is only ever one for the point
 * on screen and nothing has to be reset from inside an effect.
 */
export function useFloodReading(point: GeoPoint | null): FloodReadingState {
  const [answer, setAnswer] = useState<{
    key: string;
    reading: FloodReading | null;
  } | null>(null);
  const key = point ? `${point.lon},${point.lat}` : null;
  const latest = useLatestReply();

  useEffect(() => {
    if (!point || key === null) return;
    const reply = latest();
    const read = () => {
      void floodReadingAt(point.lon, point.lat)
        .then((reading) => {
          if (reply.current()) setAnswer({ key, reading });
        })
        .catch(() => {
          // Each panel already turns its own failure into an empty panel, so
          // this is only a reader that could not run at all.
          if (reply.current()) setAnswer({ key, reading: null });
        });
    };
    const stop = pollWhileOnline(read, FLOOD_REFRESH_MS);
    return () => {
      reply.close();
      stop();
    };
    // The point by its coordinates, not by the object carrying them, which
    // a caller may rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, latest]);

  const held = answer && answer.key === key ? answer : null;
  return {
    reading: held?.reading ?? null,
    loading: key !== null && held === null,
  };
}

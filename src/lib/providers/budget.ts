export interface RequestBudget {
  /** Records one request when the window still has room. */
  tryConsume: (now?: number) => boolean;
  remaining: (now?: number) => number;
  reset: () => void;
}

/**
 * A rolling window that never lets more than `limit` requests through inside
 * `windowMs`. Timestamps older than the window are dropped on every call, so
 * the counter cannot drift during a long playback session.
 */
export function createRollingRequestBudget(
  limit: number,
  windowMs: number,
): RequestBudget {
  let stamps: number[] = [];

  const prune = (now: number) => {
    const cutoff = now - windowMs;
    if (stamps.length && stamps[0] <= cutoff) {
      stamps = stamps.filter((stamp) => stamp > cutoff);
    }
  };

  return {
    tryConsume: (now = Date.now()) => {
      prune(now);
      if (stamps.length >= limit) return false;
      stamps.push(now);
      return true;
    },
    remaining: (now = Date.now()) => {
      prune(now);
      return Math.max(0, limit - stamps.length);
    },
    reset: () => {
      stamps = [];
    },
  };
}

/** A 1x1 transparent PNG served in place of a request that is over budget. */
export const BLANK_TILE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

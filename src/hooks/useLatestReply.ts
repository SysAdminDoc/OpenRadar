import { useCallback, useRef } from "react";

/**
 * A token per effect run, so an answer that arrives after a newer question can
 * be recognised and dropped.
 *
 * Ten files wrote this by hand, as `let alive = true` and a cleanup that set
 * it false, and it was forgotten twice in one week: the pack panel wrote a
 * ceiling nobody asked for, and the settings journal put an older record back
 * on screen over a newer one. Both were found by a refutation pass rather than
 * by a test, because the thing they protect is invisible until two answers
 * arrive out of order.
 *
 * What it is not is an unmount guard. React 19 says nothing about a state
 * write after unmount, so a test that watches for a warning proves nothing;
 * what this actually prevents is an older reply landing last and winning,
 * which is observable and is what its own test drives.
 *
 * ```ts
 * const latest = useLatestReply();
 * useEffect(() => {
 *   const reply = latest();
 *   void read(path).then((answer) => {
 *     if (reply.current()) setThing(answer);
 *   });
 *   return reply.close;
 * }, [path]);
 * ```
 */
export function useLatestReply(): () => {
  /** True while this run is still the newest one. */
  current: () => boolean;
  /** For the effect's cleanup: nothing from this run counts after it. */
  close: () => void;
} {
  const generation = useRef(0);
  return useCallback(() => {
    const mine = (generation.current += 1);
    return {
      current: () => mine === generation.current,
      close: () => {
        // Only if this run is still the current one. A cleanup arriving after
        // the next run has already started must not invalidate that newer
        // run, which is the order React tears down and sets up in.
        if (mine === generation.current) generation.current += 1;
      },
    };
  }, []);
}

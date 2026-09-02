import { useEffect, useState } from "react";

/**
 * The radar disc drawing itself, once, on the very first run.
 *
 * A signature rather than a feature. It is the picture everybody has in their
 * head when they think of radar, and seeing the app draw it once is the sort
 * of small thing somebody remembers about a program they have just installed.
 *
 * Four rules hold it to being harmless:
 *
 * - It plays once. A reader who has seen it never sees it again unless they
 *   go and ask for it.
 * - It never delays the map. It is drawn over a map that is already live and
 *   takes no pointer events, so the workspace is usable through it.
 * - Any interaction ends it. A reader who has started work is not made to
 *   watch an animation finish.
 * - It does not play at all under reduced motion. The whole of it is motion,
 *   so there is nothing left to keep.
 */
export function FirstRunReveal({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let timer = window.setTimeout(onDone, DURATION_MS);
    const skip = () => {
      // Two separate things, deliberately: off screen at once, and the flag
      // that stops it playing again a moment later. Writing the flag from the
      // interaction itself put a settings save between a pointer going down
      // and the click that follows it, which took the map's own popup with
      // it. Leaving it until the whole sweep had run meant a reader who
      // skipped and then quit saw the animation again on the next launch.
      setGone(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(onDone, SETTLE_MS);
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, skip, true);
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, skip, true);
    };
  }, [onDone]);

  if (gone) return null;
  return <div className="first-run-reveal" aria-hidden="true" />;
}

/** Long enough to read as a sweep, short enough that nobody waits for it. */
export const DURATION_MS = 2400;

/**
 * How long after a skip the flag is written.
 *
 * Past the pointerdown, pointerup and click that a single press is, so a save
 * cannot land in the middle of one, and far short of anything a reader would
 * notice.
 */
export const SETTLE_MS = 300;

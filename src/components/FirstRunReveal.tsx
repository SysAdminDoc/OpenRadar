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
    // Two separate things, deliberately. An interaction takes it off screen
    // at once; the flag that stops it ever playing again is written when the
    // sweep would have ended anyway. Writing it from the interaction meant a
    // settings save landing between a pointer going down and the click that
    // follows it, which took the map's own popup with it.
    const timer = window.setTimeout(onDone, DURATION_MS);
    const skip = () => setGone(true);
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

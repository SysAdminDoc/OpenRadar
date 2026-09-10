import { useEffect, useState } from "react";

/**
 * Whether anybody is there, and when they last said so.
 *
 * Two questions the workspace asks constantly and neither of which anything
 * else owns. A hidden page stops polling the services that only matter while
 * somebody is looking; the moment of the last touch is what the readout dims
 * itself off and what the loop slows itself off.
 *
 * Recorded rather than reacted to: neither of those wants a render per
 * keystroke, so this writes the moment and lets whatever cares compare it
 * against the clock.
 */
export function usePresence() {
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [touchedAt, setTouchedAt] = useState(() => Date.now());

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Any of the ordinary ways somebody says they are still there.
  useEffect(() => {
    const touched = () => setTouchedAt(Date.now());
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const name of events)
      window.addEventListener(name, touched, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touched);
    };
  }, []);

  return { pageVisible, touchedAt, setTouchedAt };
}

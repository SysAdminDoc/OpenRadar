import { useEffect, useState } from "react";
import {
  displayAwakeAvailable,
  displayShouldHold,
  holdDisplayAwake,
} from "../lib/display";

/**
 * The screen kept on while the full-screen view is showing.
 *
 * Whether this build can do it is asked once, because it cannot change while
 * the app is running. The hold itself follows the view rather than the
 * setting: leaving the view gives the screen back with the setting still on,
 * and so does unmounting, which is what a window closing does to this tree.
 * The process ending releases it either way, because the native side takes
 * the hold on the main thread and that thread ends with the process.
 */
export function useDisplayAwake(state: {
  wanted: boolean;
  showing: boolean;
  onFailure?: (failure: unknown) => void;
}): boolean {
  const { wanted, showing, onFailure } = state;
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void displayAwakeAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hold = displayShouldHold({ available, wanted, showing });
  useEffect(() => {
    if (!hold) return;
    void holdDisplayAwake(true).catch((failure: unknown) => {
      onFailure?.(failure);
    });
    return () => {
      // Nothing to report on the way out. A release that failed leaves a
      // screen awake somebody is not looking at, which the process ending
      // fixes anyway, and there is no view left to say it on.
      void holdDisplayAwake(false).catch(() => undefined);
    };
    // The callback is deliberately not depended on: it is rebuilt every
    // render at the call site, and depending on it would drop and retake the
    // hold on every tick of the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  return hold;
}

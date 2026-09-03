import { useCallback, useEffect, useState } from "react";
import { setStartWithMachine, startsWithMachine } from "../lib/autostart";

export interface AutostartState {
  /**
   * Whether the app is registered to start with the machine.
   *
   * `null` until the answer is back, and on a browser preview for good: the
   * switch is drawn as off and disabled there rather than pretending to know.
   */
  on: boolean | null;
  /** Registers or removes the entry, and settles on what is actually true. */
  set: (on: boolean) => void;
}

/**
 * The Run entry, as a piece of state the workspace can read.
 *
 * There is no setting for this. The registry entry is the only thing that
 * decides what happens at the next boot, so a stored copy of the reader's
 * intent could only ever disagree with it: an entry removed by hand, by
 * another install, or by a tool that cleans up startup items would leave a
 * switch saying the watch is running when it is not. This asks the machine
 * instead, once on open and again after every write.
 */
export function useAutostart(): AutostartState {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let open = true;
    void startsWithMachine().then((answer) => {
      if (open) setOn(answer);
    });
    return () => {
      open = false;
    };
  }, []);

  const set = useCallback((next: boolean) => {
    // Shown straight away and corrected by the answer. The registry write is
    // fast but not instant, and a switch that does not move under the finger
    // reads as broken.
    setOn(next);
    void setStartWithMachine(next).then(setOn);
  }, []);

  return { on, set };
}

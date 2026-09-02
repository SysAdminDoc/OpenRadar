import { useEffect, useRef, useState } from "react";
import {
  CURIOSITY_URL,
  foundAt,
  readCuriosities,
  type Curiosity,
} from "../lib/curiosities";

/**
 * The place the reader has just explored to, if it is one of the few.
 *
 * The set is read once, from the file that ships with the app, so this asks
 * nothing of the network and works with it switched off. The check runs when
 * the camera comes to rest rather than while it moves: a dozen distances at
 * the end of a pan is nothing, and the same work on every frame of a drag
 * would be a decorative feature costing the radar loop its frames.
 *
 * Nothing is found while a warning is in force at a watched place. That is
 * the standing rule for everything discoverable here, and it is the whole
 * reason this is safe to ship: a map with a warning on it is a serious
 * instrument, and a card about a lighthouse in 1934 can wait.
 */
export function useCuriosities(options: {
  enabled: boolean;
  camera: { center: [number, number]; zoom: number } | null;
  /** The ones already found, so none of them is found twice. */
  already: readonly string[];
  onFound: (found: Curiosity) => void;
}): void {
  const { enabled, camera, already, onFound } = options;
  const [set, setSet] = useState<Curiosity[]>([]);

  useEffect(() => {
    if (!enabled || set.length) return;
    let open = true;
    void fetch(CURIOSITY_URL)
      .then((response) => (response.ok ? response.json() : []))
      .then((value) => {
        if (open) setSet(readCuriosities(value));
      })
      // A set of curiosities is not worth an error in front of somebody.
      .catch(() => undefined);
    return () => {
      open = false;
    };
  }, [enabled, set.length]);

  // Read through refs so the check runs when the camera moves and not when a
  // list identity changes: `already` is rebuilt on every settings read, and
  // as a dependency it re-ran this on every tick of the clock.
  const alreadyRef = useRef(already);
  const foundRef = useRef(onFound);
  useEffect(() => {
    alreadyRef.current = already;
    foundRef.current = onFound;
  }, [already, onFound]);

  useEffect(() => {
    if (!enabled || !camera || !set.length) return;
    const found = foundAt(set, camera, alreadyRef.current);
    if (found) foundRef.current(found);
  }, [camera, enabled, set]);
}

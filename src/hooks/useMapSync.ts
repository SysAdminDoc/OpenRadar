import { useEffect, useRef, type RefObject } from "react";

/**
 * Draws one value onto the map, and only when that value changes.
 *
 * Every layer in the viewport had the same shape written out by hand: a ref
 * updated with the latest value, a call to the function that puts it on the
 * map, and a suppression, because the sync function is rebuilt on every
 * render and listing it as a dependency would rebuild the map layers on every
 * render too. Sixteen of those suppressions had accumulated, and a
 * suppression that is everywhere has stopped being a note about one place.
 *
 * The dependency really is the value alone. The sync is deliberately
 * latest-wins and is read through a ref, which is a fact about the design
 * rather than a rule being switched off, so this needs no suppression and
 * neither does anything that uses it.
 *
 * The sync holds the value as well as drawing it, because the sync functions
 * read their own refs rather than an argument: they are also called from
 * elsewhere, when a style finishes loading and when the overlay band is
 * rebuilt for a contrast or units change, and those callers hand over
 * nothing.
 */
export function useMapSync<T>(value: T, sync: (value: T) => void): void {
  const latest = useRef(sync);

  // Written in an effect rather than during render, which React forbids, and
  // declared before the one below because effects run in order: the sync
  // always belongs to the render that is being committed.
  useEffect(() => {
    latest.current = sync;
  });

  useEffect(() => {
    latest.current(value);
  }, [value]);
}

/**
 * A value a sync reads but does not redraw for by itself.
 *
 * Several layers are drawn from more than one input: the radar lane needs the
 * frame, whether it is switched on and how opaque it is. This keeps the ones
 * that are not the trigger where the sync can find them.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const held = useRef(value);
  useEffect(() => {
    held.current = value;
  }, [value]);
  return held;
}

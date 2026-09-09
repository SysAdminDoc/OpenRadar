/**
 * Reading a value out of a file that may be older than this build, or may
 * have been written by hand.
 *
 * Two of them, and they are here rather than in the store because the
 * normalisers moved out to the modules that own each section's vocabulary
 * and every one of those needs both. A leaf that reached back into the store
 * for them would close the ring this whole arrangement exists to open.
 *
 * Nothing is imported here, on purpose: this is the bottom of the tree.
 */

/** A number, held inside its bounds, or the app's own answer. */
export function finiteInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** A switch, or the app's own answer. Strict, so "yes" and 0 are not one. */
export function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

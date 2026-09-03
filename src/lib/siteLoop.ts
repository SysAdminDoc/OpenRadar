/**
 * Which of a site's volumes belongs to a moment on the timeline.
 *
 * The app held exactly one volume, so a reader watching a supercell at site
 * resolution could see where it was and not where it was going. The timeline
 * above the map already runs on the mosaic's own two-minute steps; what was
 * missing was a way to say which of the site's volumes each of those steps is
 * showing.
 *
 * The rule is at-or-before, never the nearest. A radar finishes a volume and
 * publishes it; until the next one lands, the last finished volume is what is
 * true. Choosing the nearest would draw a volume from after the moment on
 * screen, which is a picture of the future sitting under a timestamp from the
 * past, and on a fast-moving storm that is the difference between a warning
 * polygon covering the cell and trailing it.
 */

/** What a reader gets without asking, in volumes. */
export const DEFAULT_LOOP_VOLUMES = 10;

/** The shortest loop worth the name: the volume on screen and nothing else. */
export const MIN_LOOP_VOLUMES = 1;

/**
 * The longest.
 *
 * Thirty volumes is a couple of hours of a site's scanning, which is as far
 * back as anybody scrubs while a storm is on. The listing behind it is one
 * request whatever the number; what costs is decoding, and that is bounded
 * separately by how many rendered volumes are kept.
 */
export const MAX_LOOP_VOLUMES = 30;

/**
 * The volume a moment is showing, or null when the moment is older than
 * anything held.
 *
 * `times` is oldest first, which is the order the native side answers in.
 */
export function volumeForTime(
  times: readonly number[],
  at: number,
): number | null {
  let found: number | null = null;
  for (const time of times) {
    if (time > at) break;
    found = time;
  }
  return found;
}

/** The key one rendered volume is held under. */
export function loopKey(parts: {
  station: string;
  at: number;
  product: string;
  tilt: number;
  dealias: boolean;
  motion: [number, number] | null;
  threshold: number | null;
  palette: number;
  highContrast: boolean;
}): string {
  return JSON.stringify([
    parts.station,
    parts.at,
    parts.product,
    parts.tilt,
    parts.dealias,
    parts.motion,
    parts.threshold,
    parts.palette,
    parts.highContrast,
  ]);
}

/**
 * How many volumes to keep rendered.
 *
 * A rendered sweep is a PNG the size of the site's coverage, so a loop of
 * thirty at four megabytes each is a hundred and twenty megabytes of pictures
 * held for a window that is meant to stay open for days. Twice the loop
 * length is enough to cover a reader scrubbing back and forth over the same
 * stretch without holding every product and tilt they have ever looked at.
 */
export function trimHeld<T>(
  held: Map<string, T>,
  keep: number,
): Map<string, T> {
  if (held.size <= keep) return held;
  const kept = new Map<string, T>();
  const entries = [...held.entries()];
  for (const [key, value] of entries.slice(entries.length - keep)) {
    kept.set(key, value);
  }
  return kept;
}

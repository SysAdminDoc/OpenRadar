/**
 * The workspace as something that can be left on a second monitor.
 *
 * The most loyal thing a desktop app can manage is a permanent place on
 * somebody's other screen, and that needs a view with no chrome, a legible
 * clock, what the map is showing, and a loop that keeps running. It is the
 * capture layout with a readout put back, which is why it costs so little:
 * nothing is unmounted, so leaving it puts the workspace back exactly as it
 * was.
 *
 * What makes it safe to leave running for eight hours:
 *
 * - **It moves.** A static bright rectangle left on a panel for a night is
 *   how somebody ends up with a ghost of a radar loop on their monitor. The
 *   readout drifts a few pixels every few minutes, which costs nothing and
 *   is invisible to a person.
 * - **It dims.** Bright white text on a dark map, held still, is the worst
 *   case for both retention and for a room somebody is asleep in. Nothing
 *   here is pure white, and after a while unattended it fades further.
 * - **It slows down.** A loop left overnight must not be a loop asking a
 *   public service for tiles every thirty seconds until morning. The
 *   refresh stretches the longer nobody has touched it, and never goes
 *   faster than the radar's own cadence.
 * - **It gets out of the way of a warning.** A warning reaching a watched
 *   place takes the mode down and puts the workspace back, because the whole
 *   point of the app is the thing that just happened.
 */

/** How long between drifts, and how far. Small enough that nobody sees it. */
export const DRIFT_EVERY_MS = 4 * 60_000;
export const DRIFT_PIXELS = 12;

/** How long unattended before the readout fades to its quieter step. */
export const DIM_AFTER_MS = 20 * 60_000;

/** The dimmest it goes. Still readable across a room, never invisible. */
export const DIM_OPACITY = 0.55;

/**
 * The slowest the loop is allowed to run, in milliseconds.
 *
 * A radar volume is four to six minutes in precipitation mode and about ten
 * in clear air, so refreshing every fifteen minutes overnight loses nothing
 * and is a twentieth of the requests.
 */
export const SLOWEST_REFRESH_MS = 15 * 60_000;

/**
 * How long the refresh stays at its normal cadence before stretching.
 *
 * Somebody watching a storm has touched the machine in the last half hour.
 * Somebody who left it on last night has not.
 */
export const SLOW_AFTER_MS = 30 * 60_000;

/**
 * How often to refresh, given the usual cadence and how long it has been
 * since anybody touched the machine.
 *
 * Never faster than asked for, and never slower than the ceiling. Between
 * those it stretches smoothly, so a machine left alone all night is asking
 * for a picture four times an hour rather than a hundred.
 */
export function ambientRefreshMs(
  usual: number,
  idleMs: number,
  slowest = SLOWEST_REFRESH_MS,
): number {
  if (!Number.isFinite(idleMs) || idleMs <= SLOW_AFTER_MS) return usual;
  const over = idleMs - SLOW_AFTER_MS;
  // Doubling every half hour after the first, up to the ceiling.
  const factor = Math.pow(2, over / SLOW_AFTER_MS);
  return Math.min(slowest, Math.round(usual * factor));
}

/**
 * How far the readout has drifted by now, in pixels.
 *
 * A slow walk around a small box rather than a random jump: a jump is visible
 * and a walk is not, and what matters is that no pixel holds the same bright
 * text for hours.
 */
export function drift(elapsedMs: number): { x: number; y: number } {
  const step = Math.floor(elapsedMs / DRIFT_EVERY_MS);
  const angle = (step % 8) * (Math.PI / 4);
  return {
    x: Math.round(Math.cos(angle) * DRIFT_PIXELS),
    y: Math.round(Math.sin(angle) * DRIFT_PIXELS),
  };
}

/** How bright the readout is, given how long nobody has touched anything. */
export function ambientOpacity(idleMs: number): number {
  return idleMs >= DIM_AFTER_MS ? DIM_OPACITY : 1;
}

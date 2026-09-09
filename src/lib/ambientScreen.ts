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

/**
 * The angle a glyph should subtend for a display somebody reads at a glance.
 *
 * Nineteen arcminutes is the human-factors figure for a screen that is looked
 * at rather than worked at. It is an angle, so it says nothing about a font
 * size until a distance is named: the same nineteen arcminutes is thirteen
 * pixels on a desk and ninety on a wall four metres away.
 */
export const GLANCE_ARCMINUTES = 19;

/**
 * The smallest line in the readout, as the stylesheet draws it.
 *
 * Held against `index.css` by a test rather than trusted, because the whole
 * rule below is anchored on it.
 */
export const AMBIENT_SMALLEST_PX = 13;
export const AMBIENT_CLOCK_PX = 46;
export const AMBIENT_PLACE_PX = 17;

/**
 * How far away the type was drawn for.
 *
 * Not a guess: it is the distance at which the smallest line subtends the
 * nineteen arcminutes above. A CSS pixel is a 96th of an inch by definition,
 * so thirteen of them are 3.44 mm, and 3.44 mm subtends nineteen arcminutes
 * at 622 mm. Rounded to six-tenths of a metre, which is a person at a desk.
 */
export const DEFAULT_AMBIENT_METRES = 0.6;

/** The distances the setting offers, in metres. */
export const AMBIENT_DISTANCES = [0.6, 1.5, 2.5, 4] as const;

/**
 * How much bigger the readout has to be to be read from a given distance.
 *
 * Linear in the distance, which is what holding an angle constant means for
 * anything small enough that the tangent is the angle: at twice the distance,
 * twice the size. One is the default, so a reader who never opens the setting
 * sees exactly what they saw before.
 *
 * Bounded by the room it has, because the geometry does not know how big the
 * screen is. The bound is measured rather than estimated: the first version
 * counted characters at half an em each, and a watch place called
 * "Chargoggagoggmanchauggagoggchaubunagungamaugg" ran a hundred pixels off
 * the right edge while sixteen characters of Japanese stood a hundred and
 * forty above the top. A glyph is not half an em, and in some scripts it is
 * not close.
 *
 * `natural` is what the readout's three lines come to at their design size,
 * which the view measures from what is on screen. The way out below them is a
 * fixed size and is counted here rather than measured, along with the gaps
 * and the inset, all of which stay where they are whatever the type does.
 */
export function ambientTypeScale(
  metres: number,
  room: { width: number; height: number },
  natural: { width: number; height: number },
): number {
  const wanted = Math.max(1, metres / DEFAULT_AMBIENT_METRES);
  // The gaps between the lines, the way out and the inset do not scale, so
  // they come off the room before the rest is divided by what does.
  const across =
    (room.width - AMBIENT_INSET_PX * 2) / Math.max(1, natural.width);
  const down =
    (room.height - AMBIENT_INSET_PX - AMBIENT_LEAVE_PX - AMBIENT_GAPS_PX) /
    Math.max(1, natural.height);
  const fits = Math.min(wanted, across, down);
  // Never below the size it was drawn at, and never a number that is not one:
  // a scale of `NaN` reaches the stylesheet as an invalid `calc` and takes
  // every line of the readout with it.
  return Number.isFinite(fits) ? Math.max(1, fits) : 1;
}

/** How far the readout sits from the corner, and how tall its way out is. */
const AMBIENT_INSET_PX = 32;
const AMBIENT_LEAVE_PX = 52;
/** The gaps between the three lines, which do not scale with the type. */
const AMBIENT_GAPS_PX = 4;

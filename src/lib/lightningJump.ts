import { haversineMiles } from "./geo";
import type { Flash } from "../hooks/useLightning";
import type { StormCell } from "./cells";

/**
 * A sudden rise in a storm's flash rate, which tends to come minutes before
 * it does something.
 *
 * The app has both halves and nothing joining them: the radar's own cell
 * tracker on one side, the satellite's flashes on the other. This counts the
 * flashes inside each tracked cell and watches the rate of change of that
 * count against how much it has been varying.
 *
 * The method is Schultz's two-sigma jump, which is what the weather service's
 * own training is written around: take the flash rate over two-minute bins,
 * take the change between consecutive bins, and call it a jump when that
 * change is more than twice the standard deviation of the changes before it.
 * A minimum rate goes with it, because a storm going from one flash a minute
 * to three is a large change in a small number and is not what the signal is
 * about.
 *
 * A jump is a signal and not a warning. It says a storm is intensifying now,
 * not that anything has reached the ground, and these are satellite-detected
 * flashes: light above the cloud rather than a strike report. Every surface
 * that shows one carries both.
 */

/** How long a bin is. Two minutes is what the published method uses. */
export const JUMP_BIN_MS = 2 * 60_000;

/**
 * How much history a jump is judged against.
 *
 * Seven bins, which is six changes: the newest one, and the five before it
 * that make up the ten minutes the method takes its deviation over. Six bins
 * gave four prior changes, which is a shorter window than the method asks for
 * and a standard deviation over four numbers.
 */
export const JUMP_HISTORY_BINS = 7;

/**
 * How fast a storm has to be flashing before a rise means anything, per
 * minute.
 *
 * Without it a cell going from one flash a minute to three is a two hundred
 * per cent rise against almost no variance, which is arithmetic rather than a
 * storm doing something. Ten a minute is the figure the published method uses
 * and the one the skill studies settle on.
 */
export const JUMP_MIN_RATE = 10;

/** How many standard deviations of the recent change count as a jump. */
export const JUMP_SIGMA = 2;

/**
 * How far from a cell's centre a flash is counted as that cell's, in miles.
 *
 * The tracker publishes a centroid and a motion and no size, so this is a
 * radius rather than the cell's own footprint. Ten miles is about the width
 * of the reflectivity core the algorithm builds a cell out of, and wide
 * enough that a flash from the anvil over the same storm is still counted to
 * it.
 */
export const JUMP_RADIUS_MILES = 10;

/** One bin of a cell's history: when it ended, and how many flashes in it. */
export interface JumpSample {
  /** The end of the bin, in milliseconds. */
  at: number;
  flashes: number;
}

/** What a cell's series says about it now. */
export interface CellJump {
  /** The flash rate in the newest bin, per minute. */
  rate: number;
  /** How many standard deviations the newest change is, or null with too little history. */
  sigma: number | null;
  /** When the jump was found, in milliseconds, or null where there is none. */
  at: number | null;
}

/** How many of a window's flashes belong to a cell. */
export function flashesNear(
  cell: Pick<StormCell, "latitude" | "longitude">,
  flashes: readonly Flash[],
  radiusMiles: number = JUMP_RADIUS_MILES,
): number {
  let found = 0;
  for (const flash of flashes) {
    const miles = haversineMiles(
      { lat: cell.latitude, lon: cell.longitude },
      { lat: flash.latitude, lon: flash.longitude },
    );
    if (miles <= radiusMiles) found += 1;
  }
  return found;
}

/**
 * Folds a flash into the bin it belongs in.
 *
 * Bins are anchored to the epoch rather than to when the app started, so two
 * cells sampled at different moments land in the same bins and a restart does
 * not shift the series under itself.
 */
export function binOf(at: number): number {
  return Math.floor(at / JUMP_BIN_MS) * JUMP_BIN_MS + JUMP_BIN_MS;
}

/**
 * The flash rate in each bin, per minute, oldest first.
 *
 * A bin a window arrived for and saw nothing in is a bin with no flashes: a
 * storm that stops flashing has a rate of zero, and dropping that bin would
 * make the next change read as a continuation of the one before it. A bin no
 * window arrived for at all is a different thing and is not here to divide;
 * `changes` measures the real gap between two bins rather than assuming they
 * are adjacent.
 */
export function rates(series: readonly JumpSample[]): number[] {
  return series.map((sample) => sample.flashes / (JUMP_BIN_MS / 60_000));
}

/**
 * The rate of change between one bin and the next, per minute per minute.
 *
 * Divided by the time that actually passed between the two rather than by a
 * bin length. A missed poll leaves a six-minute hole, and treating it as one
 * two-minute step reads the change across it as three times what it was.
 */
export function changes(series: readonly JumpSample[]): number[] {
  const perMinute = rates(series);
  const found: number[] = [];
  for (let at = 1; at < perMinute.length; at += 1) {
    const minutes = (series[at].at - series[at - 1].at) / 60_000;
    if (!(minutes > 0)) continue;
    found.push((perMinute[at] - perMinute[at - 1]) / minutes);
  }
  return found;
}

/**
 * Whether the newest bin is a jump, and by how much.
 *
 * Null for `sigma` where the history is too short to say: a cell the tracker
 * has only just found has no variance to judge a rise against, and calling
 * its first two bins a jump would flag every new storm.
 */
export function jumpIn(series: readonly JumpSample[]): CellJump {
  const perMinute = rates(series);
  const rate = perMinute.length > 0 ? perMinute[perMinute.length - 1] : 0;
  const bare: CellJump = { rate, sigma: null, at: null };
  const all = changes(series);
  // The newest change, judged against the ones before it. Two of those is not
  // a standard deviation worth the name, so the method's own five is the bar.
  if (all.length < JUMP_HISTORY_BINS - 1) return bare;
  const newest = all[all.length - 1];
  const before = all.slice(0, -1);
  const mean = before.reduce((sum, one) => sum + one, 0) / before.length;
  // Over one fewer than the count, which is the standard deviation of a
  // sample rather than of a population. These five changes are a sample of a
  // storm's behaviour, not the whole of it, and dividing by five instead made
  // the deviation too small and every sigma reported here too large.
  const variance =
    before.reduce((sum, one) => sum + (one - mean) * (one - mean), 0) /
    Math.max(1, before.length - 1);
  const deviation = Math.sqrt(variance);
  // A storm whose rate has not varied at all has no scale to measure a rise
  // against. Dividing by it would make any rise infinite, so a flat history
  // says nothing rather than saying everything.
  if (!(deviation > 0)) return bare;
  const sigma = newest / deviation;
  const jumped = sigma >= JUMP_SIGMA && rate >= JUMP_MIN_RATE && newest > 0;
  return {
    rate,
    sigma,
    at: jumped ? series[series.length - 1].at : null,
  };
}

/**
 * Adds a bin to a cell's series and drops what is too old to judge against.
 *
 * A sample landing in the bin that is already newest replaces it rather than
 * adding another: the flash window is a rolling count refreshed more often
 * than a bin is long, so several arrivals belong to the same bin and the last
 * one is the one that saw the most of it.
 */
export function withSample(
  series: readonly JumpSample[],
  sample: JumpSample,
): JumpSample[] {
  const kept = series.filter(
    (held) => sample.at - held.at < JUMP_BIN_MS * JUMP_HISTORY_BINS,
  );
  const last = kept[kept.length - 1];
  if (last && last.at === sample.at) {
    return [...kept.slice(0, -1), sample];
  }
  return [...kept, sample];
}

/**
 * Each tracked cell's series, held past the renders that would lose it.
 *
 * Module state rather than a hook's, for the reason `lightningWatch.ts` gives
 * beside its own: a ref cannot be written while rendering, and setting state
 * inside an effect is a cascading render the linter refuses. It is only ever
 * a cache. Everything in it came out of a real window, and losing it costs
 * the history a jump is judged against and nothing else.
 *
 * Folding is idempotent, which is what makes it safe to do while rendering: a
 * second pass over the same window lands in the bin it already filled and
 * replaces it with the same count.
 */
const held = new Map<string, JumpSample[]>();

/**
 * Folds one window into every live cell's series and reads the jump off each.
 *
 * A cell the tracker has dropped takes its series with it: identifiers get
 * reused, so keeping one would judge a new storm's first bins against a
 * different storm's history.
 */
export function rememberJumps(
  cells: readonly Pick<StormCell, "id" | "latitude" | "longitude">[],
  flashes: readonly Flash[],
  at: number,
): Map<string, CellJump> {
  const bin = binOf(at);
  const live = new Set(cells.map((cell) => cell.id));
  for (const id of [...held.keys()]) {
    if (!live.has(id)) held.delete(id);
  }
  // Only the flashes that fell inside this bin. The window handed over is a
  // rolling five minutes, and counting all of it into a two-minute bin read
  // every rate two and a half times too high: a storm flashing ten a minute
  // came out as twenty-six, and the floor meant to keep small storms out let
  // anything above four through. The window is longer than a bin, so each bin
  // is fully covered by the window that closes it.
  const inBin = flashes.filter((flash) => {
    const when = flash.time * 1000;
    return when >= bin - JUMP_BIN_MS && when < bin;
  });
  const found = new Map<string, CellJump>();
  for (const cell of cells) {
    const series = withSample(held.get(cell.id) ?? [], {
      at: bin,
      flashes: flashesNear(cell, inBin),
    });
    held.set(cell.id, series);
    found.set(cell.id, jumpIn(series));
  }
  return found;
}

/** Forgets every cell, for a test that needs an app that has seen nothing. */
export function forgetJumps(): void {
  held.clear();
}

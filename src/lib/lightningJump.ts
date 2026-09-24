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
 *
 * It is a rate for one storm, which is why it did not move when the counting
 * changed. While every cell counted the flashes in its own circle, a cell in
 * the middle of a squall line carried the line's rate near it and cleared the
 * floor on its neighbours' lightning; now it carries its own share and some
 * of those cells fall below. That is the floor doing what it is for rather
 * than a floor that needs re-deriving: the number and the count are finally
 * about the same thing.
 */
export const JUMP_MIN_RATE = 10;

/**
 * How many standard deviations of the recent change count as a jump.
 *
 * The published method uses 2.0 with an assumed population standard
 * deviation. This implementation estimates the deviation from five prior
 * changes, so the ratio follows a t-distribution with four degrees of
 * freedom rather than a normal. At t(4), the one-tailed p=0.025 critical
 * value is 2.776; rounding to 2.8 gives a false positive rate of about
 * 2.4%, which meets the 2.5% acceptance criterion the published method
 * targets.
 */
export const JUMP_SIGMA = 2.8;

/**
 * The least of a bin that has to have happened before it is worth a rate.
 *
 * Three quarters of it. A count over one minute of a two-minute bin carries
 * twice the Poisson variance of a full bin, and the sigma it is judged against
 * comes from full bins: a steady 30-a-minute storm reads 30 ± 7.7 in a
 * half-covered bin against 30 ± 3.9 in a settled one, which clears 2σ on
 * noise alone. Three quarters keeps the rate within 15% of the settled
 * variance and still folds the bin before the next one opens.
 */
export const JUMP_MIN_COVERED_MS = (JUMP_BIN_MS * 3) / 4;

/**
 * How much time one satellite file covers, in milliseconds.
 *
 * The mapper writes a file every twenty seconds and every flash in one is
 * stamped with the file's own start, which is what `key_time` reads and what
 * `observed` is the newest of. So a window observed at a moment actually
 * reaches twenty seconds past it, and a bin's count covers that much more
 * than the moment suggests.
 *
 * Twenty seconds against a two-minute bin is a sixth of it, and leaving it
 * out read a storm flashing steadily at thirty a minute as 45, 36, 45, 36:
 * half again too high a minute into a bin and a fifth too high at the end of
 * one. The name of a file the app itself lists says the length: the `s` and
 * `e` fields of `OR_GLM-L2-LCFA_G19_s…0900000_e…0900200_…` are twenty seconds
 * apart.
 */
export const FLASH_GRANULE_MS = 20_000;

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
  /**
   * How much of the bin had actually happened when this was counted, in
   * milliseconds.
   *
   * A bin is two minutes and the window arrives every minute, so the newest
   * bin is usually part way through: counting a minute of flashes and
   * dividing by two minutes halves the rate. With the window landing near a
   * bin's first instant it reads as almost nothing, and the next arrival
   * reads as almost double, so a storm flashing steadily at thirty a minute
   * came out as 0.5, 15.5, 0.5, 15.5.
   */
  covered: number;
}

/** What a cell's series says about it now. */
export interface CellJump {
  /** The flash rate in the newest bin, per minute. */
  rate: number;
  /** How many standard deviations the newest change is, or null with too little history. */
  sigma: number | null;
  /**
   * When the jump was found, in milliseconds, or null where there is none.
   *
   * This is the start of the bin the jump was found in, not the end: the end
   * can be up to two minutes in the future, which is not a time a reader can
   * have seen anything at.
   */
  at: number | null;
}

/** The fields a cell needs for flash counting: position and optional motion. */
type CellForFlash = Pick<
  StormCell,
  "id" | "latitude" | "longitude" | "speedMs" | "directionDegrees"
>;

/**
 * Miles in a degree of latitude, rounded down.
 *
 * A great circle between two points is never shorter than the stretch of
 * meridian between their latitudes, so a pair further apart than the radius
 * in latitude alone is further apart than the radius, and the haversine can
 * be skipped for it. Rounded down so the skip is never wrong, only sometimes
 * not taken. Every held bin is counted again on each window, and on a
 * sixty-cell outbreak the haversine over every pair was a tenth of a second
 * spent while the map was drawing.
 */
const MILES_PER_DEGREE_LATITUDE = 69.09;

/** Whether two latitudes alone put a pair further apart than a reach. */
function beyondByLatitude(one: number, two: number, reach: number): boolean {
  return Math.abs(one - two) * MILES_PER_DEGREE_LATITUDE > reach;
}

/**
 * Each cell's share of a window's flashes, with every flash counted once.
 *
 * A flash goes to the nearest cell that could claim it and to no other. The
 * tracker publishes a centroid and a motion and no size, so the circle around
 * each cell is a fixed radius; two cells twelve miles apart therefore have
 * overlapping circles, and counting a flash to both meant that along a squall
 * line every cell's flash rate was the line's rate near it. They then all
 * jumped on the same bin, which is what put five identifiers on one badge.
 *
 * Ties go to the cell the tracker listed first, which is its own order and
 * not this module's.
 *
 * When a cell has motion fields, its centroid is advected forward to the
 * window's observation time so a cell moving at 30 knots does not count
 * flashes round where it was twenty minutes ago.
 */
export function flashesByCell(
  cells: readonly CellForFlash[],
  flashes: readonly Flash[],
  radiusMiles: number = JUMP_RADIUS_MILES,
  atMs: number = 0,
  reportedAtMs: number = 0,
): Map<string, number> {
  const counts = new Map<string, number>();
  const positions = cells.map((cell) =>
    advectedPosition(cell, atMs, reportedAtMs),
  );
  for (const cell of cells) counts.set(cell.id, 0);
  for (const flash of flashes) {
    let nearest: { id: string; miles: number } | null = null;
    for (let at = 0; at < cells.length; at += 1) {
      const pos = positions[at];
      if (beyondByLatitude(pos.lat, flash.latitude, radiusMiles)) continue;
      const miles = haversineMiles(pos, {
        lat: flash.latitude,
        lon: flash.longitude,
      });
      if (miles > radiusMiles) continue;
      if (nearest && miles >= nearest.miles) continue;
      nearest = { id: cells[at].id, miles };
    }
    if (nearest) counts.set(nearest.id, (counts.get(nearest.id) ?? 0) + 1);
  }
  return counts;
}

/**
 * A cell's centroid moved forward from `reportedAtMs` to `atMs` by its own
 * reported motion.
 *
 * The tracker's position can be twenty minutes old by the time a window
 * arrives; a cell at 30 knots has moved ten miles in that time, which is the
 * radius itself.
 */
function advectedPosition(
  cell: CellForFlash,
  atMs: number,
  reportedAtMs: number,
): { lat: number; lon: number } {
  const base = { lat: cell.latitude, lon: cell.longitude };
  if (
    cell.speedMs === null ||
    cell.directionDegrees === null ||
    !(cell.speedMs > 0) ||
    !(reportedAtMs > 0)
  )
    return base;
  // Either way in time. A bin older than the report is counted where the
  // cell was then, which is behind where the report puts it now: history is
  // re-measured against the newest report, and a fast storm's old flashes
  // would otherwise fall outside a circle that has moved on without them.
  const elapsedS = (atMs - reportedAtMs) / 1000;
  if (elapsedS === 0 || Math.abs(elapsedS) > 3600) return base;
  const distanceKm = (cell.speedMs * elapsedS) / 1000;
  const rad = (cell.directionDegrees * Math.PI) / 180;
  const dLat = (distanceKm * Math.cos(rad)) / 111.32;
  const dLon =
    (distanceKm * Math.sin(rad)) /
    (111.32 * Math.cos((base.lat * Math.PI) / 180));
  return { lat: base.lat + dLat, lon: base.lon + dLon };
}

/**
 * How far past the claim radius a bin keeps a flash, in miles.
 *
 * A bin is held as the flashes near the cells rather than as each cell's
 * count, so it can be counted again under whatever cells there are later. A
 * flash further than this from every cell of the moment is one no cell could
 * claim within the history's fourteen minutes: a storm at thirty knots covers
 * eight miles in that time, and the tracker's centroid wanders by less.
 */
const HELD_MARGIN_MILES = 10;

/** The flashes of a window that some cell could claim, now or in the history. */
function nearAnyCell(
  cells: readonly CellForFlash[],
  flashes: readonly Flash[],
  atMs: number,
  reportedAtMs: number,
): Flash[] {
  const reach = JUMP_RADIUS_MILES + HELD_MARGIN_MILES;
  const positions = cells.map((cell) =>
    advectedPosition(cell, atMs, reportedAtMs),
  );
  return flashes.filter((flash) =>
    positions.some(
      (position) =>
        !beyondByLatitude(position.lat, flash.latitude, reach) &&
        haversineMiles(position, {
          lat: flash.latitude,
          lon: flash.longitude,
        }) <= reach,
    ),
  );
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
  return series.map((sample) => {
    const minutes = Math.min(Math.max(sample.covered, 1), JUMP_BIN_MS) / 60_000;
    return sample.flashes / minutes;
  });
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
 *
 * `priorAt` is a jump already on the card from the bin before, which is held
 * for one full bin so the badge does not vanish the instant the next change
 * is evaluated. Without the hold a jump fires on one poll and is gone on the
 * next, which is too fast to read.
 */
export function jumpIn(series: readonly JumpSample[]): CellJump {
  const perMinute = rates(series);
  const rate = perMinute.length > 0 ? perMinute[perMinute.length - 1] : 0;
  const bare: CellJump = { rate, sigma: null, at: null };
  const all = changes(series);
  if (all.length < JUMP_HISTORY_BINS - 1) return bare;
  const newest = all[all.length - 1];
  const before = all.slice(0, -1);
  const mean = before.reduce((sum, one) => sum + one, 0) / before.length;
  const variance =
    before.reduce((sum, one) => sum + (one - mean) * (one - mean), 0) /
    Math.max(1, before.length - 1);
  const deviation = Math.sqrt(variance);
  if (!(deviation > 0)) return bare;
  const sigma = newest / deviation;
  const jumped = sigma >= JUMP_SIGMA && rate >= JUMP_MIN_RATE && newest > 0;
  const binStart = series[series.length - 1].at - JUMP_BIN_MS;
  return { rate, sigma, at: jumped ? binStart : null };
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

/** One bin as a window saw it, kept so it can be counted again. */
interface HeldBin {
  /** The end of the bin, in milliseconds. */
  at: number;
  /** When the window that filled it was observed, for moving a centroid. */
  observedAt: number;
  covered: number;
  /** The flashes in it that some cell could claim. */
  flashes: Flash[];
}

/**
 * The recent bins, as flashes rather than as each cell's count.
 *
 * A flash belongs to one cell, so a count depends on which other cells there
 * were. Counts held per cell were measured against whatever neighbours each
 * bin happened to have: when a neighbour died, drifted away or was renamed,
 * the flashes it had held fell to whoever was nearest and that cell's rate
 * rose with nothing about the weather having changed. Resetting a cell's
 * history whenever its set of neighbours changed stopped that for a death
 * and missed a neighbour drifting inside the ring, and it threw away a real
 * rise every time a distant cell flickered in and out of the table.
 *
 * Held as flashes, every bin is counted again under the cells there are now,
 * so the history and the newest bin are measured against the same storms.
 *
 * Module state rather than a hook's, for the reason `lightningWatch.ts` gives
 * beside its own: a ref cannot be written while rendering, and setting state
 * inside an effect is a cascading render the linter refuses. It is only ever
 * a cache. Everything in it came out of a real window, and losing it costs
 * the history a jump is judged against and nothing else.
 *
 * Folding is idempotent, which is what makes it safe to do while rendering: a
 * second pass over the same window lands in the bin it already filled and
 * replaces it with the same flashes.
 */
const bins = new Map<number, HeldBin>();

/**
 * The bin each cell was first seen in.
 *
 * A cell's series starts there. Before it, the flashes near where it is now
 * belonged to no tracked storm or to a different one, and judging a new
 * storm's first bins against them would call every new storm a jump.
 */
const firstSeen = new Map<string, number>();

/**
 * The `at` of each cell's last reported jump, so the hold can keep it on
 * the card for one full bin after it fires.
 */
const priorJumps = new Map<string, number>();

/**
 * Folds one window into every live cell's series and reads the jump off each.
 *
 * A cell the tracker has dropped takes its series with it: identifiers get
 * reused, so keeping one would judge a new storm's first bins against a
 * different storm's history.
 *
 * `trimmed` means the window was capped or incomplete: some flashes were
 * dropped, so the count in this bin is a lower bound and rating it against a
 * series of full bins reads any steady storm as a drop. The bin is not folded
 * at all; the series keeps what it had.
 */
export function rememberJumps(
  cells: readonly CellForFlash[],
  flashes: readonly Flash[],
  at: number,
  trimmed: boolean = false,
  reportedAtMs: number = 0,
): Map<string, CellJump> {
  const bin = binOf(at);
  const live = new Set(cells.map((cell) => cell.id));
  for (const id of [...firstSeen.keys()]) {
    if (!live.has(id)) {
      firstSeen.delete(id);
      priorJumps.delete(id);
    }
  }
  for (const cell of cells) {
    if (!firstSeen.has(cell.id)) firstSeen.set(cell.id, bin);
  }
  // A trimmed or incomplete window dropped flashes, so the count in this bin
  // is a lower bound, and rating it against full bins reads any steady storm
  // as a drop. It is not held; the bins already held are read again.
  if (!trimmed) {
    // Only the flashes that fell inside this bin. The window handed over is a
    // rolling five minutes, and counting all of it into a two-minute bin read
    // every rate two and a half times too high: a storm flashing ten a minute
    // came out as twenty-six, and the floor meant to keep small storms out
    // let anything above four through. The window is longer than a bin, so
    // each bin is fully covered by the window that closes it.
    const opened = bin - JUMP_BIN_MS;
    const inBin = flashes.filter((flash) => {
      const when = flash.time * 1000;
      return when >= opened && when < bin;
    });
    // How much of this bin the count actually covers. A bin that has just
    // opened has been watched for a few seconds and its count must be divided
    // by that rather than by a whole bin. The observation reaches one file
    // past the moment it was observed at, because every flash in a file
    // carries that file's own start.
    const covered = Math.min(
      Math.max(at + FLASH_GRANULE_MS - opened, 0),
      JUMP_BIN_MS,
    );
    // Too little of the bin has happened to rate it. What was held stays,
    // rather than a count over four seconds taking a minute's place.
    if (covered >= JUMP_MIN_COVERED_MS) {
      bins.set(bin, {
        at: bin,
        observedAt: at,
        covered,
        flashes: nearAnyCell(cells, inBin, at, reportedAtMs),
      });
    }
  }
  for (const key of [...bins.keys()]) {
    if (bin - key >= JUMP_BIN_MS * JUMP_HISTORY_BINS) bins.delete(key);
  }
  // Every held bin counted under the cells there are now, each at the moment
  // it was observed so a moving cell is where it was then.
  const held = [...bins.values()].sort((one, two) => one.at - two.at);
  const counted = held.map((one) =>
    flashesByCell(
      cells,
      one.flashes,
      JUMP_RADIUS_MILES,
      one.observedAt,
      reportedAtMs,
    ),
  );
  const found = new Map<string, CellJump>();
  for (const cell of cells) {
    const since = firstSeen.get(cell.id) ?? bin;
    let series: JumpSample[] = [];
    held.forEach((one, index) => {
      if (one.at < since) return;
      series = withSample(series, {
        at: one.at,
        flashes: counted[index].get(cell.id) ?? 0,
        covered: one.covered,
      });
    });
    const jump = jumpIn(series);
    const prior = priorJumps.get(cell.id) ?? null;
    // Hold: a jump that fired on the previous bin stays on the card for one
    // full bin, so the badge does not vanish on the next poll.
    if (jump.at !== null) {
      priorJumps.set(cell.id, jump.at);
      found.set(cell.id, jump);
    } else if (
      prior !== null &&
      series.length > 0 &&
      series[series.length - 1].at - prior <= 2 * JUMP_BIN_MS
    ) {
      found.set(cell.id, { ...jump, at: prior });
    } else {
      priorJumps.delete(cell.id);
      found.set(cell.id, jump);
    }
  }
  return found;
}

/** Forgets every cell, for a test that needs an app that has seen nothing. */
export function forgetJumps(): void {
  bins.clear();
  firstSeen.clear();
  priorJumps.clear();
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FLASH_GRANULE_MS,
  JUMP_BIN_MS,
  JUMP_HISTORY_BINS,
  JUMP_MIN_RATE,
  binOf,
  changes,
  flashesByCell,
  jumpIn,
  rates,
  withSample,
  forgetJumps,
  rememberJumps,
  type JumpSample,
} from "./lightningJump";
import type { Flash } from "../hooks/useLightning";

const AT = Date.parse("2026-09-10T18:00:00Z");

/** A series ending now, one bin every two minutes, oldest first. */
function series(counts: number[]): JumpSample[] {
  return counts.map((flashes, at) => ({
    at: AT - (counts.length - 1 - at) * JUMP_BIN_MS,
    flashes,
    // A settled bin, which is what every one of these stands for.
    covered: JUMP_BIN_MS,
  }));
}

function flash(latitude: number, longitude: number, at: number = AT): Flash {
  return {
    latitude,
    longitude,
    energyJoules: 1,
    areaSquareKm: 10,
    // Seconds, like every time the native side hands over. It is the flash's
    // own moment that decides which bin it lands in.
    time: at / 1000,
  };
}

function cell(
  id: string,
  latitude: number,
  longitude: number,
  speedMs: number | null = null,
  directionDegrees: number | null = null,
) {
  return { id, latitude, longitude, speedMs, directionDegrees };
}

const CELL = cell("A1", 41.6, -93.6);

/**
 * A moment near the end of the nth bin after `AT`.
 *
 * `AT` is exactly on a bin boundary, so a window observed at `AT` is a bin
 * that has run for no time at all: the fold refuses it, and before that
 * refusal existed it was rated as a whole bin's worth. Every window here is
 * observed a second before its bin closes, which is what a poll every minute
 * actually looks like by the time a bin settles.
 */
function closing(bin: number): number {
  // The last file that starts inside the bin. Every flash in a file carries
  // that file's own start, and the newest of those starts is what the window
  // reports as `observed`, so a window's moment is always on a granule
  // boundary and never at an arbitrary instant.
  return AT + (bin + 1) * JUMP_BIN_MS - FLASH_GRANULE_MS;
}

beforeEach(() => forgetJumps());
afterEach(() => forgetJumps());

describe("a storm's flash rate rising faster than it has been", () => {
  it("counts the flashes inside the cell and not the ones outside", () => {
    // A degree of latitude is about 69 miles, so a tenth of one is about
    // seven and two tenths is about fourteen.
    const near = flash(41.7, -93.6);
    const far = flash(41.8, -93.6);
    expect(flashesByCell([CELL], [near, far]).get("A1")).toBe(1);
    // The radius is what decides, not the count: widened, both belong to it.
    expect(flashesByCell([CELL], [near, far], 20).get("A1")).toBe(2);
    expect(flashesByCell([CELL], []).get("A1")).toBe(0);
  });

  it("reads a rate per minute out of a two-minute bin", () => {
    // Twenty flashes in two minutes is ten a minute, which is also the floor
    // the method puts under a jump.
    expect(rates(series([20]))).toEqual([10]);
    expect(rates(series([0, 4]))).toEqual([0, 2]);
  });

  it("finds a jump where the rate doubles over two bins", () => {
    // The acceptance's own case. Six bins of a steady storm, then one that
    // doubles: the change in the last bin is far outside the spread of the
    // changes before it, and the rate clears the floor.
    const steady = [24, 26, 24, 26, 24, 26];
    const doubled = jumpIn(series([...steady, 52]));
    expect(doubled.sigma).not.toBeNull();
    expect(doubled.sigma as number).toBeGreaterThan(2);
    // The start of the bin that jumped, not the end.
    expect(doubled.at).toBe(AT - JUMP_BIN_MS);
    expect(doubled.rate).toBe(26);

    // The number itself, worked out by hand. The rates are 12, 13, 12, 13,
    // 12, 13, 26; the changes are 0.5, -0.5, 0.5, -0.5, 0.5 and then 6.5.
    // Over the five before it that is a mean of 0.1 and a sample deviation of
    // 0.5477, which puts the last change 11.87 of them out. Taking the
    // deviation over five rather than four would say 13.27, which is the same
    // storm reported as more of a jump than it is.
    expect(doubled.sigma as number).toBeCloseTo(11.867, 2);
  });

  it("says nothing about a storm flashing steadily", () => {
    const flat = jumpIn(series([24, 26, 24, 26, 24, 26, 24]));
    expect(flat.at).toBeNull();
    // It still knows the rate, because the panel shows that either way.
    expect(flat.rate).toBe(12);
  });

  it("says nothing about a cell it has only just found", () => {
    // A storm with two bins behind it has no variance to judge a rise
    // against, and calling its first rise a jump would flag every new cell
    // the tracker picks up.
    const young = jumpIn(series([0, 40]));
    expect(young.sigma).toBeNull();
    expect(young.at).toBeNull();
    expect(young.rate).toBe(20);

    // One bin short of the history the method asks for is still too short,
    // and this one would clear every other bar: its rate is forty a minute,
    // its changes have a real spread, and its last change is nearly three
    // sigma. The only thing keeping it quiet is the length of the history.
    const nearly = jumpIn(series([10, 30, 20, 40, 25, 80]));
    expect(nearly.rate).toBeGreaterThan(JUMP_MIN_RATE);
    expect(nearly.sigma).toBeNull();
    expect(nearly.at).toBeNull();

    // And a short series that would otherwise clear every other bar. Four
    // bins give three changes, which is a spread and a rise well past two
    // sigma at a rate well past the floor: the only thing keeping this quiet
    // is the history the method asks for. Without this case a guard removed
    // is still green, because every other short series here is flat and a
    // flat one has no deviation to divide by.
    const short = jumpIn(series([10, 30, 20, 60]));
    expect(short.rate).toBeGreaterThan(JUMP_MIN_RATE);
    expect(short.sigma).toBeNull();
    expect(short.at).toBeNull();
  });

  it("does not call a small storm's large proportional rise a jump", () => {
    // One flash a minute going to four is a three hundred per cent rise
    // against almost no spread, which is arithmetic rather than a storm
    // doing something. The floor is what keeps it off the map.
    const small = jumpIn(series([2, 3, 2, 3, 2, 3, 8]));
    expect(small.sigma as number).toBeGreaterThan(2);
    expect(small.rate).toBeLessThan(JUMP_MIN_RATE);
    expect(small.at).toBeNull();
  });

  it("does not call a fall a jump", () => {
    // A storm collapsing has a change just as far outside its own spread as
    // one intensifying, and only one of them is the signal.
    const falling = jumpIn(series([24, 26, 24, 26, 24, 60, 20]));
    expect(falling.at).toBeNull();
  });

  it("says nothing where the rate has never varied", () => {
    // A perfectly flat history has no scale to measure a rise against, and
    // dividing by it would make any rise infinite.
    const flat = jumpIn(series([20, 20, 20, 20, 20, 20, 40]));
    expect(flat.sigma).toBeNull();
    expect(flat.at).toBeNull();
  });

  it("bins on the clock rather than on when the app started", () => {
    // Two cells sampled a few seconds apart land in the same bin, and a
    // restart does not shift the series under itself.
    const one = binOf(Date.parse("2026-09-10T18:00:10Z"));
    const other = binOf(Date.parse("2026-09-10T18:01:50Z"));
    expect(one).toBe(other);
    expect(binOf(Date.parse("2026-09-10T18:02:10Z"))).toBe(one + JUMP_BIN_MS);
  });

  it("replaces a sample landing in the bin it already has", () => {
    // The flash window is a rolling count refreshed more often than a bin is
    // long, so several arrivals belong to the same bin. Appending each one
    // would make a two-minute bin look like four of them and halve every
    // change the method takes.
    let held: JumpSample[] = [];
    held = withSample(held, { at: AT, flashes: 10, covered: JUMP_BIN_MS });
    held = withSample(held, { at: AT, flashes: 18, covered: JUMP_BIN_MS });
    expect(held).toHaveLength(1);
    expect(held[0].flashes).toBe(18);

    held = withSample(held, {
      at: AT + JUMP_BIN_MS,
      flashes: 20,
      covered: JUMP_BIN_MS,
    });
    expect(held).toHaveLength(2);
  });

  it("drops history it can no longer judge against", () => {
    let held: JumpSample[] = series(new Array(20).fill(10));
    held = withSample(held, {
      at: AT + JUMP_BIN_MS,
      flashes: 10,
      covered: JUMP_BIN_MS,
    });
    expect(held.length).toBeLessThanOrEqual(JUMP_HISTORY_BINS + 1);
  });

  it("measures a change across the time that actually passed", () => {
    // A missed poll leaves a six-minute hole between two bins. Reading it as
    // one two-minute step reads the change across it as three times what it
    // was, which is a jump made out of a gap.
    const gapped: JumpSample[] = [
      { at: AT, flashes: 20, covered: JUMP_BIN_MS },
      { at: AT + 3 * JUMP_BIN_MS, flashes: 44, covered: JUMP_BIN_MS },
    ];
    // Ten a minute to twenty-two a minute over six minutes is two.
    expect(changes(gapped)[0]).toBeCloseTo(2, 6);
  });

  it("counts a bin nothing was seen in as a bin with no flashes", () => {
    // A storm that stops flashing has a rate of zero. Dropping the bin would
    // make the next change read as a continuation of the one before it.
    const stopped = changes(series([20, 0]));
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toBeLessThan(0);
  });
});

describe("the series each tracked cell carries between windows", () => {
  const near = cell("A1", 41.6, -93.6);
  const other = cell("B2", 43.0, -93.6);

  it("builds a cell's history one window at a time", () => {
    // Seven windows two minutes apart, the last one twice as busy. No single
    // window can see a jump: it is the series across them that does.
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    const counts = [24, 26, 24, 26, 24, 26, 52];
    counts.forEach((count, at) => {
      const when = closing(at);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, when));
      found = rememberJumps([near], flashes, when);
    });
    expect(found.get("A1")?.at).not.toBeNull();
    // The last file of the bin, so the bin is covered end to end: fifty-two
    // flashes in two minutes is twenty-six a minute.
    expect(found.get("A1")?.rate).toBeCloseTo(26, 6);
  });

  it("folds the same window twice to the same answer", () => {
    // What makes it safe to do while rendering. A second pass lands in the
    // bin it already filled and replaces it with the same count.
    const when = closing(0);
    const flashes = new Array(24)
      .fill(null)
      .map(() => flash(41.6, -93.6, when));
    const once = rememberJumps([near], flashes, when);
    const twice = rememberJumps([near], flashes, when);
    expect(twice.get("A1")).toEqual(once.get("A1"));
  });

  it("forgets a cell the tracker has dropped", () => {
    // Cell identifiers get reused, so a series kept past its own storm would
    // judge a new one's first bins against a different storm's history.
    //
    // A1's counts vary rather than being flat: a storm whose rate has never
    // moved has no spread to judge a rise against, so a flat history would
    // give it a null sigma for a reason that has nothing to do with the
    // forgetting this is about.
    const counts = [24, 26, 24, 26, 24, 26, 24, 26];
    const near_at = (at: number) =>
      new Array(counts[at])
        .fill(null)
        .map(() => flash(41.6, -93.6, closing(at)));
    for (let at = 0; at < 6; at += 1) {
      rememberJumps([near, other], near_at(at), closing(at));
    }
    // `B2` goes away and comes back, and comes back with nothing behind it.
    rememberJumps([near], near_at(6), closing(6));
    const back = rememberJumps(
      [near, other],
      [
        ...near_at(7),
        ...new Array(100).fill(null).map(() => flash(43.0, -93.6, closing(7))),
      ],
      closing(7),
    );
    expect(back.get("B2")?.sigma).toBeNull();
    // And the cell that stayed kept its own history.
    expect(back.get("A1")?.sigma).not.toBeNull();
  });

  it("does not call a neighbour's death a jump", () => {
    // Two cells twelve miles apart with a storm flashing steadily between
    // them. Every flash goes to whichever is nearer, so each reads about half
    // the line's rate. When the tracker drops one, all of its flashes fall to
    // the other and that cell's count doubles with nothing about the weather
    // having changed. Counted against the series it built while it had a
    // neighbour, the doubling is a jump at many times the bar.
    const west = cell("A1", 41.6, -93.6);
    const east = cell("A2", 41.774, -93.6);
    // About twenty a bin either side of the midpoint, which is ten a minute
    // each. The counts wobble rather than being flat, because a storm whose
    // rate has never moved has no spread to judge a rise against and would
    // give a null sigma for a reason that has nothing to do with this.
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    const both = (at: number) => [
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.63, -93.6, closing(at))),
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.73, -93.6, closing(at))),
    ];
    for (let at = 0; at < 7; at += 1) {
      rememberJumps([west, east], both(at), closing(at));
    }
    // The same forty flashes, and now only one cell to take them.
    const after = rememberJumps([west], both(7), closing(7));
    expect(after.get("A1")?.rate).toBeCloseTo(20, 6);
    // The rate is real, and so is the history it is judged against: every
    // held bin is counted again with only one cell to take its flashes, so
    // the doubling is in all of them and the newest is no rise at all.
    expect(after.get("A1")?.sigma).not.toBeNull();
    expect(after.get("A1")?.sigma ?? Infinity).toBeLessThan(1);
    expect(after.get("A1")?.at).toBeNull();
  });

  it("does not call a neighbour drifting away a jump", () => {
    // A neighbour that moves off without leaving: twelve miles north for
    // seven bins, nineteen on the eighth. Still inside two radii, so the set
    // of neighbours never changed, but at nineteen it is too far to claim the
    // storm eight miles north of A1 that it had been taking, and those
    // flashes fall to A1. Resetting on a change of neighbours could not see
    // it and reported a jump at eleven sigma from steady weather.
    const mile = 1 / 69.05;
    const west = cell("A1", 41.6, -93.6);
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    const storms = (at: number) => [
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.6, -93.6, closing(at))),
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.6 + 8 * mile, -93.6, closing(at))),
    ];
    for (let at = 0; at < 7; at += 1) {
      const east = cell("A2", 41.6 + 12 * mile, -93.6);
      rememberJumps([west, east], storms(at), closing(at));
    }
    const drifted = cell("A2", 41.6 + 19 * mile, -93.6);
    const after = rememberJumps([west, drifted], storms(7), closing(7));
    // The flashes did reach A1, which is what makes this a test of anything.
    expect(after.get("A1")?.rate).toBeCloseTo(20, 6);
    expect(after.get("A1")?.at).toBeNull();
  });

  it("still reports a real rise while a distant cell comes and goes", () => {
    // A cell fifteen miles off that the tracker finds on every other scan,
    // which is what a cell table does in a line of storms. It takes none of
    // A1's flashes. Resetting A1's history every time the set of neighbours
    // changed meant a real fivefold rise was never reported.
    const mile = 1 / 69.05;
    const own = cell("A1", 41.6, -93.6);
    const flicker = cell("C3", 41.6 + 15 * mile, -93.6);
    const counts = [20, 22, 20, 22, 20, 22, 20, 100];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, closing(at)));
      found = rememberJumps(
        at % 2 === 0 ? [own, flicker] : [own],
        flashes,
        closing(at),
      );
    });
    expect(found.get("A1")?.rate).toBeCloseTo(50, 6);
    expect(found.get("A1")?.at).not.toBeNull();
  });

  it("does not judge a new cell against flashes from before it was found", () => {
    // History is held as flashes and counted again under the cells there are
    // now, so a cell the tracker has just found could be handed the flashes
    // that fell where it stands before it existed. A storm the tracker has
    // been flashing under for ten minutes before naming it would then read
    // its first bin against that and be called a jump the moment it was
    // found. Its series starts when it does.
    const mile = 1 / 69.05;
    const watching = cell("A1", 41.6, -93.6);
    const born = cell("N9", 41.6 + 15 * mile, -93.6);
    const counts = [20, 22, 20, 22, 20, 22, 20, 60];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6 + 15 * mile, -93.6, closing(at)));
      found = rememberJumps(
        at < 7 ? [watching] : [watching, born],
        flashes,
        closing(at),
      );
    });
    expect(found.get("N9")?.rate).toBeCloseTo(30, 6);
    expect(found.get("N9")?.sigma).toBeNull();
    expect(found.get("N9")?.at).toBeNull();
  });

  it("does not call a centroid that moved onto a storm a jump", () => {
    // The tracker re-centres a cell as it grows or merges, and a centroid that
    // moves five miles brings flashes into its circle that were just outside
    // it. They were there all along. Held only where some cell could claim
    // them at the time, the history would not have them and the move would
    // read as the storm doubling.
    const mile = 1 / 69.05;
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    const storms = (at: number) => [
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.6, -93.6, closing(at))),
      ...new Array(counts[at])
        .fill(null)
        .map(() => flash(41.6 + 12 * mile, -93.6, closing(at))),
    ];
    for (let at = 0; at < 7; at += 1) {
      rememberJumps([cell("A1", 41.6, -93.6)], storms(at), closing(at));
    }
    const moved = cell("A1", 41.6 + 5 * mile, -93.6);
    const after = rememberJumps([moved], storms(7), closing(7));
    expect(after.get("A1")?.rate).toBeCloseTo(20, 6);
    expect(after.get("A1")?.at).toBeNull();
  });

  it("claims a flash out to the radius and not past it", () => {
    // The one distance that decides whether a neighbour can change a cell's
    // count, held from both sides. A rival ring of two radii used to decide
    // it as well, and widening that to eight radii left every test green.
    const mile = 1 / 69.05;
    const inside = flash(41.6 + 9.8 * mile, -93.6);
    const outside = flash(41.6 + 10.2 * mile, -93.6);
    expect(flashesByCell([CELL], [inside]).get("A1")).toBe(1);
    expect(flashesByCell([CELL], [outside]).get("A1")).toBe(0);
  });

  it("reports a fast storm's real rise while its report moves with it", () => {
    // Thirty metres a second to the north, and a fresh report every bin that
    // puts the cell where it has got to. The history is counted again under
    // the newest report, so each old bin has to be counted where the cell was
    // then: counted at the newest position, the oldest bins lie thirteen
    // miles behind a ten-mile circle, read as nothing, and the spread they
    // add buries the doubling at the end.
    const speed = 30;
    const north = (ms: number) => (speed * (ms - AT)) / 1000 / 1000 / 111.32;
    const counts = [24, 26, 24, 26, 24, 26, 24, 26, 52];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const when = closing(at);
      const reportedAt = when - 30_000;
      const moving = cell("A1", 41.6 + north(reportedAt), -93.6, speed, 0);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6 + north(when), -93.6, when));
      found = rememberJumps([moving], flashes, when, false, reportedAt);
    });
    expect(found.get("A1")?.rate).toBeCloseTo(26, 6);
    expect(found.get("A1")?.at).not.toBeNull();
  });

  it("keeps a cell's history while the same neighbours are around it", () => {
    // The other half of it: a cell whose competitors have not changed keeps
    // the series it built, or the check above would be a way of saying
    // nothing ever.
    const west = cell("A1", 41.6, -93.6);
    const east = cell("A2", 41.774, -93.6);
    const counts = [20, 22, 20, 22, 20, 22, 20, 44];
    for (let at = 0; at < counts.length; at += 1) {
      const flashes = new Array(counts[at])
        .fill(null)
        .map(() => flash(41.63, -93.6, closing(at)));
      const found = rememberJumps([west, east], flashes, closing(at));
      if (at === counts.length - 1) {
        expect(found.get("A1")?.sigma).not.toBeNull();
        expect(found.get("A1")?.at).not.toBeNull();
      }
    }
  });

  it("counts only the flashes that fell inside the bin", () => {
    // The window the map hands over is a rolling five minutes, which is two
    // and a half bins of it. Counting the whole window into one bin read
    // every rate two and a half times too high, put that number on the panel,
    // and let any storm above four flashes a minute past a floor written for
    // ten.
    const now = closing(4);
    const window = [
      ...new Array(20).fill(null).map(() => flash(41.6, -93.6, now)),
      ...new Array(30)
        .fill(null)
        .map(() => flash(41.6, -93.6, now - JUMP_BIN_MS)),
      ...new Array(30)
        .fill(null)
        .map(() => flash(41.6, -93.6, now - 2 * JUMP_BIN_MS)),
    ];
    const found = rememberJumps([near], window, now);
    // Twenty flashes in the two minutes of this bin is ten a minute. The
    // whole window is eighty, which read as forty.
    expect(found.get("A1")?.rate).toBeCloseTo(10, 6);
  });

  it("reads a steady storm as steady, at the cadence the app polls at", () => {
    // The whole point of the arithmetic. A storm flashing at exactly thirty a
    // minute, sampled every minute the way `useLightning` does, must read as
    // thirty at every sample rather than alternating. Before the file length
    // was counted it read 45, 36, 45, 36 and never once thirty.
    const rates: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      // Every minute, on a granule boundary, which is where a window's own
      // moment always lands.
      const now = AT + 4 * JUMP_BIN_MS + step * 60_000 - FLASH_GRANULE_MS;
      const bin = binOf(now);
      const opened = bin - JUMP_BIN_MS;
      // Thirty a minute means one flash every two seconds, stamped at the
      // start of the twenty-second file it arrived in.
      const flashes = [];
      for (
        let when = opened;
        when < now + FLASH_GRANULE_MS;
        when += FLASH_GRANULE_MS
      ) {
        for (let one = 0; one < 10; one += 1) {
          flashes.push(flash(41.6, -93.6, when));
        }
      }
      const found = rememberJumps([near], flashes, now);
      const rate = found.get("A1")?.rate;
      if (typeof rate === "number" && rate > 0) rates.push(rate);
    }
    expect(rates.length).toBeGreaterThan(4);
    for (const rate of rates) {
      expect(rate, `${rates.join(", ")}`).toBeCloseTo(30, 6);
    }
  });

  it("counts a flash between two cells to one of them", () => {
    // The tracker publishes a centroid and no size, so the circle is a fixed
    // radius and two cells twelve miles apart overlap. Counting a flash to
    // both meant every cell along a squall line carried the line's rate near
    // it, they all jumped on the same bin, and the badge named five at once.
    //
    // Twelve miles apart: a tenth of a degree of latitude is about seven, so
    // 0.174 degrees is about twelve.
    const west = cell("A1", 41.6, -93.6);
    const east = cell("A2", 41.774, -93.6);
    const between = { latitude: 41.68, longitude: -93.6 };
    // Either circle alone holds it, which is the case at all.
    const alone = flash(between.latitude, between.longitude);
    expect(flashesByCell([west], [alone]).get("A1")).toBe(1);
    expect(flashesByCell([east], [alone]).get("A2")).toBe(1);

    const shared = flashesByCell(
      [west, east],
      [flash(between.latitude, between.longitude)],
    );
    expect(shared.get("A1")! + shared.get("A2")!).toBe(1);
    // And it goes to the nearer one, which is the western cell.
    expect(shared.get("A1")).toBe(1);
    expect(shared.get("A2")).toBe(0);

    // A flash outside both circles belongs to neither.
    const away = flashesByCell([west, east], [flash(43.5, -93.6)]);
    expect(away.get("A1")).toBe(0);
    expect(away.get("A2")).toBe(0);

    // And every cell has an entry, so a quiet cell reads as no flashes
    // rather than as no answer.
    expect([...shared.keys()].sort()).toEqual(["A1", "A2"]);
  });

  it("does not fold one flash into two overlapping cells", () => {
    // The fold path, not the helper: two cells twelve miles apart, and a
    // storm flashing between them. Every flash used to enter both series, so
    // along a squall line each cell carried the line's rate near it.
    const east = cell("A2", 41.774, -93.6);
    const when = closing(0);
    const flashes = new Array(24)
      .fill(null)
      .map(() => flash(41.68, -93.6, when));
    const found = rememberJumps([near, east], flashes, when);
    const west = found.get("A1")?.rate ?? 0;
    const other = found.get("A2")?.rate ?? 0;
    // Twenty-four flashes in two minutes is twelve a minute, once.
    expect(west + other).toBeCloseTo(12, 6);
    expect(west).toBeCloseTo(12, 6);
    expect(other).toBe(0);
  });

  it("counts each cell only its own flashes", () => {
    const when = closing(0);
    const flashes = [
      ...new Array(30).fill(null).map(() => flash(41.6, -93.6, when)),
      ...new Array(4).fill(null).map(() => flash(43.0, -93.6, when)),
    ];
    const found = rememberJumps([near, other], flashes, when);
    expect(found.get("A1")?.rate).toBeCloseTo(15, 6);
    expect(found.get("B2")?.rate).toBeCloseTo(2, 6);
  });

  it("rates a bin by the part of it that has actually happened", () => {
    // The window arrives every minute and a bin is two, so the newest bin is
    // usually part way through. A bin must be at least three quarters covered
    // before it is rated. This observation is 100 seconds into the bin, which
    // is past the 90-second floor.
    const mostlyDone =
      AT + JUMP_BIN_MS + JUMP_BIN_MS - JUMP_BIN_MS / 4 - FLASH_GRANULE_MS;
    const flashes = new Array(50)
      .fill(null)
      .map(() => flash(41.6, -93.6, mostlyDone));
    const found = rememberJumps([near], flashes, mostlyDone);
    // Fifty flashes over roughly 100 seconds of the bin.
    const rate = found.get("A1")?.rate ?? 0;
    expect(rate).toBeGreaterThan(25);
    expect(rate).toBeLessThan(35);
  });

  it("does not rate a bin that has barely opened", () => {
    // Four seconds of a two-minute bin is a rate with an enormous error bar
    // on it, and the series is what the deviation is measured against: one
    // noisy bin moves the sigma more than the storm does.
    // The first file of a bin: four seconds of it counted, twenty covered.
    const opened = AT + JUMP_BIN_MS;
    const flashes = new Array(3)
      .fill(null)
      .map(() => flash(41.6, -93.6, opened));
    const found = rememberJumps([near], flashes, opened);
    // Nothing was folded, so there is no rate at all rather than a wild one.
    expect(found.get("A1")?.rate).toBe(0);

    // And the same bin, once it has run long enough, is folded and rated.
    const later = AT + 2 * JUMP_BIN_MS - FLASH_GRANULE_MS;
    const more = new Array(40).fill(null).map(() => flash(41.6, -93.6, later));
    const settled = rememberJumps([near], more, later);
    expect(settled.get("A1")?.rate).toBeCloseTo(20, 6);
  });

  it("does not fold a trimmed window into the series", () => {
    // A trimmed window dropped flashes, so the count is a lower bound. Rating
    // it against full bins reads any steady storm as a drop. The series keeps
    // what it had.
    const counts = [24, 26, 24, 26, 24, 26, 24];
    counts.forEach((count, at) => {
      const when = closing(at);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, when));
      rememberJumps([near], flashes, when);
    });
    // Trimmed window with a jump-sized count: should not fold and should not
    // report a jump in the bin after it.
    const trimmedWhen = closing(7);
    const trimmedFlashes = new Array(52)
      .fill(null)
      .map(() => flash(41.6, -93.6, trimmedWhen));
    const found = rememberJumps([near], trimmedFlashes, trimmedWhen, true);
    expect(found.get("A1")?.at).toBeNull();
  });

  it("holds a jump for at least one bin after it fires", () => {
    // A jump that fires on one poll and vanishes on the next is too fast to
    // read. The badge stays for one full bin.
    const counts = [24, 26, 24, 26, 24, 26, 52];
    counts.forEach((count, at) => {
      const when = closing(at);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, when));
      rememberJumps([near], flashes, when);
    });
    // The jump fired on bin 6. The next bin goes back to normal.
    const nextWhen = closing(7);
    const nextFlashes = new Array(24)
      .fill(null)
      .map(() => flash(41.6, -93.6, nextWhen));
    const held = rememberJumps([near], nextFlashes, nextWhen);
    // The jump is held: at is not null.
    expect(held.get("A1")?.at).not.toBeNull();
    // But one more bin later it is gone.
    const laterWhen = closing(8);
    const laterFlashes = new Array(24)
      .fill(null)
      .map(() => flash(41.6, -93.6, laterWhen));
    const gone = rememberJumps([near], laterFlashes, laterWhen);
    expect(gone.get("A1")?.at).toBeNull();
  });

  it("never reports a time in the future", () => {
    // The bin's end can be up to two minutes ahead of now. The reported time
    // must be the bin's start.
    const counts = [24, 26, 24, 26, 24, 26, 52];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const when = closing(at);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, when));
      found = rememberJumps([near], flashes, when);
    });
    const jumpAt = found.get("A1")?.at;
    expect(jumpAt).not.toBeNull();
    // The observation time of the last window.
    const observed = closing(6);
    expect(jumpAt!).toBeLessThanOrEqual(observed);
  });

  it("keeps a flat count through a cell report refresh with motion", () => {
    // A cell at 30 knots (~15.4 m/s) moving northeast. Its position was
    // reported 2 minutes before the first window. Without advection the
    // centroid is about half a mile behind, which on its own does not lose
    // flashes but does shift the circle enough to matter at the edge.
    const movingCell = cell("A1", 41.6, -93.6, 15.4, 45);
    const reportedAt = AT - 2 * 60_000;
    const counts = [24, 26, 24, 26, 24, 26, 24, 26, 24, 26];
    const collectedRates: number[] = [];
    counts.forEach((count, at) => {
      const when = closing(at);
      const flashes = new Array(count)
        .fill(null)
        .map(() => flash(41.6, -93.6, when));
      const found = rememberJumps(
        [movingCell],
        flashes,
        when,
        false,
        reportedAt,
      );
      const rate = found.get("A1")?.rate;
      if (typeof rate === "number" && rate > 0) collectedRates.push(rate);
    });
    expect(collectedRates.length).toBeGreaterThan(4);
    const mean =
      collectedRates.reduce((s, r) => s + r, 0) / collectedRates.length;
    for (const rate of collectedRates) {
      expect(Math.abs(rate - mean)).toBeLessThan(2);
    }
  });
});

describe("each cell's history, counted against the storms as they stand now", () => {
  // Miles as the app's own distance measures them: a degree of latitude is
  // 69.09 of them on the sphere `haversineMiles` uses.
  const mile = 1 / 69.0933;

  /** Where a cell has got to after moving at a speed and heading for a time. */
  function moved(
    latitude: number,
    longitude: number,
    speedMs: number,
    directionDegrees: number,
    seconds: number,
  ) {
    const km = (speedMs * seconds) / 1000;
    const rad = (directionDegrees * Math.PI) / 180;
    return {
      latitude: latitude + (km * Math.cos(rad)) / 111.32,
      longitude:
        longitude +
        (km * Math.sin(rad)) / (111.32 * Math.cos((latitude * Math.PI) / 180)),
    };
  }

  function many(
    count: number,
    latitude: number,
    longitude: number,
    at: number,
  ) {
    return new Array(count)
      .fill(null)
      .map(() => flash(latitude, longitude, at));
  }

  it("does not call a neighbour moving away on its own reported motion a jump", () => {
    // A1 stands still over a storm, with a second storm 7.9 miles north of
    // it. A2 starts twelve miles north and moves off northward at eight
    // metres a second with that motion in every report, so on the last bin it
    // is past 15.8 miles and the storm between them is nearer A1. Moving
    // every cell back to where it was put A2 back where it could still take
    // that storm in the old bins alone, and the newest bin read as a jump.
    const still = cell("A1", 41.6, -93.6);
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const when = closing(at);
      const reportedAt = when - 30_000;
      const where = moved(
        41.6 + 12 * mile,
        -93.6,
        8,
        0,
        (reportedAt - closing(0)) / 1000,
      );
      const leaving = cell("A2", where.latitude, where.longitude, 8, 0);
      found = rememberJumps(
        [still, leaving],
        [
          ...many(count, 41.6, -93.6, when),
          ...many(count, 41.6 + 7.9 * mile, -93.6, when),
        ],
        when,
        false,
        reportedAt,
      );
    });
    // The storm between them did reach A1, which is what makes this a test.
    expect(found.get("A1")?.rate).toBeCloseTo(20, 6);
    expect(found.get("A1")?.at).toBeNull();
  });

  it("does not call it a jump when the whole line moves and one storm moves faster", () => {
    // Both cells moving north-east at fifteen metres a second, A2 with eight
    // more to the north on top, and A1's two storms moving with A1.
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    const east = 15 * Math.sin(Math.PI / 4);
    const north = 15 * Math.cos(Math.PI / 4);
    const fasterSpeed = Math.hypot(east, north + 8);
    const fasterHeading = (Math.atan2(east, north + 8) * 180) / Math.PI;
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const when = closing(at);
      const reportedAt = when - 30_000;
      const since = (reportedAt - closing(0)) / 1000;
      const a = moved(41.6, -93.6, 15, 45, since);
      const b = moved(
        41.6 + 12 * mile,
        -93.6,
        fasterSpeed,
        fasterHeading,
        since,
      );
      const here = moved(41.6, -93.6, 15, 45, (when - closing(0)) / 1000);
      found = rememberJumps(
        [
          cell("A1", a.latitude, a.longitude, 15, 45),
          cell("A2", b.latitude, b.longitude, fasterSpeed, fasterHeading),
        ],
        [
          ...many(count, here.latitude, here.longitude, when),
          ...many(count, here.latitude + 7.9 * mile, here.longitude, when),
        ],
        when,
        false,
        reportedAt,
      );
    });
    expect(found.get("A1")?.rate).toBeCloseTo(20, 6);
    expect(found.get("A1")?.at).toBeNull();
  });

  it("reports a fast storm's real rise while it moves east", () => {
    // The same as the storm moving north above, across degrees of longitude
    // instead, which are the ones that narrow with latitude: a history carried
    // north alone would leave every old bin behind a circle that has moved on.
    const counts = [24, 26, 24, 26, 24, 26, 24, 26, 52];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    counts.forEach((count, at) => {
      const when = closing(at);
      const reportedAt = when - 30_000;
      const reported = moved(41.6, -93.6, 30, 90, (reportedAt - AT) / 1000);
      const here = moved(41.6, -93.6, 30, 90, (when - AT) / 1000);
      found = rememberJumps(
        [cell("A1", reported.latitude, reported.longitude, 30, 90)],
        many(count, here.latitude, here.longitude, when),
        when,
        false,
        reportedAt,
      );
    });
    expect(found.get("A1")?.rate).toBeCloseTo(26, 6);
    expect(found.get("A1")?.at).not.toBeNull();
  });

  it("does not call a centroid moved further than the bins looked a jump", () => {
    // The tracker re-centres A1 twelve miles north, between a storm sixteen
    // miles north of where it was and another at twenty-one. The bins held
    // flashes out to twenty miles of the cells of their moment, so they have
    // the first storm and never had the second: counted as they stand, the
    // history lacks a storm that was there all along and the move reads as
    // the rate doubling. The bins that never looked at the whole of the new
    // circle are not counted at all.
    const counts = [20, 22, 20, 22, 20, 22, 20, 20];
    const storms = (at: number) => [
      ...many(counts[at], 41.6 + 16 * mile, -93.6, closing(at)),
      ...many(counts[at], 41.6 + 21 * mile, -93.6, closing(at)),
    ];
    for (let at = 0; at < 7; at += 1) {
      rememberJumps([cell("A1", 41.6, -93.6)], storms(at), closing(at));
    }
    const after = rememberJumps(
      [cell("A1", 41.6 + 12 * mile, -93.6)],
      storms(7),
      closing(7),
    );
    expect(after.get("A1")?.rate).toBeCloseTo(20, 6);
    expect(after.get("A1")?.sigma).toBeNull();
    expect(after.get("A1")?.at).toBeNull();
  });

  it("keeps a history through a centroid that wanders a few miles each scan", () => {
    // The tracker's centroid for one storm moves four miles east and west of
    // it on alternate scans. That is ordinary wander, well inside what a bin
    // holds, and a real rise at the end has to be reported through it.
    const counts = [20, 22, 20, 22, 20, 22, 20, 100];
    let found = new Map<string, ReturnType<typeof jumpIn>>();
    const lonMile = mile / Math.cos((41.6 * Math.PI) / 180);
    counts.forEach((count, at) => {
      const wander = at % 2 === 0 ? 4 : -4;
      found = rememberJumps(
        [cell("A1", 41.6, -93.6 + wander * lonMile)],
        many(count, 41.6, -93.6, closing(at)),
        closing(at),
      );
    });
    expect(found.get("A1")?.rate).toBeCloseTo(50, 6);
    expect(found.get("A1")?.at).not.toBeNull();
  });

  it("starts a reused identifier's history again", () => {
    // A1 is dropped for one scan while A2 stays beside it, then an A1 comes
    // back over the same storm. Identifiers are reused, so the A1 that comes
    // back is judged as new: its series starts where it reappeared.
    const counts = [20, 26, 18, 24, 20, 26, 18, 24, 20];
    const a2 = cell("A2", 41.6, -93.6 + 9 * mile);
    counts.forEach((count, at) => {
      rememberJumps(
        at === 7 ? [a2] : [cell("A1", 41.6, -93.6), a2],
        many(count, 41.6, -93.6, closing(at)),
        closing(at),
      );
    });
    const back = rememberJumps(
      [cell("A1", 41.6, -93.6), a2],
      many(counts[8], 41.6, -93.6, closing(8)),
      closing(8),
    );
    expect(back.get("A1")?.rate).toBeCloseTo(10, 6);
    expect(back.get("A1")?.sigma).toBeNull();
  });

  it("counts a flash to the radius and not past it, in the series as well", () => {
    const found = rememberJumps(
      [CELL],
      [
        ...many(20, 41.6 + 9.8 * mile, -93.6, closing(0)),
        ...many(20, 41.6 + 10.2 * mile, -93.6, closing(0)),
      ],
      closing(0),
    );
    expect(found.get("A1")?.rate).toBeCloseTo(10, 6);
  });

  it("gives a flash halfway between two cells to the one listed first", () => {
    // Quarter degrees, which binary holds exactly, so the two distances are
    // the same number and not two that differ in the last digit.
    const west = cell("A1", 41.5, -93.625);
    const east = cell("A2", 41.5, -93.375);
    const found = rememberJumps(
      [west, east],
      many(20, 41.5, -93.5, closing(0)),
      closing(0),
    );
    expect(found.get("A1")?.rate).toBeCloseTo(10, 6);
    expect(found.get("A2")?.rate).toBe(0);
    // And the other way round when the tracker lists them the other way.
    forgetJumps();
    const turned = rememberJumps(
      [east, west],
      many(20, 41.5, -93.5, closing(0)),
      closing(0),
    );
    expect(turned.get("A2")?.rate).toBeCloseTo(10, 6);
    expect(turned.get("A1")?.rate).toBe(0);
  });

  it("claims a flash just inside the radius due north and due east", () => {
    // Due north is where the latitude shortcut does all the deciding, and a
    // degree of longitude is narrower than one of latitude, so due east is
    // where the search has to reach furthest in degrees. The search runs from
    // the flash out to the cells, so each cell sits just inside the far edge
    // of a bucket of the index, which is where a reach cut short would stop
    // one bucket too soon.
    const north = cell("N1", 41.799, -93.6);
    const upward = flash(41.799 + 9.95 * mile, -93.6);
    expect(Math.floor(north.latitude / 0.2)).toBe(208);
    expect(Math.floor((upward.latitude - 10 / 69.09) / 0.2)).toBe(208);
    expect(flashesByCell([north], [upward]).get("N1")).toBe(1);

    const east = cell("E1", 41.6, -93.401);
    const across = flash(
      41.6,
      -93.401 + (9.95 * mile) / Math.cos((41.6 * Math.PI) / 180),
    );
    expect(Math.floor(east.longitude / 0.2)).toBe(-468);
    expect(flashesByCell([east], [across]).get("E1")).toBe(1);
  });

  it("reads a sixty-cell line lying east to west without scanning every pair", () => {
    // Every cell shares a latitude with every flash, which is the one layout
    // the latitude shortcut cannot help with. Twelve miles apart, with four
    // hundred flashes a bin round each, for seven bins.
    const lonMile = mile / Math.cos((35 * Math.PI) / 180);
    const line = Array.from({ length: 60 }, (_, index) =>
      cell(`L${index}`, 35, -100 + index * 12 * lonMile),
    );
    const started = performance.now();
    for (let at = 0; at < 7; at += 1) {
      const flashes = line.flatMap((one, index) =>
        many(
          400 + (index % 3),
          one.latitude + 2 * mile,
          one.longitude,
          closing(at),
        ),
      );
      rememberJumps(line, flashes, closing(at));
    }
    const took = performance.now() - started;
    // Generous, because a test machine is busy: the scan over every pair this
    // replaced took several times this on its own.
    expect(took).toBeLessThan(1500);
  });
});

describe("Poisson false positive rate", () => {
  it("fires on under 2.5% of bins for a steady 30-a-minute storm", () => {
    // The acceptance criterion: a thousand steady storms must not trigger
    // more than 2.5% of the time from Poisson noise alone. A trigger is a
    // NEW jump detection, not a held display from the previous bin.
    let totalBins = 0;
    let triggers = 0;
    // A simple seeded PRNG (xorshift32) for reproducibility.
    let seed = 12345;
    function nextRandom(): number {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }
    function poisson(lambda: number): number {
      const limit = Math.exp(-lambda);
      let count = 0;
      let product = 1;
      do {
        count += 1;
        product *= nextRandom();
      } while (product > limit);
      return count - 1;
    }

    for (let trial = 0; trial < 1000; trial += 1) {
      forgetJumps();
      const trialCell = cell("T1", 41.6, -93.6);
      let prevAt: number | null = null;
      for (let bin = 0; bin < 20; bin += 1) {
        const when = closing(bin);
        const count = poisson(60);
        const flashes = new Array(count)
          .fill(null)
          .map(() => flash(41.6, -93.6, when));
        const found = rememberJumps([trialCell], flashes, when);
        if (bin >= JUMP_HISTORY_BINS - 1) {
          totalBins += 1;
          const jumpAt = found.get("T1")?.at ?? null;
          if (jumpAt !== null && jumpAt !== prevAt) triggers += 1;
          prevAt = jumpAt;
        }
      }
    }
    const falsePositiveRate = triggers / totalBins;
    expect(
      falsePositiveRate,
      `${triggers} triggers in ${totalBins} bins (${(falsePositiveRate * 100).toFixed(1)}%)`,
    ).toBeLessThan(0.025);
  });
});

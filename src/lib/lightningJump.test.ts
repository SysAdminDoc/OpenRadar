import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FLASH_GRANULE_MS,
  JUMP_BIN_MS,
  JUMP_HISTORY_BINS,
  JUMP_MIN_RATE,
  binOf,
  changes,
  flashesNear,
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

const CELL = { latitude: 41.6, longitude: -93.6 };

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
    expect(flashesNear(CELL, [near, far])).toBe(1);
    // The radius is what decides, not the count: widened, both belong to it.
    expect(flashesNear(CELL, [near, far], 20)).toBe(2);
    expect(flashesNear(CELL, [])).toBe(0);
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
    expect(doubled.at).toBe(AT);
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
  const near = { id: "A1", latitude: 41.6, longitude: -93.6 };
  const other = { id: "B2", latitude: 43.0, longitude: -93.6 };

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
    // usually part way through. Dividing a minute of flashes by two minutes
    // halves the rate; with the window landing near a bin's first instant it
    // reads as almost nothing and the next arrival as almost double, so a
    // storm flashing steadily at thirty a minute came out as 0.5, 15.5, 0.5,
    // 15.5 and never once as thirty.
    // A window whose newest file starts forty seconds before the bin's
    // midpoint, so the observation covers exactly one minute of it.
    const half = AT + JUMP_BIN_MS + JUMP_BIN_MS / 2 - FLASH_GRANULE_MS;
    const flashes = new Array(30)
      .fill(null)
      .map(() => flash(41.6, -93.6, half));
    const found = rememberJumps([near], flashes, half);
    // Thirty flashes over the minute of the bin that has been watched.
    expect(found.get("A1")?.rate).toBe(30);
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
});

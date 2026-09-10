import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
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
  }));
}

function flash(latitude: number, longitude: number): Flash {
  return {
    latitude,
    longitude,
    energyJoules: 1,
    areaSquareKm: 10,
    time: AT / 1000,
  };
}

const CELL = { latitude: 41.6, longitude: -93.6 };

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

    // One bin short of the history the method asks for is still too short.
    const nearly = jumpIn(series(new Array(JUMP_HISTORY_BINS - 1).fill(20)));
    expect(nearly.sigma).toBeNull();

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
    held = withSample(held, { at: AT, flashes: 10 });
    held = withSample(held, { at: AT, flashes: 18 });
    expect(held).toHaveLength(1);
    expect(held[0].flashes).toBe(18);

    held = withSample(held, { at: AT + JUMP_BIN_MS, flashes: 20 });
    expect(held).toHaveLength(2);
  });

  it("drops history it can no longer judge against", () => {
    let held: JumpSample[] = series(new Array(20).fill(10));
    held = withSample(held, { at: AT + JUMP_BIN_MS, flashes: 10 });
    expect(held.length).toBeLessThanOrEqual(JUMP_HISTORY_BINS + 1);
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
      const flashes = new Array(count).fill(null).map(() => flash(41.6, -93.6));
      found = rememberJumps([near], flashes, AT + at * JUMP_BIN_MS);
    });
    expect(found.get("A1")?.at).not.toBeNull();
    expect(found.get("A1")?.rate).toBe(26);
  });

  it("folds the same window twice to the same answer", () => {
    // What makes it safe to do while rendering. A second pass lands in the
    // bin it already filled and replaces it with the same count.
    const flashes = new Array(24).fill(null).map(() => flash(41.6, -93.6));
    const once = rememberJumps([near], flashes, AT);
    const twice = rememberJumps([near], flashes, AT);
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
      new Array(counts[at]).fill(null).map(() => flash(41.6, -93.6));
    for (let at = 0; at < 6; at += 1) {
      rememberJumps([near, other], near_at(at), AT + at * JUMP_BIN_MS);
    }
    // `B2` goes away and comes back, and comes back with nothing behind it.
    rememberJumps([near], near_at(6), AT + 6 * JUMP_BIN_MS);
    const back = rememberJumps(
      [near, other],
      [
        ...near_at(7),
        ...new Array(100).fill(null).map(() => flash(43.0, -93.6)),
      ],
      AT + 7 * JUMP_BIN_MS,
    );
    expect(back.get("B2")?.sigma).toBeNull();
    // And the cell that stayed kept its own history.
    expect(back.get("A1")?.sigma).not.toBeNull();
  });

  it("counts each cell only its own flashes", () => {
    const flashes = [
      ...new Array(30).fill(null).map(() => flash(41.6, -93.6)),
      ...new Array(4).fill(null).map(() => flash(43.0, -93.6)),
    ];
    const found = rememberJumps([near, other], flashes, AT);
    expect(found.get("A1")?.rate).toBe(15);
    expect(found.get("B2")?.rate).toBe(2);
  });
});

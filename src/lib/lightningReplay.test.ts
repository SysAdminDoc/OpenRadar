import { describe, expect, it } from "vitest";
import {
  replayWindowAt,
  type FlashReplay,
  type ReplayFlash,
} from "./lightningReplay";

const START = 1_779_300_000;

function flash(time: number, order: number): ReplayFlash {
  return {
    latitude: 32.8,
    longitude: -96.8,
    energyJoules: 1,
    areaSquareKm: 1,
    time,
    order,
  };
}

/** Twenty files, twenty seconds apart, each holding `each` flashes in all. */
function replay(each: number, maxFlashes = 20_000): FlashReplay {
  const files = Array.from({ length: 20 }, (_, index) => ({
    time: START + index * 20,
    read: true,
    flashes: each,
  }));
  return {
    satellite: "GOES-19 East",
    windowMinutes: 5,
    fileSeconds: 20,
    maxFiles: 15,
    maxFlashes,
    files,
    // Two near a place in every file, the first and the last it held.
    flashes: files.flatMap((file) => [
      flash(file.time, 0),
      flash(file.time, each - 1),
    ]),
  };
}

describe("the window the live watch would have held", () => {
  it("holds only files that had finished, from the five minutes before", () => {
    const window = replayWindowAt(replay(10), (START + 400) * 1000);
    // Files begin at START to START + 380. At START + 400 the one that began
    // at 380 has just finished, and the five minutes before reach back to
    // START + 100, which is fifteen files.
    expect(window?.filesExpected).toBe(15);
    expect(window?.observed).toBe(START + 380);
    const times = new Set(window?.flashes.map((each) => each.time));
    expect(Math.min(...times)).toBe(START + 100);
    // One that has only begun is not there yet.
    const early = replayWindowAt(replay(10), (START + 399) * 1000);
    expect(early?.observed).toBe(START + 360);
  });

  it("keeps the newest fifteen when more than that fall in the window", () => {
    // Twenty seconds apart, five minutes never holds more than fifteen. A
    // listing with files ten seconds apart does, and the live feed keeps the
    // newest fifteen of those, which is half the window.
    const dense = replay(10);
    dense.files = Array.from({ length: 40 }, (_, index) => ({
      time: START + index * 10,
      read: true,
      flashes: 10,
    }));
    dense.flashes = dense.files.map((file) => flash(file.time, 0));
    const window = replayWindowAt(dense, (START + 400) * 1000);
    expect(window?.filesExpected).toBe(15);
    expect(Math.min(...(window?.flashes.map((each) => each.time) ?? []))).toBe(
      START + 240,
    );
  });

  it("is no window at all before any file had finished, or where none was read", () => {
    expect(replayWindowAt(replay(10), (START + 19) * 1000)).toBeNull();
    const unread = replay(10);
    unread.files = unread.files.map((file) => ({ ...file, read: false }));
    expect(replayWindowAt(unread, (START + 400) * 1000)).toBeNull();
  });

  it("counts a file that could not be read as expected, not as read", () => {
    const gappy = replay(10);
    gappy.files[18] = { ...gappy.files[18], read: false, flashes: 0 };
    gappy.flashes = gappy.flashes.filter(
      (each) => each.time !== gappy.files[18].time,
    );
    const window = replayWindowAt(gappy, (START + 400) * 1000);
    expect(window?.filesExpected).toBe(15);
    expect(window?.filesRead).toBe(14);
  });

  it("trims the oldest flashes when the whole window holds more than the cap", () => {
    // Fifteen files of a hundred is fifteen hundred, against a cap of a
    // thousand and fifty: the oldest four files go whole, and the first
    // fifty of the fifth, which takes its first flash and keeps its last.
    const window = replayWindowAt(replay(100, 1_050), (START + 400) * 1000);
    expect(window?.trimmed).toBe(true);
    const kept = window?.flashes ?? [];
    expect(kept.some((each) => each.time < START + 180)).toBe(false);
    expect(
      kept
        .filter((each) => each.time === START + 180)
        .map((each) => (each as ReplayFlash).order),
    ).toEqual([99]);
    expect(kept.filter((each) => each.time > START + 180)).toHaveLength(20);
    // Under the cap nothing goes.
    const whole = replayWindowAt(replay(100), (START + 400) * 1000);
    expect(whole?.trimmed).toBe(false);
    expect(whole?.flashes).toHaveLength(30);
  });
});

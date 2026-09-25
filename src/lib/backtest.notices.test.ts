import { describe, expect, it } from "vitest";
import { backtestApproaches, backtestLightning } from "./backtest";
import { DEFAULT_APPROACH, type ApproachSettings } from "./approach";
import type { CellReport, CellsReplay, StormCell } from "./cells";
import type { FlashReplay, ReplayFile, ReplayFlash } from "./lightningReplay";
import { DEFAULT_LIGHTNING_RULE, type LightningRule } from "./lightningWatch";
import { DEFAULT_QUIET_HOURS, type WatchPlace } from "./watch";

// Local times, because quiet hours are the reader's own clock.
const day = (hour: number, minute = 0, second = 0) =>
  new Date(2026, 4, 20, hour, minute, second).getTime();
const seconds = (at: number) => Math.floor(at / 1000);

const home: WatchPlace = {
  id: "home",
  name: "Home",
  named: false,
  enabled: true,
  center: [-96.8, 32.78],
  radiusMiles: 30,
  minSeverity: "moderate",
  sound: false,
};
const quietUntil = (hour: number, minute = 0): WatchPlace => ({
  ...home,
  quietHours: {
    ...DEFAULT_QUIET_HOURS,
    enabled: true,
    startMinute: 13 * 60,
    endMinute: hour * 60 + minute,
  },
});

const rule: LightningRule = {
  ...DEFAULT_LIGHTNING_RULE,
  enabled: true,
  radiusMiles: 10,
  count: 3,
};

const from = day(13, 30);
const to = day(16, 0);

/**
 * A day of the satellite's files, one every twenty seconds from five minutes
 * before the replay to its end, with one flash over home in each file from
 * `first` to `last`, and in each file of any `more` stretches. Every file
 * holds a hundred flashes in all, the rest of them somewhere else.
 */
function flashDay(
  first: number,
  last: number,
  missing: (time: number) => boolean = () => false,
  more: Array<[number, number]> = [],
): FlashReplay {
  const stormy = [[first, last], ...more].map(
    ([start, end]) => [seconds(start), seconds(end)] as const,
  );
  const files: ReplayFile[] = [];
  const flashes: ReplayFlash[] = [];
  for (let time = seconds(from) - 300; time <= seconds(to); time += 20) {
    const read = !missing(time);
    files.push({ time, read, flashes: read ? 100 : 0 });
    if (read && stormy.some(([start, end]) => time >= start && time <= end)) {
      flashes.push({
        latitude: home.center[1] + 0.02,
        longitude: home.center[0],
        energyJoules: 1,
        areaSquareKm: 1,
        time,
        order: 7,
      });
    }
  }
  return {
    satellite: "GOES-19 East",
    windowMinutes: 5,
    fileSeconds: 20,
    maxFiles: 15,
    maxFlashes: 20_000,
    files,
    flashes,
  };
}

function lightningLines(
  replay: FlashReplay,
  place: WatchPlace = home,
  asked: LightningRule = rule,
) {
  return (
    backtestLightning(replay, [place], asked, from, to)
      .get(place.id)
      ?.map((line) => ({
        kind: line.notice.kind,
        said: line.said,
        heldFrom: line.heldFrom,
      })) ?? []
  );
}

describe("replaying a stormy afternoon through the lightning notice", () => {
  // Flashes over home from two o'clock to twenty past.
  const storm = flashDay(day(14), day(14, 20));

  it("says it started once the window holds enough, and quiet half an hour after the last flash", () => {
    // At 14:01 the three files that began at 14:00:00, :20 and :40 have all
    // finished, which is the third flash. The last flash is in the file that
    // began at 14:20:00, so half an hour later is 14:50.
    expect(lightningLines(storm)).toEqual([
      { kind: "started", said: day(14, 1), heldFrom: null },
      { kind: "quiet", said: day(14, 50), heldFrom: null },
    ]);
  });

  it("holds the first notice through quiet hours, and never the all-clear", () => {
    expect(lightningLines(storm, quietUntil(14, 10))).toEqual([
      { kind: "started", said: day(14, 10), heldFrom: day(14, 1) },
      { kind: "quiet", said: day(14, 50), heldFrom: null },
    ]);
  });

  it("says when quiet hours held a storm back from start to finish", () => {
    expect(lightningLines(storm, quietUntil(15))).toEqual([
      { kind: "started", said: null, heldFrom: day(14, 1) },
    ]);
  });

  it("closes a storm quiet hours held back before the next one starts", () => {
    // The first storm is over inside quiet hours. The second starts after
    // they end, and is its own storm rather than the first one said late.
    const two = flashDay(day(14), day(14, 20), undefined, [
      [day(15, 10), day(15, 20)],
    ]);
    expect(lightningLines(two, quietUntil(15))).toEqual([
      { kind: "started", said: null, heldFrom: day(14, 1) },
      { kind: "started", said: day(15, 11), heldFrom: null },
      { kind: "quiet", said: day(15, 50), heldFrom: null },
    ]);
  });

  it("does not call a gap in the archive quiet sky", () => {
    // Nothing could be read from twenty-one past until three. The live watch
    // skips a window that did not come, so the all-clear waits for the first
    // window after the gap rather than being said in the middle of it.
    const gap = flashDay(
      day(14),
      day(14, 20),
      (time) => time > seconds(day(14, 20)) && time < seconds(day(15)),
    );
    expect(lightningLines(gap)).toEqual([
      { kind: "started", said: day(14, 1), heldFrom: null },
      { kind: "quiet", said: day(15, 1), heldFrom: null },
    ]);
  });

  it("says nothing with the notice off, a place switched off, or too few flashes", () => {
    expect(lightningLines(storm, home, { ...rule, enabled: false })).toEqual(
      [],
    );
    expect(
      backtestLightning(storm, [{ ...home, enabled: false }], rule, from, to)
        .size,
    ).toBe(0);
    // Two flashes, and three asked for.
    expect(lightningLines(flashDay(day(14), day(14, 0, 20)))).toEqual([]);
  });
});

/** Due east at fifteen metres a second, from a set distance west of home. */
function cellWestOfHome(id: string, kilometres: number): StormCell {
  const latitude = home.center[1];
  const perDegree = 111.32 * Math.cos((latitude * Math.PI) / 180);
  return {
    id,
    latitude,
    longitude: home.center[0] - kilometres / perDegree,
    rangeKm: 0,
    azimuthDegrees: 0,
    directionDegrees: 90,
    speedMs: 15,
    forecast: [],
    past: [],
  };
}

/**
 * A site's storm tracking every five minutes from 13:25, following one storm
 * that is thirty kilometres west of home at half past one and closing at
 * fifteen metres a second, so it reaches home at about 14:03:20.
 */
function trackedDay(firstTracked = day(13, 25)): CellsReplay {
  const reports = [];
  for (let at = day(13, 25); at <= to; at += 5 * 60_000) {
    const kilometres =
      at < firstTracked ? 0 : 30 - (0.9 * (at - from)) / 60_000;
    const report: CellReport = {
      station: "KFWS",
      siteLatitude: 32.57,
      siteLongitude: -97.3,
      observed: new Date(at).toISOString(),
      cells: kilometres > 0 ? [cellWestOfHome("Q4", kilometres)] : [],
      mesocyclones: [],
    };
    reports.push({ published: seconds(at), report });
  }
  return { reports, unread: 0 };
}

const approach: ApproachSettings = {
  ...DEFAULT_APPROACH,
  enabled: true,
  minutes: 20,
};

function approachLines(
  place: WatchPlace = home,
  asked = approach,
  replay = trackedDay(),
) {
  return (
    backtestApproaches(replay, [place], asked, from, to)
      .get(place.id)
      ?.map((line) => ({
        cell: line.notice.cellId,
        said: line.said,
        heldFrom: line.heldFrom,
        minutes: Math.round(line.notice.minutes),
      })) ?? []
  );
}

describe("replaying a storm through the approach notice", () => {
  it("says a storm once, at the first minute it is inside the threshold", () => {
    // Twenty minutes out at 13:43:20, so the first minute to see it is 13:44,
    // read off the 13:40 product that the 13:42 poll picked up.
    expect(approachLines()).toEqual([
      { cell: "Q4", said: day(13, 44), heldFrom: null, minutes: 19 },
    ]);
  });

  it("asks the tracker at the pace the live reader does", () => {
    // First tracked in the 13:45 product, already inside the threshold. The
    // reader asks every four minutes from 13:30, so it hears at 13:46, not
    // the minute the product went out.
    expect(approachLines(home, approach, trackedDay(day(13, 45)))).toEqual([
      { cell: "Q4", said: day(13, 46), heldFrom: null, minutes: 17 },
    ]);
  });

  it("holds it through quiet hours and says it when they end", () => {
    expect(approachLines(quietUntil(13, 50))).toEqual([
      { cell: "Q4", said: day(13, 50), heldFrom: day(13, 44), minutes: 13 },
    ]);
  });

  it("says when quiet hours held it back until the storm had been and gone", () => {
    expect(approachLines(quietUntil(15))).toEqual([
      { cell: "Q4", said: null, heldFrom: day(13, 44), minutes: 19 },
    ]);
  });

  it("says nothing with the notice off or the threshold never reached", () => {
    expect(approachLines(home, { ...approach, enabled: false })).toEqual([]);
    // Ten minutes asked for, and the storm is inside ten from 13:53:20.
    expect(approachLines(home, { ...approach, minutes: 10 })).toEqual([
      { cell: "Q4", said: day(13, 54), heldFrom: null, minutes: 9 },
    ]);
  });
});

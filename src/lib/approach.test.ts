import { describe, expect, it } from "vitest";
import {
  APPROACH_MINUTES,
  DEFAULT_APPROACH,
  approachKey,
  approachesFor,
  approachesToAnnounce,
  type Approach,
} from "./approach";
import type { CellReport, StormCell } from "./cells";
import type { WatchPlace } from "./watch";

const OBSERVED = "2026-09-03T18:00:00Z";
const NOW = Date.parse(OBSERVED);

/**
 * A cell heading due east at a known speed, put west of the place it is
 * heading for.
 *
 * The arithmetic is the tracker's, not this test's: the point of building the
 * fixture from a bearing and a speed is that the minutes fall out of the same
 * closest-approach code the map draws.
 */
function cellHeadingEast(id: string, lon: number, lat: number): StormCell {
  return {
    id,
    latitude: lat,
    longitude: lon,
    // Due east.
    directionDegrees: 90,
    speedMs: 15,
  } as StormCell;
}

function report(cells: StormCell[], observed = OBSERVED): CellReport {
  return {
    station: "KDMX",
    observed,
    cells,
    mesocyclones: [],
  } as unknown as CellReport;
}

function place(
  id: string,
  name: string,
  lon: number,
  lat: number,
  overrides: Partial<WatchPlace> = {},
): WatchPlace {
  return {
    id,
    name,
    enabled: true,
    center: [lon, lat],
    radiusMiles: 25,
    minSeverity: "severe",
    sound: false,
    named: true,
    ...overrides,
  };
}

describe("what is heading for each watched place", () => {
  it("answers for every place rather than only for home", () => {
    // The defect this replaces: the arithmetic existed and only home could
    // see it, so a reader watching a school and a cabin had to open the radar
    // panel and could still only ask about one of them.
    const home = place("home", "Home", -94.0, 41.6);
    const school = place("school", "School", -93.0, 41.6);
    const coming = approachesFor(
      report([cellHeadingEast("A1", -94.4, 41.6)]),
      [home, school],
      NOW,
    );
    expect(coming.map((one) => one.placeId)).toEqual(["home", "school"]);
    // Soonest first, which is the order somebody reads this in.
    expect(coming[0].minutes).toBeLessThan(coming[1].minutes);
    expect(coming[0].cellId).toBe("A1");
  });

  it("leaves out a place the storm is not heading for", () => {
    // A quiet answer has to mean nothing is coming rather than that nothing
    // was looked at.
    const behind = place("behind", "Behind it", -95.0, 41.6);
    const coming = approachesFor(
      report([cellHeadingEast("A1", -94.4, 41.6)]),
      [behind],
      NOW,
    );
    expect(coming).toEqual([]);
  });

  it("leaves out a place that is switched off", () => {
    const off = place("off", "Off", -93.0, 41.6, { enabled: false });
    expect(
      approachesFor(report([cellHeadingEast("A1", -94.4, 41.6)]), [off], NOW),
    ).toEqual([]);
  });

  it("counts from now rather than from the scan", () => {
    // A volume is minutes old by the time anybody reads it, and this is the
    // one number where that matters: eight minutes late on a storm this is
    // about is the whole margin.
    const school = place("school", "School", -93.0, 41.6);
    const fresh = approachesFor(
      report([cellHeadingEast("A1", -94.4, 41.6)]),
      [school],
      NOW,
    );
    const stale = approachesFor(
      report([cellHeadingEast("A1", -94.4, 41.6)]),
      [school],
      NOW + 8 * 60_000,
    );
    expect(stale[0].minutes).toBeCloseTo(fresh[0].minutes - 8, 1);
  });
});

describe("which of them is worth saying", () => {
  const school = place("school", "School", -93.0, 41.6);
  const near: Approach = {
    placeId: "school",
    placeName: "School",
    named: true,
    cellId: "A1",
    minutes: 12,
  };
  const far: Approach = { ...near, cellId: "B2", minutes: 44 };

  it("says nothing at all until somebody asks", () => {
    // Off by default. A radar estimate that interrupts a reader who never
    // asked for it is the one thing this must not do.
    expect(DEFAULT_APPROACH.enabled).toBe(false);
    expect(DEFAULT_APPROACH.sound).toBe(false);
    expect(
      approachesToAnnounce([near], DEFAULT_APPROACH, [school], new Set(), NOW),
    ).toEqual([]);
  });

  it("waits for the estimate to come inside the window", () => {
    const on = { ...DEFAULT_APPROACH, enabled: true, minutes: 20 };
    expect(approachesToAnnounce([far], on, [school], new Set(), NOW)).toEqual(
      [],
    );
    expect(
      approachesToAnnounce([near], on, [school], new Set(), NOW).map(
        (one) => one.cellId,
      ),
    ).toEqual(["A1"]);
  });

  it("says each storm once per place, however long it sits there", () => {
    // A storm at eighteen minutes for half an hour is one piece of news, not
    // fifteen. The caller keeps the set; this decides against it.
    const on = { ...DEFAULT_APPROACH, enabled: true, minutes: 20 };
    const told = new Set<string>();
    const first = approachesToAnnounce([near], on, [school], told, NOW);
    expect(first).toHaveLength(1);
    for (const one of first) told.add(approachKey(one));
    expect(approachesToAnnounce([near], on, [school], told, NOW)).toEqual([]);
    // Even as it gets closer, which is the case the state-versus-crossing
    // distinction is about.
    expect(
      approachesToAnnounce([{ ...near, minutes: 3 }], on, [school], told, NOW),
    ).toEqual([]);
  });

  it("counts the same storm at two places as two pieces of news", () => {
    const cabin = place("cabin", "Cabin", -92.5, 41.6);
    const on = { ...DEFAULT_APPROACH, enabled: true, minutes: 20 };
    const told = new Set([approachKey(near)]);
    const atCabin: Approach = { ...near, placeId: "cabin", placeName: "Cabin" };
    expect(
      approachesToAnnounce([near, atCabin], on, [school, cabin], told, NOW).map(
        (one) => one.placeId,
      ),
    ).toEqual(["cabin"]);
  });

  it("stands down during a place's own quiet hours", () => {
    // No severity to override with: this is not severe, it is arithmetic, so
    // quiet hours silence it outright rather than by rank.
    const quiet = place("quiet", "Cabin", -93.0, 41.6, {
      quietHours: {
        enabled: true,
        startMinute: 22 * 60,
        endMinute: 7 * 60,
        overrideSeverity: "extreme",
      },
    });
    const on = { ...DEFAULT_APPROACH, enabled: true, minutes: 20 };
    const atQuiet: Approach = { ...near, placeId: "quiet", placeName: "Cabin" };
    const middleOfTheNight = new Date(2026, 8, 3, 2, 30);
    expect(
      approachesToAnnounce([atQuiet], on, [quiet], new Set(), middleOfTheNight),
    ).toEqual([]);
    const afternoon = new Date(2026, 8, 3, 15, 30);
    expect(
      approachesToAnnounce([atQuiet], on, [quiet], new Set(), afternoon),
    ).toHaveLength(1);
  });

  it("offers only windows the setting can hold", () => {
    expect(APPROACH_MINUTES).toContain(DEFAULT_APPROACH.minutes);
    expect([...APPROACH_MINUTES].sort((a, b) => a - b)).toEqual([
      ...APPROACH_MINUTES,
    ]);
  });
});

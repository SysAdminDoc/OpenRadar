import { describe, expect, it } from "vitest";
import {
  DEFAULT_HAIL_RULE,
  DEFAULT_ROTATION_RULE,
  GRID_RULE_SOURCES,
  gridAfter,
  gridToAnnounce,
  type GridRule,
  type GridSaid,
  type PlaceReading,
} from "./gridWatch";
import { QUIET_AFTER_MS } from "./lightningWatch";
import type { WatchPlace } from "./watch";

const AT = Date.parse("2026-09-10T18:00:00Z");

function place(over: Partial<WatchPlace> = {}): WatchPlace {
  return {
    id: "home",
    name: "the ballfield",
    enabled: true,
    center: [-93.6, 41.6],
    radiusMiles: 10,
    minSeverity: "severe",
    sound: false,
    ...over,
  };
}

function reading(value: number | null, over: Partial<PlaceReading> = {}) {
  return {
    placeId: "home",
    place: "the ballfield",
    named: true,
    value,
    miles: value === null ? null : 4,
    observed: AT,
    ...over,
  } satisfies PlaceReading;
}

const RULE: GridRule = { ...DEFAULT_HAIL_RULE, enabled: true };

describe("a rule set on a grid near a place", () => {
  it("says something once when the reading first meets the threshold", () => {
    const said = new Map<string, GridSaid>();
    const notices = gridToAnnounce(
      "hail",
      RULE,
      [reading(1.25)],
      [place()],
      said,
      AT,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("over");

    // And not again on the next pass, with the grid still over.
    const after = gridAfter(RULE, [reading(1.25)], said, notices, AT);
    expect(
      gridToAnnounce(
        "hail",
        RULE,
        [reading(1.5)],
        [place()],
        after,
        AT + 60_000,
      ),
    ).toEqual([]);
  });

  it("is silent under the threshold, and at it is over it", () => {
    const said = new Map<string, GridSaid>();
    expect(
      gridToAnnounce("hail", RULE, [reading(0.99)], [place()], said, AT),
    ).toEqual([]);
    // At the size exactly, because "over an inch" in a rule a reader set to
    // one inch means an inch counts. A threshold nobody can ever hit by
    // landing on it is a threshold set one cell too high.
    expect(
      gridToAnnounce("hail", RULE, [reading(1)], [place()], said, AT),
    ).toHaveLength(1);
  });

  it("does not read no coverage as a reading under the threshold", () => {
    // A circle the network could not see into says nothing either way.
    // Started on, it would announce clear air; ended on, it would tell
    // somebody at a ballfield the hail had stopped because the radar went
    // down.
    const said = new Map<string, GridSaid>();
    expect(
      gridToAnnounce("hail", RULE, [reading(null)], [place()], said, AT),
    ).toEqual([]);

    const active = new Map<string, GridSaid>([
      ["home", { active: true, over: AT - QUIET_AFTER_MS - 60_000 }],
    ]);
    expect(
      gridToAnnounce("hail", RULE, [reading(null)], [place()], active, AT),
    ).toEqual([]);
  });

  it("calls it quiet only after half an hour under the threshold", () => {
    const active = new Map<string, GridSaid>([
      ["home", { active: true, over: AT - QUIET_AFTER_MS + 60_000 }],
    ]);
    expect(
      gridToAnnounce("hail", RULE, [reading(0.2)], [place()], active, AT),
    ).toEqual([]);

    const older = new Map<string, GridSaid>([
      ["home", { active: true, over: AT - QUIET_AFTER_MS - 1 }],
    ]);
    const notices = gridToAnnounce(
      "hail",
      RULE,
      [reading(0.2)],
      [place()],
      older,
      AT,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe("quiet");
  });

  it("counts the half hour from the last time it was over, not the first", () => {
    // A storm that comes back before the half hour is up restarts the clock,
    // so nobody is told it is safe while hail is still falling on and off.
    let said = new Map<string, GridSaid>();
    said = gridAfter(RULE, [reading(1.5)], said, [], AT);
    // Twenty minutes later it is under, then over again.
    said = gridAfter(RULE, [reading(0.1)], said, [], AT + 20 * 60_000);
    said = gridAfter(RULE, [reading(1.2)], said, [], AT + 25 * 60_000);
    expect(said.get("home")?.over).toBe(AT + 25 * 60_000);

    const active = new Map<string, GridSaid>([
      ["home", { active: true, over: said.get("home")?.over ?? null }],
    ]);
    // Half an hour after the first reading is not half an hour after the
    // last one.
    expect(
      gridToAnnounce(
        "hail",
        RULE,
        [reading(0.1)],
        [place()],
        active,
        AT + QUIET_AFTER_MS + 60_000,
      ),
    ).toEqual([]);
  });

  it("holds a start back in the place's quiet hours, and never the all-clear", () => {
    const quiet = place({
      quietHours: {
        enabled: true,
        startMinute: 0,
        endMinute: 24 * 60 - 1,
        overrideSeverity: "extreme",
      },
    });
    const said = new Map<string, GridSaid>();
    expect(
      gridToAnnounce("hail", RULE, [reading(2)], [quiet], said, AT),
    ).toEqual([]);

    // The all-clear goes through, because somebody told to come in has to be
    // told they can go back out. There is no severity here to override with:
    // this is arithmetic on a grid rather than a forecaster's judgement.
    const active = new Map<string, GridSaid>([
      ["home", { active: true, over: AT - QUIET_AFTER_MS - 1 }],
    ]);
    expect(
      gridToAnnounce("hail", RULE, [reading(0.1)], [quiet], active, AT),
    ).toHaveLength(1);
  });

  it("says nothing at all while the rule is off", () => {
    const said = new Map<string, GridSaid>();
    expect(
      gridToAnnounce(
        "hail",
        { ...RULE, enabled: false },
        [reading(3)],
        [place()],
        said,
        AT,
      ),
    ).toEqual([]);
  });

  it("forgets a place that is no longer watched", () => {
    const said = new Map<string, GridSaid>([
      ["gone", { active: true, over: AT }],
      ["home", { active: true, over: AT }],
    ]);
    const after = gridAfter(RULE, [reading(1.5)], said, [], AT);
    expect(after.has("gone")).toBe(false);
    expect(after.get("home")?.active).toBe(true);
  });

  it("reads each grid in the unit the rule is written in", () => {
    // The hail grid is millimetres and a reader sets inches, because that is
    // what a warning is worded in. An inch is 25.4 mm, and a rule that
    // compared inches against millimetres would fire on every shower.
    expect(GRID_RULE_SOURCES.hail.product).toBe("mesh");
    expect(GRID_RULE_SOURCES.hail.fromGrid(25.4)).toBeCloseTo(1, 6);
    expect(GRID_RULE_SOURCES.hail.fromGrid(44.45)).toBeCloseTo(1.75, 6);

    // The shear grid is inverse seconds and the panel talks in thousandths,
    // which is what the weather service's own training says.
    expect(GRID_RULE_SOURCES.rotation.product).toBe("az-shear-low");
    expect(GRID_RULE_SOURCES.rotation.fromGrid(0.01)).toBeCloseTo(10, 6);
  });

  it("is off by default, both of them", () => {
    // A notice that is not a warning does not turn itself on.
    expect(DEFAULT_HAIL_RULE.enabled).toBe(false);
    expect(DEFAULT_ROTATION_RULE.enabled).toBe(false);
    expect(DEFAULT_HAIL_RULE.sound).toBe(false);
    expect(DEFAULT_ROTATION_RULE.sound).toBe(false);
    // An inch is the size a severe thunderstorm warning is issued at.
    expect(DEFAULT_HAIL_RULE.threshold).toBe(1);
  });
});

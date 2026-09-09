import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AMBIENT_CLOCK_PX,
  AMBIENT_GAPS_PX,
  AMBIENT_INSET_PX,
  AMBIENT_LEAVE_PX,
  AMBIENT_PLACE_PX,
  AMBIENT_SMALLEST_PX,
  DEFAULT_AMBIENT_METRES,
  DIM_AFTER_MS,
  DIM_OPACITY,
  DRIFT_EVERY_MS,
  DRIFT_PIXELS,
  GLANCE_ARCMINUTES,
  SLOWEST_REFRESH_MS,
  SLOW_AFTER_MS,
  ambientOpacity,
  ambientRefreshMs,
  ambientTypeScale,
  drift,
} from "./ambientScreen";

/**
 * What makes a view safe to leave running on a second monitor all night.
 *
 * Three things, and none of them is visible to the person watching: it never
 * holds the same bright pixels still, it never asks a public service for a
 * picture more often than the radar produces one, and after a while alone it
 * asks far less often than that.
 */

describe("a loop left running", () => {
  it("keeps its usual cadence while somebody is there", () => {
    const usual = 60_000;
    expect(ambientRefreshMs(usual, 0)).toBe(usual);
    expect(ambientRefreshMs(usual, SLOW_AFTER_MS)).toBe(usual);
  });

  it("stretches the longer nobody touches it", () => {
    const usual = 60_000;
    const half = ambientRefreshMs(usual, SLOW_AFTER_MS * 2);
    const whole = ambientRefreshMs(usual, SLOW_AFTER_MS * 3);
    expect(half).toBeGreaterThan(usual);
    expect(whole).toBeGreaterThan(half);
    // Eight hours in, it is asking a few times an hour rather than sixty.
    expect(ambientRefreshMs(usual, 8 * 3_600_000)).toBe(SLOWEST_REFRESH_MS);
  });

  it("never goes slower than the ceiling, whatever it is given", () => {
    // A radar volume is four to six minutes, so the ceiling is where losing
    // nothing meets asking for almost nothing.
    for (const idle of [0, 1, 1e6, 1e9, Number.MAX_SAFE_INTEGER]) {
      const answer = ambientRefreshMs(60_000, idle);
      expect(answer, String(idle)).toBeLessThanOrEqual(SLOWEST_REFRESH_MS);
      expect(answer, String(idle)).toBeGreaterThanOrEqual(60_000);
    }
    // And nonsense leaves it exactly as it was.
    expect(ambientRefreshMs(60_000, Number.NaN)).toBe(60_000);
  });
});

describe("what stops a monitor keeping a ghost of it", () => {
  it("moves the readout every few minutes, in a small circle", () => {
    // A walk rather than a jump: a jump is visible and a walk is not.
    const seen = new Set<string>();
    for (let step = 0; step < 8; step += 1) {
      const at = drift(step * DRIFT_EVERY_MS + 1);
      seen.add(`${at.x},${at.y}`);
      expect(Math.abs(at.x)).toBeLessThanOrEqual(DRIFT_PIXELS);
      expect(Math.abs(at.y)).toBeLessThanOrEqual(DRIFT_PIXELS);
    }
    // Eight distinct places before it comes back round.
    expect(seen.size).toBe(8);
    // And it does not move within one interval, so nothing flickers.
    expect(drift(1)).toEqual(drift(DRIFT_EVERY_MS - 1));
  });

  it("fades once nobody has touched it for a while", () => {
    expect(ambientOpacity(0)).toBe(1);
    expect(ambientOpacity(DIM_AFTER_MS - 1)).toBe(1);
    expect(ambientOpacity(DIM_AFTER_MS)).toBe(DIM_OPACITY);
    // Still readable across a room. Invisible would be a different feature.
    expect(DIM_OPACITY).toBeGreaterThan(0.4);
  });
});

describe("type for a screen that is looked at rather than worked at", () => {
  const DESK = { width: 1920, height: 1080 };
  /** What the readout comes to at its design size, as the view measures it. */
  const NATURAL = { width: 180, height: 90 };

  it("changes nothing for a reader at the distance it was drawn for", () => {
    // The default has to be free. A setting that resizes the view the moment
    // it exists is a setting that broke the view for everybody who had one.
    expect(ambientTypeScale(DEFAULT_AMBIENT_METRES, DESK, NATURAL)).toBe(1);
  });

  it("holds the angle, which means the size follows the distance", () => {
    // Nineteen arcminutes is an angle, so it says nothing about a size until
    // a distance is named. Holding it constant over any distance small enough
    // that the tangent is the angle means the size is proportional: at four
    // times as far, four times as big.
    expect(ambientTypeScale(2.4, DESK, NATURAL)).toBeCloseTo(4, 6);
    expect(ambientTypeScale(1.2, DESK, NATURAL)).toBeCloseTo(2, 6);
  });

  it("is anchored on the smallest line really subtending nineteen minutes", () => {
    // The whole rule rests on the default distance being the one the type was
    // drawn at, so that number is checked rather than asserted: a CSS pixel is
    // a 96th of an inch, so the smallest line is 3.44 mm tall, and 3.44 mm
    // subtends nineteen arcminutes at 62 cm.
    const millimetres = (AMBIENT_SMALLEST_PX * 25.4) / 96;
    const radians = (GLANCE_ARCMINUTES / 60) * (Math.PI / 180);
    const metres = millimetres / 2 / Math.tan(radians / 2) / 1000;
    expect(metres).toBeCloseTo(0.622, 3);
    // Rounded to the number the setting offers, which is within four per cent
    // of it and is a distance a person would say.
    expect(Math.abs(metres - DEFAULT_AMBIENT_METRES) / metres).toBeLessThan(
      0.04,
    );
  });

  it("will not ask for type the room cannot hold", () => {
    // The geometry does not know how big the screen is, or how wide the
    // reader's own place name is. What the readout comes to at its design
    // size is measured and handed in, because a glyph is not half an em and
    // in some scripts it is nowhere near: a forty-five character place name
    // ran a hundred pixels off the right edge, and sixteen characters of
    // Japanese stood a hundred and forty above the top of the window.
    const window = { width: 1024, height: 680 };
    const long = { width: 420, height: 90 };
    const asked = 4 / DEFAULT_AMBIENT_METRES;
    const scale = ambientTypeScale(4, window, long);
    expect(scale).toBeLessThan(asked);
    // What it settles on fits, with the insets it has to leave.
    expect(long.width * scale + 64).toBeLessThanOrEqual(window.width);
    expect(long.height * scale + 88).toBeLessThanOrEqual(window.height);
    // And it never goes below the size it was drawn at.
    expect(ambientTypeScale(4, { width: 200, height: 200 }, long)).toBe(1);
  });

  it("shrinks for whichever way it runs out of room first", () => {
    // A tall narrow window and a wide short one bind on different sides, and
    // the answer has to be the smaller of the two rather than whichever was
    // worked out last.
    const wide = ambientTypeScale(
      4,
      { width: 1600, height: 400 },
      {
        width: 180,
        height: 90,
      },
    );
    const tall = ambientTypeScale(
      4,
      { width: 400, height: 1600 },
      {
        width: 180,
        height: 90,
      },
    );
    expect(wide).toBeLessThan(4 / DEFAULT_AMBIENT_METRES);
    expect(tall).toBeLessThan(4 / DEFAULT_AMBIENT_METRES);
    expect(wide).not.toBeCloseTo(tall, 3);
  });

  it("answers with the size it was drawn at when the numbers are nonsense", () => {
    // A scale of `NaN` reaches the stylesheet as an invalid `calc` and takes
    // every line of the readout with it.
    expect(ambientTypeScale(Number.NaN, DESK, NATURAL)).toBe(1);
    expect(ambientTypeScale(4, { width: 0, height: 0 }, NATURAL)).toBe(1);
    // Nothing measured yet is not a reason to shrink: with no lines to fit,
    // the room binds on nothing and the geometry's own answer stands. Written
    // as the number rather than as "more than nothing", which the floor of one
    // satisfies whatever the rule does.
    expect(ambientTypeScale(4, DESK, { width: 0, height: 0 })).toBeCloseTo(
      4 / DEFAULT_AMBIENT_METRES,
      6,
    );
  });

  it("still lets the room bind when the readout measures nothing", () => {
    // The clamp on the divisor was taken out once as a guard that could not
    // fire and put back after a differential found otherwise, and the
    // measurement never became a case, so deleting both clamps again left the
    // whole suite green. This is the pair of numbers.
    //
    // Nothing measured yet divides the room by zero, and `Infinity` is the
    // answer that stops that axis binding at all: the room is not consulted,
    // and the geometry's own figure stands however little space there is. It
    // takes a room whose space left over is smaller than the size being asked
    // for, which at the furthest setting is about seven pixels, so no window
    // the view draws in is one. A clamp is cheaper than knowing that.
    expect(
      ambientTypeScale(4, { width: 153, height: 93 }, { width: 0, height: 0 }),
    ).toBeCloseTo(3, 6);
    // The same room with something measured in it, so the case above is the
    // clamp rather than the room: without it both answer 4 / 0.6.
    expect(
      ambientTypeScale(4, { width: 153, height: 93 }, { width: 1, height: 1 }),
    ).toBeCloseTo(3, 6);
  });
});

describe("the sizes the rule is anchored on", () => {
  it("are the sizes the stylesheet actually draws", () => {
    // The rule multiplies what the stylesheet has, and its own default
    // distance is worked out from the smallest of them. A change to either
    // side of that without the other is a rule about a size nobody is
    // reading, which is exactly the kind of drift a comment does not catch.
    // Comments out, for the reason the test below says: every pattern here is
    // non-global, so a commented-out declaration above the live one wins.
    const css = readFileSync(
      join(import.meta.dirname, "..", "index.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // The multiplier is part of what is matched, not just the number. Without
    // it the pattern read a plain `calc(13px)` as happily as the real thing,
    // so deleting the scale from all three rules, which switches the whole
    // feature off, left every gate in the repository green.
    const sized = (selector: string) =>
      new RegExp(
        `\\.ambient-readout ${selector}\\s*\\{[^}]*font-size:\\s*calc\\(\\s*(\\d+)px\\s*\\*\\s*var\\(--ambient-scale\\)\\s*\\)`,
      ).exec(css)?.[1];
    expect(sized("strong")).toBe(String(AMBIENT_CLOCK_PX));
    expect(sized("span")).toBe(String(AMBIENT_PLACE_PX));
    expect(sized("small")).toBe(String(AMBIENT_SMALLEST_PX));
  });

  it("leave the room the parts that do not scale really take", () => {
    // The three sizes above were anchored and the three subtractions were
    // not, and one of them was wrong: the column has four children, so there
    // are three gaps and the rule was leaving room for two. Everything here
    // is a fixed size the type never multiplies, which is exactly why it has
    // to be taken out of the room before the type is fitted into it.
    // Read with the comments taken out first. Every pattern below is
    // non-global, so the first match in the block wins, and a commented-out
    // declaration sitting above the live one outranks it: a comment holding
    // `left: 32px; bottom: 32px; gap: 2px` at the top of `.ambient-readout`
    // kept this green while the live rule said 11, 11 and 9.
    const css = readFileSync(
      join(import.meta.dirname, "..", "index.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // Anchored to the start of a line, so the variant rules do not answer for
    // the base ones: `.ambient-readout[data-over-light] .ambient-readout__leave`
    // comes first in the file and sets two colours and nothing else.
    const rule = (selector: string) =>
      new RegExp(String.raw`^\.${selector} \{([^}]*)\}`, "m").exec(css)?.[1] ??
      `no .${selector} rule`;
    const readout = rule("ambient-readout");
    const leave = rule("ambient-readout__leave");
    // Anchored to the start of a declaration, so `padding-left` cannot answer
    // for `left` and `line-height` cannot answer for `height`.
    const pixels = (block: string, property: string) =>
      Number(
        new RegExp(String.raw`(?:^|[;{])\s*${property}:\s*(\d+)px`, "m").exec(
          block,
        )?.[1],
      );

    // The corner it sits in, which is the same both ways.
    expect(pixels(readout, "left")).toBe(AMBIENT_INSET_PX);
    expect(pixels(readout, "bottom")).toBe(AMBIENT_INSET_PX);
    // The way out: its own height plus the space above it.
    expect(pixels(leave, "height") + pixels(leave, "margin-top")).toBe(
      AMBIENT_LEAVE_PX,
    );
    // And the gaps, at the most the column can have. The clock, the place,
    // the line and the way out is four children and three gaps; the place is
    // only drawn once the reader has named where they watch, so a fresh
    // install is three children and two. The larger figure leaves two pixels
    // unused there and never overruns, which is the direction to be wrong in.
    //
    // One assertion rather than two: a second reading that the constant is
    // more than two gaps followed from this one for any gap above zero, so it
    // could not fail on its own and read as cover it was not giving.
    expect(pixels(readout, "gap") * 3).toBe(AMBIENT_GAPS_PX);
  });
});

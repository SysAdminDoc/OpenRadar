import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AMBIENT_CLOCK_PX,
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
    expect(ambientTypeScale(4, DESK, { width: 0, height: 0 })).toBeGreaterThan(
      0,
    );
  });
});

describe("the sizes the rule is anchored on", () => {
  it("are the sizes the stylesheet actually draws", () => {
    // The rule multiplies what the stylesheet has, and its own default
    // distance is worked out from the smallest of them. A change to either
    // side of that without the other is a rule about a size nobody is
    // reading, which is exactly the kind of drift a comment does not catch.
    const css = readFileSync(
      join(import.meta.dirname, "..", "index.css"),
      "utf8",
    );
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
});

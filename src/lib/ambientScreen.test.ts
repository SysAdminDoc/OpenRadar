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
  /** What the view draws: the time, the place, and where the picture is from. */
  const LINES = { clock: "21:00", place: "Casa", source: "NOAA MRMS" };

  it("changes nothing for a reader at the distance it was drawn for", () => {
    // The default has to be free. A setting that resizes the view the moment
    // it exists is a setting that broke the view for everybody who had one.
    expect(ambientTypeScale(DEFAULT_AMBIENT_METRES, DESK, LINES)).toBe(1);
  });

  it("holds the angle, which means the size follows the distance", () => {
    // Nineteen arcminutes is an angle, so it says nothing about a size until
    // a distance is named. Holding it constant over any distance small enough
    // that the tangent is the angle means the size is proportional: at four
    // times as far, four times as big.
    expect(ambientTypeScale(2.4, DESK, LINES)).toBeCloseTo(4, 6);
    expect(ambientTypeScale(1.2, DESK, LINES)).toBeCloseTo(2, 6);
  });

  it("is anchored on the smallest line really subtending nineteen minutes", () => {
    // The whole rule rests on the default distance being the one the type was
    // drawn at, so that number is checked rather than asserted: a CSS pixel is
    // a 96th of an inch, so the smallest line is 3.44 mm tall, and 3.44 mm
    // subtends nineteen arcminutes at 62 cm.
    const millimetres = (AMBIENT_SMALLEST_PX * 25.4) / 96;
    const radians = (GLANCE_ARCMINUTES / 60) * (Math.PI / 180);
    const metres = millimetres / 2 / Math.tan(radians / 2) / 1000;
    expect(metres).toBeCloseTo(DEFAULT_AMBIENT_METRES, 1);
  });

  it("will not ask for type the window cannot hold", () => {
    // The geometry does not know how big the screen is. Somebody four metres
    // from a small window is asking for a clock that would run off the edge,
    // and a clock running off the edge is less readable than one that is
    // slightly too small.
    const small = { width: 640, height: 400 };
    const asked = 4 / DEFAULT_AMBIENT_METRES;
    expect(ambientTypeScale(4, small, LINES)).toBeLessThan(asked);
    // Every line still fits across it, at the advance this face runs to.
    const scale = ambientTypeScale(4, small, LINES);
    expect(
      LINES.clock.length * 0.55 * AMBIENT_CLOCK_PX * scale + 64,
    ).toBeLessThanOrEqual(small.width);
    expect(
      LINES.source.length * 0.5 * AMBIENT_SMALLEST_PX * scale + 64,
    ).toBeLessThanOrEqual(small.width);
    // And it never goes below the size it was drawn at.
    expect(scale).toBeGreaterThanOrEqual(1);
  });

  it("shrinks for the longest line, which is the quietest one", () => {
    // The source and the age is a longer string than the clock, at a third of
    // the size, so past a certain distance it is what runs out of room first.
    // Bounded on the clock alone, that line wrapped into four and the readout
    // stood four hundred pixels above the top of a 680 pixel window.
    const window = { width: 1024, height: 680 };
    const short = ambientTypeScale(4, window, { ...LINES, source: "MRMS" });
    const long = ambientTypeScale(4, window, {
      ...LINES,
      source: "NOAA MRMS, 12 minutes ago",
    });
    expect(long).toBeLessThan(short);
    // And the longest line still fits across the window at the size chosen.
    expect(25 * 0.5 * AMBIENT_SMALLEST_PX * long + 64).toBeLessThanOrEqual(
      window.width,
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
    const sized = (selector: string) =>
      new RegExp(
        `\\.ambient-readout ${selector}\\s*\\{[^}]*font-size:\\s*calc\\((\\d+)px`,
      ).exec(css)?.[1];
    expect(sized("strong")).toBe(String(AMBIENT_CLOCK_PX));
    expect(sized("span")).toBe(String(AMBIENT_PLACE_PX));
    expect(sized("small")).toBe(String(AMBIENT_SMALLEST_PX));
  });
});

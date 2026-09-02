import { describe, expect, it } from "vitest";
import {
  ambientOpacity,
  ambientRefreshMs,
  drift,
  DIM_AFTER_MS,
  DIM_OPACITY,
  DRIFT_EVERY_MS,
  DRIFT_PIXELS,
  SLOWEST_REFRESH_MS,
  SLOW_AFTER_MS,
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

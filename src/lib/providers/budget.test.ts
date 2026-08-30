import { describe, expect, it } from "vitest";
import { BLANK_TILE_URL, createRollingRequestBudget } from "./budget";

/**
 * The budget is what stops a long replay from hammering somebody else's
 * service. Nothing else limits how many tiles a scrubbing session asks for.
 */
describe("a rolling request budget", () => {
  it("lets exactly as many through as it was given", () => {
    const budget = createRollingRequestBudget(3, 60_000);
    expect(budget.remaining(0)).toBe(3);
    expect(budget.tryConsume(0)).toBe(true);
    expect(budget.tryConsume(1)).toBe(true);
    expect(budget.tryConsume(2)).toBe(true);
    expect(budget.remaining(3)).toBe(0);
    expect(budget.tryConsume(3)).toBe(false);
  });

  it("does not count a refused request against the window", () => {
    // A refusal that still took a slot would make the budget shrink under
    // load, which is exactly when it needs to recover on time.
    const budget = createRollingRequestBudget(2, 1000);
    budget.tryConsume(0);
    budget.tryConsume(0);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(budget.tryConsume(500)).toBe(false);
    }
    // The two real ones fall out of the window and nothing else is holding it.
    expect(budget.remaining(1001)).toBe(2);
    expect(budget.tryConsume(1001)).toBe(true);
  });

  it("rolls rather than resetting on the hour", () => {
    // A fixed window would let twice the limit through across its boundary:
    // the whole allowance at the end of one and again at the start of the
    // next. A rolling one cannot.
    const budget = createRollingRequestBudget(2, 1000);
    expect(budget.tryConsume(900)).toBe(true);
    expect(budget.tryConsume(999)).toBe(true);
    expect(budget.tryConsume(1000)).toBe(false);
    // Both are still inside the window half a second later, which is the
    // whole point: a fixed window would have started again by now.
    expect(budget.tryConsume(1500)).toBe(false);
    // The first one falls out a full window after it was made, and the slot
    // it was holding comes back then and not before.
    expect(budget.tryConsume(1899)).toBe(false);
    expect(budget.tryConsume(1900)).toBe(true);
  });

  it("frees a slot exactly one window after the request that took it", () => {
    // A request made at zero occupies the window up to and including its
    // thousandth millisecond, and is gone at the thousandth: the window is
    // the time since, not the time since inclusive, and one of the two has to
    // be picked or the budget is off by a millisecond forever.
    const budget = createRollingRequestBudget(1, 1000);
    expect(budget.tryConsume(0)).toBe(true);
    expect(budget.tryConsume(999)).toBe(false);
    expect(budget.tryConsume(1000)).toBe(true);
  });

  it("counts back to full after a reset", () => {
    const budget = createRollingRequestBudget(2, 60_000);
    budget.tryConsume(0);
    budget.tryConsume(0);
    expect(budget.remaining(0)).toBe(0);
    budget.reset();
    expect(budget.remaining(0)).toBe(2);
  });

  it("refuses everything when it was given nothing", () => {
    const budget = createRollingRequestBudget(0, 1000);
    expect(budget.tryConsume(0)).toBe(false);
    expect(budget.remaining(0)).toBe(0);
  });

  it("has a picture to serve in place of a request it refused", () => {
    // A refused tile has to be something the map can draw, or every corner of
    // the view logs a failure instead.
    expect(BLANK_TILE_URL.startsWith("data:image/png;base64,")).toBe(true);
    expect(BLANK_TILE_URL.length).toBeGreaterThan(60);
  });
});

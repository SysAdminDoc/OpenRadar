import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./lib/settings";
import { workspaceSource } from "./test/workspaceSource";

/**
 * The promise the Character section makes, held to.
 *
 * "How much the app volunteers, and none of it while a warning stands" is a
 * sentence a reader can check: the curiosities, the catch-up card and the on
 * this date card are all supposed to stand down while a warning is in force
 * where somebody watches. Three of the four switches ship on, so this is what
 * most readers meet.
 *
 * It was held by one assertion that a render condition mentioned
 * `alertActive` at all. That is blind to which way round it is: taking the
 * `!` off the curiosity card, so it appears only during a warning, left the
 * whole suite green. Nothing held the catch-up card or the almanac.
 *
 * Read off the source rather than rendered, because reaching these three on
 * screen needs a warning to land mid-test at a watched place, and a source
 * read that knows the sense is worth more than a render nobody writes. The
 * comments come out first: a condition quoted in a comment answered for a
 * live one twice in this repository already.
 */
const app = workspaceSource();

/** The text between two landmarks, which is where a condition is written. */
function between(from: string, to: string): string {
  const at = app.indexOf(from);
  expect(at, `${from} is no longer in the workspace`).toBeGreaterThan(-1);
  const end = app.indexOf(to, at);
  expect(end, `${to} no longer follows ${from}`).toBeGreaterThan(at);
  return app.slice(at, end);
}

describe("what the app volunteers while a warning stands", () => {
  const QUIET = "!overlays.alertActive";

  /**
   * The clause is there and nothing lets the condition past it.
   *
   * Presence alone is not the promise. Every one of these conditions is a
   * chain of `&&`, so the way to disable the clause while leaving it on
   * screen is to put it in a disjunction: `(!overlays.alertActive ||
   * settings.calm)` reads as a gate and is not one, and a check that asks
   * whether the words are there cannot tell the two apart. No `||` appears
   * in any of these four spans today, so refusing one is refusing the shape
   * rather than a spelling.
   */
  const gated = (span: string, what: string) => {
    expect(span, `${what} no longer mentions the warning`).toContain(QUIET);
    expect(span, `${what} lets something past the warning`).not.toContain("||");
  };

  it("stands the curiosities down, where they are found and where they are drawn", () => {
    // Also held for real, on a rendered warning, by `e2e/curiosities.spec.ts`
    // in "stays quiet while a warning is in force where you watch".
    gated(between("useCuriosities({", "onFound:"), "the curiosity search");
    gated(between("{curiosity", "<CuriosityCard"), "the curiosity card");
  });

  it("stands the catch-up card down", () => {
    // A card about last Tuesday over a live warning. Held for real too, by
    // `e2e/catch-up.spec.ts` in "stands down while a warning is in force
    // where you watch", which lands a warning and asserts the card is gone.
    gated(between("{catchUp &&", "<CatchUpCard"), "the catch-up card");
  });

  it("stands the on this date card down", () => {
    // A card about the weather in other years, in the panel a reader opens
    // during a warning to find out what to do.
    //
    // The only one of the three with no rendered case behind it, and the
    // reason is that the card draws only when the almanac has an entry for
    // today's date, so "it is not on screen" is true on most days whatever
    // the warning is doing. A rendered case needs a stubbed almanac with an
    // entry for today and a storm list to hang it on, which is a fixture
    // worth building and is not built here.
    gated(between("almanac={", "onFlyTo="), "the on this date card");
  });

  it("is a promise about the settings a reader actually meets", () => {
    // The sentence over the section says "how much the app volunteers", and
    // three of these four ship on, so the three above are what most readers
    // have. Calm mode is the one that ships off, and it takes things away
    // rather than adding them.
    expect(DEFAULT_SETTINGS.curiosities).toBe(true);
    expect(DEFAULT_SETTINGS.catchUp).toBe(true);
    expect(DEFAULT_SETTINGS.almanac).toBe(true);
    expect(DEFAULT_SETTINGS.calm).toBe(false);
  });
});

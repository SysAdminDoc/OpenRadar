import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./lib/settings";

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
const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
  .replace(/\/\/.*/g, "");

/** The text between two landmarks, which is where a condition is written. */
function between(from: string, to: string): string {
  const at = app.indexOf(from);
  expect(at, `${from} is no longer in App.tsx`).toBeGreaterThan(-1);
  const end = app.indexOf(to, at);
  expect(end, `${to} no longer follows ${from}`).toBeGreaterThan(at);
  return app.slice(at, end);
}

describe("what the app volunteers while a warning stands", () => {
  const QUIET = "!overlays.alertActive";

  it("stands the curiosities down, where they are found and where they are drawn", () => {
    expect(between("useCuriosities({", "onFound:")).toContain(QUIET);
    expect(between("{curiosity", "<CuriosityCard")).toContain(QUIET);
  });

  it("stands the catch-up card down", () => {
    // A card about last Tuesday over a live warning.
    expect(between("{catchUp &&", "<CatchUpCard")).toContain(QUIET);
  });

  it("stands the on this date card down", () => {
    // A card about the weather in other years, in the panel a reader opens
    // during a warning to find out what to do.
    expect(between("almanac={", "onFlyTo=")).toContain(QUIET);
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

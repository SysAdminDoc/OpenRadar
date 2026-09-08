import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asked,
  highContrastRequested,
  LESS_MOTION,
  MORE_CONTRAST,
  reducedMotionRequested,
} from "../lib/displayPreference";
import {
  useForcedColours,
  useHighContrast,
  useReducedMotion,
} from "./useClock";

/**
 * What the reader has asked their system for, and where that question is
 * written down.
 *
 * Two media queries, each of which was written twice: once in
 * `lib/displayPreference.ts`, where the answer is read, and once here, where
 * the change is subscribed to. They were character-identical, which is the
 * only state a fact written twice is ever in until it is not. A hook watching
 * one query and reading the answer to another stops re-rendering when the
 * preference changes, and nothing on screen says so: the workspace simply
 * keeps animating for somebody who asked it not to.
 */
const ROOT = join(import.meta.dirname ?? __dirname, "..");

function sourceFiles(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/** A `matchMedia` that records what it was asked and answers a fixed list. */
function watching(holds: string[]): string[] {
  const asks: string[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    asks.push(query);
    return {
      matches: holds.includes(query),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
  return asks;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the reader's own display preferences", () => {
  it("writes each query down once", () => {
    // Counted across the whole tree, this file included: a test that spells a
    // query out again is a test that keeps passing after the query has moved.
    //
    // `@media (prefers-contrast: more)` is a different thing wearing the same
    // words. That one is a rule in the stylesheet the theme writes, read by
    // the browser rather than by `matchMedia`, and it belongs with the CSS it
    // is part of. So every CSS spelling is taken out before the count, and
    // only the question this code asks is left.
    for (const query of [MORE_CONTRAST, LESS_MOTION]) {
      const written = sourceFiles(ROOT)
        .filter((path) =>
          readFileSync(path, "utf8")
            .split(`@media ${query}`)
            .join("")
            .includes(query),
        )
        .map((path) => path.slice(ROOT.length + 1).replace(/\\/g, "/"));
      expect(written, `${query} is written in more than one place`).toEqual([
        "lib/displayPreference.ts",
      ]);
    }
  });

  it("watches the same query it reads the answer to", () => {
    // Driven through the real hook rather than by comparing two constants,
    // which would only say that two strings match. Every question the hook
    // puts to `matchMedia` is recorded, so one that watches one query while
    // reading another shows up as two different questions.
    const asks = watching([LESS_MOTION]);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    expect(new Set(asks)).toEqual(new Set([LESS_MOTION]));

    asks.length = 0;
    const contrast = renderHook(() => useHighContrast());
    expect(contrast.result.current).toBe(false);
    expect(new Set(asks)).toEqual(new Set([MORE_CONTRAST]));
  });

  it("takes the colours the system has taken over", () => {
    const asks = watching(["(forced-colors: active)"]);
    const { result } = renderHook(() => useForcedColours());
    expect(result.current).toBe(true);
    expect(new Set(asks)).toEqual(new Set(["(forced-colors: active)"]));
  });

  it("answers false where nothing can be asked", () => {
    // Read on the way into fetching a radar sweep, so an environment with no
    // `matchMedia` has to give an answer rather than take the picture down.
    vi.stubGlobal("matchMedia", undefined);
    expect(asked(MORE_CONTRAST)).toBe(false);
    expect(reducedMotionRequested()).toBe(false);
    expect(highContrastRequested()).toBe(false);
    expect(() => renderHook(() => useForcedColours())).not.toThrow();
  });
});

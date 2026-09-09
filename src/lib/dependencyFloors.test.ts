import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The versions a fix this app depends on first appeared in.
 *
 * Not a list of what is installed, which `npm outdated` already says and
 * which changes every week. This is the shorter list: the places where a
 * dependency's own release fixed something a reader would notice, so dropping
 * below it puts the defect back with nothing else to say so. A caret range
 * allows anything at or above its floor, and lowering that floor is a one
 * character edit nobody would look twice at.
 */
const FLOORS: Array<{ name: string; least: string; why: string }> = [
  {
    name: "maplibre-gl",
    least: "6.8.0",
    why: "an empty tile answer, HTTP 204, loads as no data rather than failing: below this a terrain tile a service has nothing for reads as a broken fetch",
  },
  {
    name: "maplibre-gl",
    least: "6.5.0",
    why: "the advisory of 2026-09-08, CVE-2026-85061, caps at 6.4.0",
  },
];

/** A version as three numbers, so 6.10.0 sorts above 6.9.0 rather than under. */
function parts(version: string): [number, number, number] {
  const found = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  expect(found, `${version} is not a version`).not.toBeNull();
  return [Number(found![1]), Number(found![2]), Number(found![3])];
}

function atLeast(have: string, least: string): boolean {
  const [a, b, c] = parts(have);
  const [x, y, z] = parts(least);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

describe("what the app needs a dependency to be at least", () => {
  const root = join(import.meta.dirname, "..", "..");
  const declared = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as Record<string, Record<string, string>>;
  const locked = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  ) as { packages: Record<string, { version?: string }> };

  for (const { name, least, why } of FLOORS) {
    it(`will not go below ${name} ${least}`, () => {
      // Both the range and what is installed. The range is what a fresh
      // install resolves against and the lock is what this machine built and
      // tested, and either one alone can be the honest number while the other
      // is behind.
      const range =
        declared.dependencies?.[name] ?? declared.devDependencies?.[name];
      expect(range, `${name} is not in package.json`).toBeTruthy();
      expect(atLeast(range.replace(/^[\^~]/, ""), least), `${why}`).toBe(true);
      const installed = locked.packages[`node_modules/${name}`]?.version;
      expect(installed, `${name} is not in the lockfile`).toBeTruthy();
      expect(atLeast(installed!, least), why).toBe(true);
    });
  }
});

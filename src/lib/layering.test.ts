import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Which module may import which, held against the source rather than promised
 * in a note.
 *
 * Two rules, both of which were already written down in the working notes and
 * both of which had been broken by the time anyone looked.
 *
 * `settings.ts` is underneath everything: the store, the defaults and the
 * normaliser that every other module reads. On 2026-09-04 it grew an import of
 * a constant from an overlay adapter, the adapter imports the tile cache, and
 * the tile cache imports `settings.ts`, so the three of them closed a ring
 * that evaluates at runtime. It worked only because nothing in the ring read a
 * half-initialised module while it was still being evaluated, which is a
 * property of the order the bundler happened to choose. The last time this
 * shape appeared the symptom was a provider's coverage list loading empty,
 * which took Alaska, Hawaii, Guam and Puerto Rico off the radar chain with
 * nothing on screen to say why.
 *
 * And `lib/` is underneath `hooks/`, `panels/` and `components/`. A library
 * that reaches up into the hooks above it cannot be read, tested or moved
 * without them, and one had.
 *
 * Type-only imports are allowed everywhere: they are erased before anything
 * runs, so they cannot close a ring or drag a module in.
 */
const ROOT = join(import.meta.dirname ?? __dirname, "..");

function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/** Every module a file pulls in at runtime, as written. */
function valueImports(source: string): string[] {
  const found: string[] = [];
  // `import ... from "x"` and `export ... from "x"`, minus the ones the
  // compiler erases: a whole-clause `import type` and a bare `export type`.
  for (const match of source.matchAll(
    /^\s*(?:import|export)\s+([\s\S]*?)from\s+"([^"]+)"/gm,
  )) {
    const clause = match[1];
    if (/^\s*type\s/.test(clause)) continue;
    found.push(match[2]);
  }
  return found;
}

describe("what may import what", () => {
  const libFiles = filesUnder(join(ROOT, "lib"));

  it("has files to look at", () => {
    expect(libFiles.length).toBeGreaterThan(40);
  });

  it("keeps settings underneath the modules that read it", () => {
    const source = readFileSync(join(ROOT, "lib", "settings.ts"), "utf8");
    const reaching = valueImports(source).filter((where) =>
      /^\.\/(providers|overlays)\//.test(where),
    );
    expect(
      reaching,
      "settings.ts is imported by these, so importing them back closes a ring " +
        "at runtime. Put what it needs in a leaf module of its own, the way " +
        "spcHazards.ts and satelliteBands.ts are.",
    ).toEqual([]);
  });

  it("keeps the library underneath the hooks and the screen", () => {
    const wrong: string[] = [];
    for (const path of libFiles) {
      const from = relative(ROOT, path).replace(/\\/g, "/");
      for (const where of valueImports(readFileSync(path, "utf8"))) {
        if (/(^|\/)(hooks|panels|components)\//.test(where)) {
          wrong.push(`${from} -> ${where}`);
        }
      }
    }
    expect(
      wrong,
      "a module under lib/ cannot be read, tested or moved without whatever " +
        "it imports, and these reach up into the layers above it",
    ).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * How long a source file may be.
 *
 * `AUD-272` split the two hottest files in the app and set this as what a file
 * of this kind may be. Its own close named `App.tsx` and a
 * `MapOptionsPanels.tsx` that no longer exists, so the panel half went
 * unmeasured and `LayersPanel.tsx` climbed back to 1,800 with nothing to say
 * so. The replacement measured the panels directory, and walked past the three
 * files that had motivated the ceiling in the first place: `MapViewport.tsx` at
 * three thousand lines was not a panel.
 *
 * So this measures the whole of `src`. A directory read rather than a list of
 * names, because a list of names is what let the last two through: it goes
 * stale the moment a file is renamed or added, and the whole point is to catch
 * the next one.
 */
const CEILING = 1500;

const SOURCE = join(process.cwd(), "src");

/**
 * Everything the build compiles.
 *
 * `tsconfig.app.json` includes `src` and takes every one of these, so a
 * `.mts` panel is a panel. The earlier spelling of this test matched `.ts` and
 * `.tsx` alone, which left a two-thousand-line `layerRows.mts` invisible to it,
 * to `format:check`, and to eslint, while `tsc -b` compiled it happily.
 */
const COMPILED = /\.(m|c)?(ts|js)x?$/;

/**
 * The four translation catalogues, which are tables rather than code.
 *
 * One key to a line is what makes a catalogue reviewable, and the i18n
 * coverage gate holds all four to each other key for key. Naming them rather
 * than matching the directory, so a real module that lands in `src/i18n` is
 * measured like anything else.
 */
const CATALOGUES = new Set([
  join(SOURCE, "i18n", "en.ts"),
  join(SOURCE, "i18n", "es.ts"),
  join(SOURCE, "i18n", "fr.ts"),
  join(SOURCE, "i18n", "de.ts"),
]);

/**
 * What was already over when the ceiling was widened to the whole tree, and
 * how long each one was.
 *
 * Not a list of names to skip. The number is the waiver: each of these may
 * stay as it is and may not grow by a line, so the exemption expires by
 * itself the moment somebody adds to one. Splitting any of them is a roadmap
 * item rather than a thing to do in passing, and none of them may get worse
 * in the meantime.
 */
const ALREADY_OVER: Record<string, number> = {
  "components/MapViewport.tsx": 3068,
  "hooks/useSingleSiteRadar.test.tsx": 2294,
  "hooks/useSingleSiteRadar.ts": 1717,
  "App.tsx": 1555,
};

function every(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...every(path));
    } else if (COMPILED.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** Lines, counting the way a text editor does. */
function lengthOf(path: string): number {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  // A file ending in a newline has an empty last piece, which is not a line.
  // Counted, the real ceiling was one under the number written above it.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

describe("how big a source file is allowed to get", () => {
  it("keeps every file the build compiles inside the ceiling", () => {
    const over: string[] = [];
    const files = every(SOURCE);
    // The tree itself has to be found, or this passes by reading none.
    expect(files.length).toBeGreaterThan(100);
    // And every extension has to be reachable, or the pattern is the gate.
    expect(files.some((path) => path.endsWith(".tsx"))).toBe(true);
    expect(files.some((path) => path.endsWith(".ts"))).toBe(true);
    for (const path of files) {
      if (CATALOGUES.has(path)) continue;
      const name = path
        .slice(SOURCE.length + 1)
        .split("\\")
        .join("/");
      const lines = lengthOf(path);
      const allowed = ALREADY_OVER[name] ?? CEILING;
      if (lines > allowed) over.push(`${name} is ${lines} lines`);
    }
    expect(over, `over ${CEILING} lines`).toEqual([]);
  });

  it("lets a waiver expire when the file it covers is split", () => {
    // A waiver that outlives its file is a hole nobody can see. Each of these
    // has to still be over the ceiling, or it belongs in the ordinary rule.
    for (const [name, lines] of Object.entries(ALREADY_OVER)) {
      expect(lines, name).toBeGreaterThan(CEILING);
      const path = join(SOURCE, ...name.split("/"));
      expect(
        lengthOf(path),
        `${name} is no longer over the ceiling`,
      ).toBeGreaterThan(CEILING);
    }
  });

  it("keeps what a panel offers in a table beside it", () => {
    // The split that brought the Layers panel back under. Adding a switch
    // group is an entry in the catalogue rather than an edit to the panel,
    // which is the part that stops it growing back: the panel reads the
    // table and renders it, and the table is data.
    const catalogue = readFileSync(
      join(SOURCE, "panels", "layerCatalogue.ts"),
      "utf8",
    );
    expect(catalogue).toContain("export const LAYER_OPTIONS");
    expect(catalogue).toContain("export const LAYER_GROUPS");
    // Nothing from React in it, which is what keeps it a table. Naming the
    // markup and one hook is what the first version of this did, and it could
    // not see `createElement`, `useReducer`, or a render closure: a table with
    // a component in it passed with everything else green.
    expect(catalogue).not.toMatch(/from ["']react["']/);
    expect(catalogue).not.toContain("</");
  });
});

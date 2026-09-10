import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * How long a panel file may be.
 *
 * `AUD-272` split the two hottest files in the app and set this as what a
 * file of this kind may be. Its own close named `App.tsx` and a
 * `MapOptionsPanels.tsx` that no longer exists, so the panel half went
 * unmeasured and `LayersPanel.tsx` climbed back to 1,800 with nothing to
 * say so.
 *
 * A directory read rather than a list of names, because a list of names is
 * what let the last one through: it goes stale the moment a file is renamed
 * or added, and the whole point is to catch the next one.
 */
const CEILING = 1500;

const PANELS = join(process.cwd(), "src", "panels");

function every(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...every(path));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe("how big a panel is allowed to get", () => {
  it("keeps every file under the panels directory inside the ceiling", () => {
    const over: string[] = [];
    const files = every(PANELS);
    // The directory itself has to be found, or this passes by reading none.
    expect(files.length).toBeGreaterThan(5);
    for (const path of files) {
      const lines = readFileSync(path, "utf8").split("\n").length;
      if (lines > CEILING) {
        over.push(`${path.slice(PANELS.length + 1)} is ${lines} lines`);
      }
    }
    expect(over, `over ${CEILING} lines`).toEqual([]);
  });

  it("keeps what a panel offers in a table beside it", () => {
    // The split that brought the Layers panel back under. Adding a switch
    // group is an entry in the catalogue rather than an edit to the panel,
    // which is the part that stops it growing back: the panel reads the
    // table and renders it, and the table is data.
    const catalogue = readFileSync(join(PANELS, "layerCatalogue.ts"), "utf8");
    expect(catalogue).toContain("export const LAYER_OPTIONS");
    expect(catalogue).toContain("export const LAYER_GROUPS");
    // No markup in it, which is what keeps it a table.
    expect(catalogue).not.toContain("</");
    expect(catalogue).not.toContain("useState");
  });
});

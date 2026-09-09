import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SURFACE_FRAMES } from "./commands";

/**
 * The stand-in has to be the size and the name of the panel it stands in for.
 *
 * Every panel is behind a `lazy`, and so is the module holding them, so the
 * frame drawn while that chunk is on its way cannot ask the panel what it is
 * called or how wide it is. `SURFACE_FRAMES` copies both out of the panel
 * component, and a copy drifts: the first version of it knew one width, so a
 * settings-shaped panel got a stand-in fifty pixels narrower and the map
 * chrome moved once for the stand-in and again for the panel. Two surfaces
 * were missing from it outright and were announced to the reader under the
 * radar products' name.
 *
 * So this reads the panels back. Both files are source rather than a rendered
 * tree on purpose: the drift is between two literals, and rendering nineteen
 * panels to compare two attributes would need every one of their props.
 */

const ROOT = join(import.meta.dirname, "..");

/** Where a `PanelShell` is given its title and its class. */
const SHELL =
  /title=\{t\("([^"]+)"\)\}[\s\S]{0,400}?className="(surface-panel[^"]*)"/g;

/**
 * What each panel calls itself and how much room it takes, read out of the
 * components themselves.
 *
 * `components` as well as `panels` because the command palette is a panel in
 * every way that matters here and lives with the chrome.
 */
function panelsOnDisk(): Map<string, string> {
  const found = new Map<string, string>();
  for (const folder of ["panels", "components"]) {
    for (const name of readdirSync(join(ROOT, folder))) {
      if (!name.endsWith(".tsx") || name.endsWith(".test.tsx")) continue;
      const text = readFileSync(join(ROOT, folder, name), "utf8");
      for (const match of text.matchAll(SHELL)) {
        const [, key, className] = match;
        // A file may hold more than one panel; two panels may not claim one
        // title, or this could not tell which of them a frame describes.
        expect(
          found.has(key) ? found.get(key) : className,
          `two panels are titled ${key}`,
        ).toBe(className);
        found.set(key, className);
      }
    }
  }
  return found;
}

/** The surfaces the app can open, read off the union that names them. */
function surfaceIds(): string[] {
  const text = readFileSync(join(ROOT, "components", "CommandBar.tsx"), "utf8");
  const union = text.match(/export type SurfaceId =([\s\S]*?);/);
  expect(union, "the SurfaceId union has moved").not.toBeNull();
  return [...union![1].matchAll(/\|\s*"([^"]+)"/g)].map((one) => one[1]);
}

describe("the frame a panel's module is awaited in", () => {
  it("holds the room its own panel takes", () => {
    const panels = panelsOnDisk();
    // The scan has to have found the panels, or every comparison below is
    // vacuously true and the drift this exists for goes unseen.
    expect(panels.size).toBeGreaterThan(15);

    const wrong: string[] = [];
    for (const [surface, frame] of Object.entries(SURFACE_FRAMES)) {
      const onDisk = panels.get(frame.key);
      if (onDisk === undefined) {
        wrong.push(`${surface}: no panel is titled ${frame.key}`);
        continue;
      }
      if (onDisk !== frame.className) {
        wrong.push(
          `${surface}: the frame holds ${frame.className} and the panel takes ${onDisk}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("can name every surface the app opens", () => {
    const missing = surfaceIds().filter((id) => !(id in SURFACE_FRAMES));
    // "commands" and "section" were both missing, so the palette's own frame
    // and the cross-section panel's failure screen, loading frame and close
    // button were all labelled "Radar products".
    expect(missing).toEqual([]);
  });
});

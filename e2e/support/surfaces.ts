import { expect, type Page } from "@playwright/test";
import type { SurfaceId } from "../../src/components/CommandBar";
import { PANEL_SETTLE_MS } from "./axe";

/**
 * Every panel the workspace can put over the map, and how to open one.
 *
 * The accessibility gate used to name eleven panels in a list written by
 * hand, so seven of them had never been scanned in any theme and nothing said
 * so. The table below is typed as a record over the surface union itself:
 * adding a `SurfaceId` without a row here fails the typecheck, and
 * `surfacesCoverTheUnion` reads the union out of the source and fails the
 * suite too, for the case somebody runs the tests without `tsc`.
 */
export type OpenSurface = Exclude<SurfaceId, null>;

interface Surface {
  /** What its dialog is called, so a scan cannot run over a panel that never opened. */
  dialog: string;
  open(page: Page): Promise<void>;
}

/**
 * Opens a surface through the palette.
 *
 * The rail drops its labels at narrow widths and the panels are named
 * differently there in places, so the palette's own `data-command` is the one
 * handle that is the same at every width and in every language.
 */
async function fromPalette(page: Page, id: string) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator(`[data-command="surface:${id}"]`).click();
}

function palette(id: string, dialog: string): Surface {
  return { dialog, open: (page) => fromPalette(page, id) };
}

export const SURFACES: Record<OpenSurface, Surface> = {
  search: palette("search", "Search"),
  alerts: palette("alerts", "Alerts"),
  nearby: palette("nearby", "Nearby weather"),
  tropical: palette("tropical", "Tropical"),
  history: palette("history", "Storm history"),
  route: palette("route", "Route"),
  guidance: palette("guidance", "Guidance"),
  sounding: palette("sounding", "Sounding"),
  tides: palette("tides", "Tides"),
  "map-type": palette("map-type", "Map Type"),
  layers: palette("layers", "Layers"),
  export: palette("export", "Export"),
  upload: palette("upload", "Upload"),
  forecast: palette("forecast", "Forecast"),
  settings: palette("settings", "Settings"),
  more: palette("more", "Diagnostics"),
  commands: {
    // The palette is the one surface that cannot be opened from the palette.
    dialog: "Commands",
    open: async (page) => {
      await page.getByRole("button", { name: "Commands", exact: true }).click();
    },
  },
  section: {
    // Opened by the tool rather than by a button, and only once it has both
    // ends of the slice: the panel is keyed on the line.
    dialog: "Cross-section",
    open: async (page) => {
      const pane = page.getByRole("application", {
        name: "Interactive weather map",
      });
      // The tool has no palette entry, so the rail button is the only route.
      await page
        .getByRole("button", { name: "Cross-section", exact: true })
        .click();
      const box = (await pane.boundingBox())!;
      await page.mouse.click(
        box.x + box.width * 0.35,
        box.y + box.height * 0.45,
      );
      await page.mouse.click(
        box.x + box.width * 0.62,
        box.y + box.height * 0.55,
      );
    },
  },
};

/** Opens a surface and waits for it to be there and to have stopped moving. */
export async function openSurface(page: Page, id: OpenSurface) {
  const surface = SURFACES[id];
  await surface.open(page);
  const dialog = page.getByRole("dialog", { name: surface.dialog });
  await expect(dialog).toBeVisible();
  // The panel's own animations, waited on rather than slept through. A fixed
  // three hundred milliseconds is a guess about how busy the machine is, and
  // under the full suite it was occasionally wrong: axe read a colour part of
  // the way through a fade and called it a contrast failure, in a test that
  // passed every time it ran alone.
  await dialog.evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  // A floor for anything that moves without the animation API knowing, and
  // for the frame the browser needs to paint what it just settled.
  await page.waitForTimeout(PANEL_SETTLE_MS);
}

/**
 * The surface union as the source declares it.
 *
 * Read out of the file rather than imported, because a union is a type and
 * there is nothing left of it at runtime. It is what lets the coverage test
 * fail on a surface added without a row, whether or not the typecheck ran.
 */
export async function declaredSurfaces(): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../src/components/CommandBar.tsx", import.meta.url),
    "utf8",
  );
  const union = source.slice(
    source.indexOf("export type SurfaceId ="),
    source.indexOf("export type ToolMode"),
  );
  const ids = [...union.matchAll(/^\s*\|\s*"([a-z-]+)"/gm)].map(
    (match) => match[1],
  );
  if (ids.length === 0) throw new Error("no surfaces found in CommandBar.tsx");
  return ids;
}

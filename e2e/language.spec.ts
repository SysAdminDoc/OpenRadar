import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { clipped } from "./support/layout";
import { pseudoize } from "../src/i18n/pseudo";

/** The panels that hold copy, and the button that opens each one. */
const PANELS = [
  "Layers",
  "Map Type",
  "Settings",
  "Alerts",
  "Tropical",
  "Route",
  "Export",
  "Upload",
  "Forecast",
  "Search",
  "Diagnostics",
];

async function startIn(page: Page, language: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({ schemaVersion: 2, language: value }),
    );
  }, language);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  // Named in whatever language is on, so the wait does not depend on which.
  await expect(page.getByRole("application")).toBeVisible();
}

/**
 * Text that does not fit the box it was given.
 *
 * Wider than "the box clips it", deliberately. An earlier version only looked
 * at elements with `overflow-x: hidden`, which meant the way to make it pass
 * was to remove the overflow rule rather than to make the label fit. This
 * counts any text wider or taller than its own box, and skips only the
 * elements that are meant to scroll.
 */

test.describe("a workspace in another language", () => {
  test.use({ viewport: { width: 1024, height: 720 } });

  test("shows Spanish copy the moment the language is switched", async ({
    page,
  }) => {
    await startIn(page, "en");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Nothing is reloaded: the panel that made the change is the first thing
    // to change.
    await page.getByRole("button", { name: "Español", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Capas", exact: true }),
    ).toBeVisible();

    // And it holds across the panels, not just the one that was open.
    await page.getByRole("button", { name: "Capas", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Capas" })).toBeVisible();
    // Scoped to the switch list. The layer name also appears in the opacity
    // sliders below it now, so a bare lookup matches two things.
    await expect(
      page.locator(".setting-list").getByText("Alertas meteorológicas"),
    ).toBeVisible();

    // Back to English, in place, with no restart.
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("fits its labels in the pseudolocale at 1024 by 720", async ({
    page,
  }) => {
    await startIn(page, "pseudo");

    // The bracket is the marker the generated language wraps every string in,
    // so seeing one means the screen really is drawn in it.
    await expect(page.locator(".command-bar")).toContainText("⟦");

    const offenders: string[] = [];
    let opened = 0;
    for (const panel of PANELS) {
      // The buttons are labelled in the generated language too, so the
      // selector has to be, or this loop would quietly open nothing and pass
      // without looking at a single panel.
      const button = page.locator(
        `.command-bar button[aria-label="${pseudoize(panel)}"]`,
      );
      if (!(await button.count())) continue;
      await button.first().click();
      await expect(page.locator(".surface-panel")).toBeVisible();
      opened += 1;
      offenders.push(
        ...(await clipped(page)).map((text) => `${panel}: ${text}`),
      );
      await button.first().click();
    }

    expect(opened, "no panel was opened, so nothing was measured").toBe(
      PANELS.length,
    );
    expect(offenders).toEqual([]);

    // And the window itself does not scroll sideways to make room.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

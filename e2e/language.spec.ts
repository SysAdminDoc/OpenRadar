import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
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
async function clipped(page: Page) {
  return page.evaluate(() => {
    const scrolls = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        style.overflowX === "auto" ||
        style.overflowX === "scroll" ||
        style.overflowY === "auto" ||
        style.overflowY === "scroll"
      );
    };
    const bad: string[] = [];
    const scope = [
      ".surface-panel",
      ".command-bar",
      ".radar-timeline",
      ".radar-legend",
      ".product-legends",
      ".satellite-chip",
      ".pane-compare",
      ".tool-hud",
      ".toast",
      ".zoom-controls",
    ].join(", ");
    for (const root of document.querySelectorAll<HTMLElement>(scope)) {
      for (const element of [
        root,
        ...root.querySelectorAll<HTMLElement>("*"),
      ]) {
        // A box that is meant to scroll is doing its job, and so is anything
        // inside one: the point of a scroller is that its contents are allowed
        // to be bigger than it is.
        if (scrolls(element)) continue;
        let inScroller = false;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (scrolls(parent)) {
            inScroller = true;
            break;
          }
        }
        if (inScroller) continue;
        if (element.tagName === "CANVAS" || element.tagName === "INPUT") {
          continue;
        }
        // The one caption allowed to end in an ellipsis. It sits under an
        // icon in a bar of fixed height, and the whole label is on the
        // button's tooltip and its accessible name, so nothing is lost by
        // shortening what is drawn. The bar itself scrolls, so no button
        // becomes unreachable however long the words get.
        if (element.closest(".command-button")) continue;
        if (!element.textContent?.trim()) continue;
        const wide = element.scrollWidth > element.clientWidth + 1;
        const tall = element.scrollHeight > element.clientHeight + 1;
        if (!wide && !tall) continue;
        bad.push(
          `${element.className || element.tagName} ${wide ? "wide" : "tall"}: ${element.textContent
            .trim()
            .slice(0, 40)}`,
        );
      }
    }
    return bad;
  });
}

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

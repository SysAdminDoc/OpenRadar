import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { clipped, unreachable } from "./support/layout";
import { pseudoize } from "../src/i18n/pseudo";

/**
 * The workspace on a real wide desktop.
 *
 * The rest of the suite runs at 1440 and 1024, which is where things get
 * pushed together. A wide window fails the other way: a layout that fills 1440
 * can leave a strip of nothing down the middle of 1920, or strand a control
 * against an edge, and neither shows up at a width where everything is already
 * tight. The README's own screenshot is taken at this width, so it is also the
 * one the pictures have to be honest about.
 *
 * The captures go to `test-results/wide/`, which is not committed. They are
 * evidence for a person looking at a layout question, not a comparison the
 * suite makes for itself: a pixel comparison of a live map would fail on the
 * weather.
 */
const SHOTS = "test-results/wide";

/** Panels animate in, and a measurement mid-animation is a measurement of nothing. */
const SETTLE_MS = 300;

const PANELS = [
  "Layers",
  "Map Type",
  "Alerts",
  "Tropical",
  "Route",
  "Search",
  "Export",
  "Upload",
  "Forecast",
  "Settings",
  "Diagnostics",
];

async function startIn(page: Page, language?: string) {
  if (language) {
    await page.addInitScript((value) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({ schemaVersion: 2, language: value }),
      );
    }, language);
  }
  await routeWorkspace(page);
  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=6&bearing=0&pitch=0");
  await expect(page.getByRole("application")).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
}

/** What the window is actually being measured at, so the evidence says so. */
async function room(page: Page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    sideways:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
}

test("fills a wide window rather than leaving a strip of nothing", async ({
  page,
}) => {
  await startIn(page);
  const measured = await room(page);
  // The evidence is only evidence if it was taken at the width it claims.
  expect(measured.width).toBeGreaterThanOrEqual(1916);
  expect(measured.sideways).toBeLessThanOrEqual(2);

  // The map takes everything the command bar leaves. A layout capped at some
  // fixed width would show up here as a gap nobody put there on purpose.
  const gap = await page.evaluate(() => {
    const stage = document.querySelector(".map-stage") ?? document.body;
    const pane = document.querySelector(".map-viewport");
    if (!pane) return null;
    const inside = stage.getBoundingClientRect();
    const drawn = pane.getBoundingClientRect();
    return Math.round(inside.width - drawn.width);
  });
  expect(gap, "the map does not fill the stage").not.toBeNull();
  expect(gap!).toBeLessThanOrEqual(2);

  expect(await unreachable(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
  // Wide enough that the command bar keeps its labels, which is the thing the
  // compact project checks the other side of.
  await expect(
    page.locator(".command-group--tools .command-button span").first(),
  ).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/default.png` });
});

test("keeps every panel inside the window", async ({ page }) => {
  await startIn(page);
  const offenders: string[] = [];
  for (const name of PANELS) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);

    // Inside the window, not merely rendered somewhere.
    const box = (await page.locator(".surface-panel").boundingBox())!;
    const size = page.viewportSize()!;
    if (box.x < -2 || box.x + box.width > size.width + 2) {
      offenders.push(
        `${name} sits at ${Math.round(box.x)}..${Math.round(box.x + box.width)}`,
      );
    }
    offenders.push(...(await clipped(page)).map((text) => `${name}: ${text}`));
    await page.getByRole("button", { name: `Close ${name}` }).click();
  }
  expect(offenders).toEqual([]);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: `${SHOTS}/panel-open.png` });
});

test("splits a wide window into two panes worth having", async ({ page }) => {
  await startIn(page);
  await page.getByRole("button", { name: "Dual Pane", exact: true }).click();
  await page.waitForTimeout(SETTLE_MS);

  const panes = page.locator(".map-viewport");
  await expect(panes).toHaveCount(2);
  const first = (await panes.nth(0).boundingBox())!;
  const second = (await panes.nth(1).boundingBox())!;
  // Two panes of roughly the same size, both wide enough to be a map rather
  // than a sliver beside a map.
  expect(Math.abs(first.width - second.width)).toBeLessThanOrEqual(4);
  expect(first.width).toBeGreaterThan(700);

  expect(await clipped(page)).toEqual([]);
  expect(await unreachable(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/dual-pane.png` });
});

test("holds together at 130 percent text", async ({ page }) => {
  await startIn(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "130%", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(SETTLE_MS);

  expect(await unreachable(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
  expect((await room(page)).sideways).toBeLessThanOrEqual(2);

  // The legend is the piece that has to stay readable rather than merely fit:
  // its numbers are the scale the map is painted on.
  await expect(page.locator(".legend-scale")).toBeVisible();
  await expect(page.locator(".legend-scale")).toHaveText("520355065");

  await page.screenshot({ path: `${SHOTS}/text-130.png` });
});

test("fits words a third longer than the English", async ({ page }) => {
  // The generated language accents every letter and pads each string by a
  // third, which is the worst case any translation puts the layout under.
  await startIn(page, "pseudo");
  await expect(page.locator(".command-bar")).toContainText("⟦");

  const offenders: string[] = [];
  let opened = 0;
  for (const panel of PANELS) {
    const button = page.locator(
      `.command-bar button[aria-label="${pseudoize(panel)}"]`,
    );
    if (!(await button.count())) continue;
    await button.first().click();
    await expect(page.locator(".surface-panel")).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    opened += 1;
    // The rail may shorten a caption in the generated language, whose
    // words are a third longer than any reader's, and may not in one
    // somebody reads: the English sweeps above hold it to fitting.
    offenders.push(
      ...(await clipped(page, true)).map((text) => `${panel}: ${text}`),
    );
    await button.first().click();
  }
  expect(opened, "no panel was opened, so nothing was measured").toBe(
    PANELS.length,
  );
  expect(offenders).toEqual([]);
  expect((await room(page)).sideways).toBeLessThanOrEqual(2);

  await page.screenshot({ path: `${SHOTS}/pseudolocale.png` });
});

test("fits the Spanish workspace", async ({ page }) => {
  await startIn(page, "es");
  await page.getByRole("button", { name: "Capas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Capas" })).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);

  expect(await clipped(page)).toEqual([]);
  expect(await unreachable(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/spanish.png` });
});

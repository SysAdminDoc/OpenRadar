import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * The map as something to send somebody.
 *
 * Worth holding in the real workspace: that the plain export is untouched
 * beside it, and that the card is offered at the three documented shapes in
 * every language rather than only in English.
 */

/** Opens the export panel with the workspace in one language. */
async function openIn(
  page: import("@playwright/test").Page,
  language: string,
  label: string,
) {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({ schemaVersion: 3, language: value }),
    );
  }, language);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
  // Named in whatever language is on, so the button is found by its own
  // label rather than by an English one.
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("says the same things in Spanish and in French", async ({ page }) => {
  // The disclaimer is three characters longer in French than in English and
  // feeds straight into the layout, and the shapes are named in the
  // catalogue rather than in the component. Neither was ever exercised
  // outside English.
  for (const [language, label, shapes, official] of [
    [
      "es",
      "Exportar",
      ["Cuadrada", "Apaisada", "Vertical"],
      "producto oficial",
    ],
    ["fr", "Exportation", ["Carrée", "Large", "Haute"], "produit officiel"],
  ] as const) {
    await openIn(page, language, label);
    const postcard = page.locator("[data-postcard]");
    await expect(postcard, language).toBeVisible();
    await expect(postcard, language).toContainText(official);
    for (const shape of shapes) {
      await expect(
        postcard.locator("option", { hasText: shape }),
        `${language} ${shape}`,
      ).toHaveCount(1);
    }
  }
});

test("offers a postcard beside the plain picture, not instead of it", async ({
  page,
}) => {
  await openIn(page, "en", "Export");
  // Evidence and a postcard are different jobs. The plain export is still
  // the first thing in the panel and still says what it always did.
  await expect(
    page.getByRole("button", { name: /Export picture/ }),
  ).toBeVisible();

  const postcard = page.locator("[data-postcard]");
  await expect(postcard).toBeVisible();
  await expect(postcard).toContainText("Not an official product");
  for (const shape of ["Square", "Wide", "Tall"]) {
    await expect(postcard.locator("option", { hasText: shape })).toHaveCount(1);
  }
});

test("saves one with whatever the reader wrote on it", async ({ page }) => {
  await openIn(page, "en", "Export");
  const postcard = page.locator("[data-postcard]");
  await postcard.getByRole("textbox").fill("Hail the size of marbles");
  const download = page.waitForEvent("download");
  await postcard.getByRole("button", { name: /Save the postcard/ }).click();
  const saved = await download;
  // Named for the shape, so three of them do not overwrite each other.
  expect(saved.suggestedFilename()).toContain("openradar-postcard-square");
  expect(saved.suggestedFilename()).toMatch(/\.png$/);
});

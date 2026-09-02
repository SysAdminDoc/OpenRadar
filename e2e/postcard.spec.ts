import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * The map as something to send somebody.
 *
 * Worth holding in the real workspace: that the plain export is untouched
 * beside it, and that the card is offered at the three documented shapes in
 * every language rather than only in English.
 */

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
});

test("offers a postcard beside the plain picture, not instead of it", async ({
  page,
}) => {
  // Evidence and a postcard are different jobs. The plain export is still
  // the first thing in the panel and still says what it always did.
  await expect(
    page.getByRole("button", { name: /Export image/ }),
  ).toBeVisible();

  const postcard = page.locator("[data-postcard]");
  await expect(postcard).toBeVisible();
  await expect(postcard).toContainText("Not an official product");
  for (const shape of ["Square", "Wide", "Tall"]) {
    await expect(postcard.locator("option", { hasText: shape })).toHaveCount(1);
  }
});

test("saves one with whatever the reader wrote on it", async ({ page }) => {
  const postcard = page.locator("[data-postcard]");
  await postcard.getByRole("textbox").fill("Hail the size of marbles");
  const download = page.waitForEvent("download");
  await postcard.getByRole("button", { name: /Save the postcard/ }).click();
  const saved = await download;
  // Named for the shape, so three of them do not overwrite each other.
  expect(saved.suggestedFilename()).toContain("openradar-postcard-square");
  expect(saved.suggestedFilename()).toMatch(/\.png$/);
});

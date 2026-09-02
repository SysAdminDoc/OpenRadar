import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * A storm name typed into the place search.
 *
 * Typing Katrina there asks a geocoder about a town, which is not what anybody
 * meant. The record ships with the app, so the question can be answered from
 * the disk instead. What is worth holding in the real workspace: that the
 * storms are kept plainly apart from the places, that a name which is also a
 * place still returns the place, that nothing on screen reads as a storm that
 * is happening now, and that choosing one lands on its track.
 *
 * That a reused name returns every storm that carried it is held in
 * `src/lib/hurdat.test.ts`, where a record with three Bonnies can be handed
 * to the matcher directly.
 */

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
});

test("answers a storm name out of the bundled record", async ({ page }) => {
  await page.getByRole("textbox").fill("ian");

  const storms = page.locator("[data-search-storms]");
  await expect(storms).toBeVisible();
  const rows = storms.locator("[data-search-storm]");
  await expect(rows).toHaveCount(1);
  // Year, basin and peak intensity, so two storms of one name are told apart
  // without opening either.
  await expect(rows.first()).toContainText("2022");
  await expect(storms).toContainText("Atlantic");
  await expect(storms).toContainText(/Category|kt peak/);
  // And nothing here reads as a storm that is happening now.
  await expect(storms).toContainText("None of these is a storm happening now");
});

test("still answers with the place when the name is also a place", async ({
  page,
}) => {
  await page.getByRole("textbox").fill("ian");
  await expect(page.locator("[data-search-storms]")).toBeVisible();
  // The geocoder's answer is still there, below the storms, with its own
  // icon and its own region line. A storm result must not displace a place
  // somebody was actually looking for.
  const places = page
    .locator(".result-list > .result-row")
    .filter({ hasNot: page.locator("[data-search-storm]") });
  await expect(places.first()).toBeVisible();
});

test("takes a chosen storm to its track", async ({ page }) => {
  await page.getByRole("textbox").fill("ian 2022");
  await page.locator("[data-search-storm]").first().click();

  // Storm history opens on it, which is where the track is drawn and where
  // the replay is offered for the years the archive reaches. Nothing about
  // that is decided in the search.
  await expect(page.locator("[data-history-storm]")).toBeVisible();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /track-line/);
});

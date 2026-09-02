import { expect, test } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * Canadian warnings, drawn and watched like American ones.
 *
 * The app has drawn ECCC radar for as long as it has looked north of the
 * border, and it ships Canadian French, but a watched place in Saskatchewan
 * never said a word: the only warnings it knew about were American. These are
 * on the same layer rather than a switch of their own, so what this file is
 * really checking is that nothing downstream can tell the difference.
 */

/** Regina, and a warning square around it. */
const REGINA: [number, number] = [-104.62, 50.45];

const ecccFeed = (lon: number, lat: number) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [lon - 0.4, lat - 0.4],
              [lon + 0.4, lat - 0.4],
              [lon + 0.4, lat + 0.4],
              [lon - 0.4, lat + 0.4],
              [lon - 0.4, lat - 0.4],
            ],
          ],
        ],
      },
      properties: {
        alert_code: "TRW",
        alert_type: "warning",
        alert_name_en: "tornado warning",
        alert_name_fr: "alerte de tornade",
        risk_colour_en: "red",
        feature_id: "TRW-SK-e2e",
        feature_name_en: "Regina",
        feature_name_fr: "Regina",
        publication_datetime: new Date(Date.now() - 60_000).toISOString(),
        expiration_datetime: new Date(Date.now() + 3_600_000).toISOString(),
        alert_text_en:
          "A tornado has been spotted near Regina. Take cover immediately.",
        alert_text_fr:
          "Une tornade a été aperçue près de Regina. Mettez-vous à l'abri.",
      },
    },
  ],
});

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws a Canadian warning and watches a place inside it", async ({
  page,
}) => {
  const [lon, lat] = REGINA;
  await stubHost(page, "https://api.weather.gc.ca/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(ecccFeed(lon, lat)),
    });
  });
  await page.goto(
    `/?testMode=1&lon=${lon}&lat=${lat}&zoom=7&bearing=0&pitch=0`,
  );
  await expect(page.getByRole("application")).toBeVisible();

  // In the Alerts panel, beside where an American one would be, with the
  // office's own words under it and the office named.
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const row = page.locator(".alert-row").first();
  await expect(row).toContainText("Tornado Warning");
  await expect(row).toContainText("A tornado has been spotted near Regina");
  await page.getByRole("button", { name: "Close Alerts" }).click();

  // And the watch, through the same path, with no idea which country it is
  // in: the whole design is that nothing downstream has to know.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();
  await expect(page.getByText("Watching this point")).toBeVisible();

  const toast = page.locator(".toast-host");
  await expect(toast.getByText("Tornado Warning").first()).toBeVisible();
});

test("leaves a place in Florida alone", async ({ page }) => {
  // The same feed, answering about Saskatchewan, while the reader is watching
  // the Gulf. A layer that announced everything it fetched rather than what
  // covers the watched point would speak here, and it is the failure that
  // would matter: a warning read out for somewhere two thousand miles away
  // teaches a reader to ignore the next one.
  const [lon, lat] = REGINA;
  await stubHost(page, "https://api.weather.gc.ca/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(ecccFeed(lon, lat)),
    });
  });
  await page.goto("/?testMode=1&lon=-85.5&lat=26.5&zoom=7&bearing=0&pitch=0");
  await expect(page.getByRole("application")).toBeVisible();

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  // The American fixture warning is here and the Canadian one is not: the
  // request is bounded by the view, and a view over the Gulf does not reach
  // Canada at all.
  await expect(page.locator(".alert-row").first()).toContainText(
    "Tornado Warning",
  );
  await expect(page.getByText("near Regina")).toHaveCount(0);
});

/** Hamburg, and a warning square around it. */
const HAMBURG: [number, number] = [9.99, 53.55];

const dwdFeed = (lon: number, lat: number) => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [lon - 0.3, lat - 0.3],
              [lon + 0.3, lat - 0.3],
              [lon + 0.3, lat + 0.3],
              [lon - 0.3, lat + 0.3],
              [lon - 0.3, lat - 0.3],
            ],
          ],
        ],
      },
      properties: {
        IDENTIFIER: "2.49.0.0.276.0.DWD.PVW.e2e",
        EVENT: "STARKES GEWITTER",
        EC_GROUP: "GEWITTER",
        SEVERITY: "Severe",
        NAME: "Hamburg-Mitte",
        SENDERNAME: "Deutscher Wetterdienst",
        WEB: "https://dwd.de/warnungen",
        ONSET: new Date(Date.now() - 60_000).toISOString(),
        EXPIRES: new Date(Date.now() + 3_600_000).toISOString(),
        DESCRIPTION:
          "Es treten Gewitter mit Starkregen und Sturmböen bis 90 km/h auf.",
        INSTRUCTION: "Hinweis auf: umherfliegende Gegenstände.",
      },
    },
  ],
});

test("draws a German warning in the office's own words", async ({ page }) => {
  // The DWD composite of seventeen radars has been on the map for as long as
  // the app has looked at Europe, and nothing said a Gewitterwarnung stood
  // over it. Same layer as the American and Canadian ones, so the switches,
  // the watch and the readout treat it the same.
  const [lon, lat] = HAMBURG;
  await stubHost(page, "https://maps.dwd.de/geoserver/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(dwdFeed(lon, lat)),
    });
  });
  await page.goto(
    `/?testMode=1&lon=${lon}&lat=${lat}&zoom=7&bearing=0&pitch=0`,
  );
  await expect(page.getByRole("application")).toBeVisible();

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const row = page.locator(".alert-row").first();
  // Title case, not the office's block capitals, which would read as louder
  // than the office issued it.
  await expect(row).toContainText("Starkes Gewitter");
  // The office's own German, unaltered: an English paraphrase of a Sturmbö
  // would be this app inventing a warning nobody issued.
  await expect(row).toContainText("Sturmböen bis 90 km/h");
});

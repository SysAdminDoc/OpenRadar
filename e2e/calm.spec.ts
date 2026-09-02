import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * A calmer way to read the same weather.
 *
 * The half worth holding in the real workspace is the half that would hurt
 * somebody: the warning arrives at the same moment, says the same thing, and
 * is drawn in the same colour. What changes is the app around it.
 */

const HOME: [number, number] = [-96.8, 32.78];

async function start(page: Page, calm: boolean) {
  await page.addInitScript((value: boolean) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        catchUp: false,
        curiosities: false,
        calm: value,
        watch: {
          enabled: true,
          sound: false,
          name: "Casa",
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      }),
    );
  }, calm);
  await routeWorkspace(page);
  await stubHost(
    page,
    "https://mapservices.weather.noaa.gov/**",
    async (route) => {
      const [lon, lat] = HOME;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [lon - 0.2, lat - 0.2],
                    [lon + 0.2, lat - 0.2],
                    [lon + 0.2, lat + 0.2],
                    [lon - 0.2, lat + 0.2],
                    [lon - 0.2, lat - 0.2],
                  ],
                ],
              },
              properties: {
                prod_type: "Tornado Warning",
                sig: "W",
                wfo: "FWD",
                issuance: new Date(Date.now() - 60_000).toISOString(),
                expiration: new Date(Date.now() + 3_600_000).toISOString(),
              },
            },
          ],
        }),
      });
    },
  );
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

/** The swatch beside an alert, which is the office's own severity colour. */
async function swatch(page: Page) {
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const row = page.locator(".alert-row").first();
  await expect(row).toBeVisible();
  return row.locator("i").evaluate((one) => getComputedStyle(one).background);
}

test("says the same thing about a warning, in the same colour", async ({
  page,
}) => {
  await start(page, false);
  const plain = await swatch(page);
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();

  await start(page, true);
  await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
  // The same warning, said the same way, drawn the same colour. A mode that
  // muted a tornado warning would be the most dangerous thing here.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  expect(await swatch(page)).toBe(plain);
});

test("adds a line about what to do rather than how bad it could be", async ({
  page,
}) => {
  await start(page, true);
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  const advice = page.locator("[data-calm-advice]").first();
  await expect(advice).toBeVisible();
  await expect(advice).toContainText("lowest floor");
  // The office's own headline is still above it, unchanged.
  await expect(page.locator(".alert-row").first()).toContainText(
    "Tornado Warning",
  );
});

test("leaves nothing behind when it is switched off", async ({ page }) => {
  await start(page, true);
  await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("checkbox", { name: /A calmer way to read it/ })
    .uncheck();
  // No residue: the attribute goes, and with it every rule that hung off it.
  await expect(page.locator("html")).not.toHaveAttribute("data-calm", "1");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.locator("[data-calm-advice]")).toHaveCount(0);
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
});

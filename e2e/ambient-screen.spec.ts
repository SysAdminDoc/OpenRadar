import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * The workspace as something to leave on a second monitor.
 *
 * What is worth holding in the real workspace: that it fills the window and
 * keeps the time, the place and the source on screen; that it is entered
 * deliberately and never on its own by default; that a warning where the
 * reader watches takes it down; and that leaving it puts everything back.
 */

const HOME: [number, number] = [-96.8, 32.78];

async function start(page: Page, warning = false) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        catchUp: false,
        curiosities: false,
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
  });
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
          features: warning
            ? [
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
              ]
            : [],
        }),
      });
    },
  );
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

async function enter(page: Page) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="ambient-screen"]').click();
}

test("is entered deliberately and never on its own", async ({ page }) => {
  await start(page);
  // Nothing has taken the workspace over: the default is never.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();

  await enter(page);
  const readout = page.locator("[data-ambient-readout]");
  await expect(readout).toBeVisible();
  // The time, the place, and what the map is showing.
  await expect(readout).toContainText("Casa");
  await expect(readout).toContainText(/\d/);
  // And nothing else: the chrome is gone.
  await expect(page.locator(".command-bar")).toBeHidden();
});

test("puts the workspace back without rebuilding it", async ({ page }) => {
  await start(page);
  // A mark on the map element itself. Nothing is unmounted by this mode, so
  // the same node has to come back: a remounted map is a new WebGL context,
  // a refetched loop and a lost camera.
  await page.evaluate(() => {
    document
      .querySelector('[role="application"]')
      ?.setAttribute("data-was-here", "1");
  });

  await enter(page);
  await expect(page.locator("[data-ambient-readout]")).toBeVisible();
  await expect(page.locator(".command-bar")).toBeHidden();

  // The way out is on the readout itself: the command bar it was reached
  // from is one of the things the mode hides, and this project has no
  // keyboard shortcuts.
  await page
    .getByRole("button", { name: "Leave the full-screen view" })
    .click();

  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
  await expect(page.locator('[role="application"]')).toHaveAttribute(
    "data-was-here",
    "1",
  );
});

test("stands aside for a warning where you watch", async ({ page }) => {
  await start(page, true);
  // The positive control: the warning really did land.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await enter(page);
  // The whole point of the app is the thing that just happened, and a second
  // monitor showing a clean loop through it hides the app's reason to exist.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
});

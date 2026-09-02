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

test("stands its own advice down when the office wrote some", async ({
  page,
}) => {
  // The calm line is written by this app out of the product's name. It exists
  // because the office's headline is not advice. Where the office DID write
  // an instruction, that is the one a reader should be reading: a line this
  // app composed sitting above a forecaster's own words is the wrong way
  // round, and two sets of instructions on one warning is worse than either.
  await start(page, true);
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
                cap_id: "urn:oid:2.49.0.1.840.0.test.001.1",
                issuance: new Date(Date.now() - 60_000).toISOString(),
                expiration: new Date(Date.now() + 3_600_000).toISOString(),
              },
            },
          ],
        }),
      });
    },
  );
  await page.reload();
  await expect(page.getByRole("application")).toBeVisible();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();

  const row = page.locator(".alert-row").first();
  await expect(row).toContainText("Tornado Warning");
  await expect(row.locator("[data-office-instruction]")).toContainText(
    "TAKE COVER NOW!",
  );
  await expect(page.locator("[data-calm-advice]")).toHaveCount(0);
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

test("the calmer look reaches the Live button too", async ({ page }) => {
  // It was a fixed cyan, so the loudest control in the workspace stayed
  // shouting in a mode whose whole point is turning the decoration down, and
  // a reader's own accent and every seasonal pack stopped at its edge.
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();

  const button = page.locator(".timeline-live-button");
  await expect(button).toBeVisible();

  // Off the newest frame first. The button is disabled while the timeline is
  // already live, and a disabled one is drawn in a raised surface rather than
  // in the accent, so measuring without this reads whichever state the load
  // happened to be in: it passed alone every time and failed about one full
  // suite in three, having compared two disabled buttons and found them the
  // same colour. What the test is about is the accent, so the button has to
  // be in the state that shows one.
  const scrubber = page.getByLabel("Radar frame", { exact: true });
  await expect
    .poll(async () => Number(await scrubber.getAttribute("max")))
    .toBeGreaterThan(0);
  await scrubber.fill("0");
  await expect(button).toBeEnabled();
  const loud = await button.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /A calmer way to read it/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
  await page.getByRole("button", { name: "Close Settings" }).click();

  await scrubber.fill("0");
  await expect(button).toBeEnabled();
  const calm = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    // Against `--accent-fill` rather than `--accent`: every filled accent in
    // the app holds its lightness above a floor the fixed ink clears, so that
    // a colour the reader chose from a well cannot make a button unreadable.
    const probe = document.createElement("div");
    probe.style.background = "var(--accent-fill)";
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { background: style.backgroundColor, fill };
  });
  expect(calm.background).not.toBe(loud);
  expect(calm.background).toBe(calm.fill);
});

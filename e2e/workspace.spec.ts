import { expect, test } from "@playwright/test";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("https://api.rainviewer.com/public/weather-maps.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [
            { time: 1788067200, path: "/v2/radar/1788067200" },
            { time: 1788067800, path: "/v2/radar/1788067800" },
            { time: 1788068400, path: "/v2/radar/1788068400" },
          ],
        },
      }),
    });
  });
  await page.route("https://tilecache.rainviewer.com/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("switches globe projection without changing the radar timeline", async ({ page }) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("3 radar frames");
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(page.getByRole("button", { name: "Flat", exact: true })).toBeVisible();
  await expect(timeline).toContainText("3 radar frames");
});

test("opens layers and saves a map preset", async ({ page }) => {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
  const earthquakes = page.getByRole("checkbox", { name: /Earthquakes/ });
  await earthquakes.check();
  await expect(earthquakes).toBeChecked();

  await page.getByRole("button", { name: "Close Layers" }).click();
  await page.getByLabel("Save preset 1").click();
  await expect(page.getByText("Preset 1 saved")).toBeVisible();
  await expect(page.getByLabel("Open preset 1")).toBeVisible();
});

test("opens dual pane and exposes drawing feedback", async ({ page }) => {
  await page.getByRole("button", { name: "Dual Pane" }).click();
  await expect(page.getByRole("application")).toHaveCount(2);
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByText("Click the map to draw a path")).toBeVisible();
});

test("applies the light theme from settings", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

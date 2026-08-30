import { expect, test } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("gives a Canadian viewport Canada's own radar", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("geo.weather.gc.ca")) asked.push(request.url());
  });

  // Winnipeg, well inside the country and inside the American mosaic's box.
  await page.goto("/?testMode=1&lon=-97.1&lat=49.9&zoom=6&bearing=0&pitch=0");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await expect(page.getByText(/radar frames · ECCC GeoMet/)).toBeVisible();
  // The credit has to be on screen and point at the licence, not buried in a
  // file nobody opens.
  const credit = page.getByRole("link", { name: "ECCC GeoMet" });
  await expect(credit).toBeAttached();
  await expect(credit).toHaveAttribute(
    "href",
    "https://eccc-msc.github.io/open-data/licence/readme_en/",
  );

  // Rain rate, not reflectivity: a dBZ scale over a mm/h picture would be
  // describing the wrong quantity.
  await expect(page.getByText("Rain Rate")).toBeVisible();
  await expect(page.getByLabel("Rain Rate from 0.1 to 200 mm/h")).toBeVisible();

  await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const tiles = asked.filter((url) => url.includes("GetMap"));
  expect(tiles.length).toBeGreaterThan(0);
  // GeoMet refuses an instant carrying milliseconds and answers with an
  // exception rather than a tile, and the exception arrives with a 200.
  expect(tiles.every((url) => !url.includes(".000Z"))).toBe(true);
  expect(tiles.every((url) => /time=[^&]*%3A00Z/.test(url))).toBe(true);
});

test("keeps the United States on the NOAA mosaic", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("geo.weather.gc.ca")) asked.push(request.url());
  });

  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=6&bearing=0&pitch=0");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await expect(page.getByText(/radar frames · NWS RIDGE II/)).toBeVisible();
  await expect(page.getByText("Composite Radar")).toBeVisible();
  // GeoMet's own box reaches over the northern states; it must not be asked.
  expect(asked).toEqual([]);
});

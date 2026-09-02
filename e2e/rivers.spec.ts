import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

// River gauges are the hazard radar cannot see: what the water near the storm
// reads now, and what the forecast office expects it to reach. The service is
// stood in for here so the test is about what the map and the panel do with
// an answer rather than about the weather on the day it runs.

const GAUGES = {
  gauges: [
    {
      lid: "DESI4",
      name: "Des Moines River at Des Moines SE 6th St",
      wfo: { abbreviation: "DMX", name: "Des Moines" },
      state: { abbreviation: "IA", name: "Iowa" },
      // Exactly the middle of the view the test opens, so a click at the
      // centre of the pane is a click on this gauge.
      latitude: 41.6,
      longitude: -93.6,
      status: {
        observed: {
          primary: 21.2,
          primaryUnit: "ft",
          floodCategory: "action",
          validTime: "2026-09-01T22:00:00Z",
        },
        forecast: {
          primary: 27.5,
          primaryUnit: "ft",
          floodCategory: "moderate",
          validTime: "2026-09-03T12:00:00Z",
        },
      },
    },
    {
      lid: "CEDI4",
      name: "Cedar River at Cedar Rapids",
      wfo: { abbreviation: "DVN", name: "Quad Cities" },
      latitude: 41.72,
      longitude: -93.5,
      status: {
        observed: {
          primary: 6.4,
          primaryUnit: "ft",
          floodCategory: "no_flooding",
          validTime: "2026-09-01T21:45:00Z",
        },
        // The shape the service uses for a gauge nobody is forecasting.
        forecast: {
          primary: -999,
          primaryUnit: "",
          floodCategory: "fcst_not_current",
          validTime: "0001-01-01T00:00:00Z",
        },
      },
    },
  ],
};

const LAYER = "openradar-overlay-riverGauges-circle";

async function stubGauges(page: Page, body: unknown, status = 200) {
  await page.route("**/nwps/v1/gauges*", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openAt(page: Page, zoom: number) {
  await page.goto(
    `/?testMode=1&lon=-93.6&lat=41.6&zoom=${zoom}&bearing=0&pitch=0`,
  );
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the gauges near the storm and says what each one is doing", async ({
  page,
}) => {
  await stubGauges(page, GAUGES);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/nwps/v1/gauges")) asked.push(request.url());
  });
  await openAt(page, 9);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".toggle-row")
    .filter({ hasText: "River Gauges" })
    .getByRole("checkbox")
    .check();

  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  // The service reads a box as mercator metres unless it is told otherwise,
  // and answers an unlabelled one with an empty list rather than an error.
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked[0]).toContain("srid=EPSG_4326");
  expect(asked[0]).toContain("bbox.xmin=");

  // The gauge at the middle of the view is the one the office expects to
  // rise, so clicking there is clicking it.
  await page.keyboard.press("Escape");
  const box = await pane.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );

  const popup = page.locator(".map-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Des Moines River");
  // Measured and expected are separate lines with their own words, so
  // neither can be mistaken for the other.
  await expect(popup).toContainText("Observed 21.20 ft");
  await expect(popup).toContainText("Forecast 27.50 ft");
  await expect(popup).toContainText("moderate flood");
  // Nothing about the service's sentinels reaches a reader.
  await expect(popup).not.toContainText("-999");
  await expect(
    popup.getByRole("link", { name: /water.noaa.gov|official|gauge/i }).first(),
  ).toHaveAttribute("href", "https://water.noaa.gov/gauges/DESI4");
});

test("stays off the map until the view is close enough, and says why", async ({
  page,
}) => {
  await stubGauges(page, GAUGES);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/nwps/v1/gauges")) asked.push(request.url());
  });
  await openAt(page, 5);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const row = page.locator(".toggle-row").filter({ hasText: "River Gauges" });
  await row.getByRole("checkbox").check();

  // A country's worth of gauges at once is unreadable and a request nobody
  // wanted, so the layer waits and the switch says so instead of looking
  // broken.
  await expect(row).toContainText("Zoom in to see the gauges");
  await expect(pane).not.toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  expect(asked).toHaveLength(0);
});

test("puts the service's own failure beside the switch", async ({ page }) => {
  await stubGauges(page, { error: "maintenance" }, 503);
  await openAt(page, 9);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const row = page.locator(".toggle-row").filter({ hasText: "River Gauges" });
  await row.getByRole("checkbox").check();

  await expect(row).toContainText(
    "The National Water Prediction Service returned 503",
  );
});

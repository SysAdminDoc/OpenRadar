import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

// The hazard areas a forecaster drew and the reports from people who flew
// through them. A commercial aviation chart charges for the same public data.
// The services are stood in for here so the test is about what the map does
// with an answer rather than about what was in the air on the day it runs.

const LAYER = "openradar-overlay-aviation-fill";

const SIGMET = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        airSigmetType: "SIGMET",
        hazard: "CONVECTIVE",
        validTimeFrom: "2026-09-10T06:55:00.000Z",
        validTimeTo: "2026-09-10T08:55:00.000Z",
        altitudeHi1: 34000,
        altitudeLow1: null,
        rawAirSigmet: "CONVECTIVE SIGMET 10W",
      },
      // A square around the middle of the view the test opens, so a click at
      // the centre of the pane is a click inside it.
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95.5, 39.5],
            [-93.5, 39.5],
            [-93.5, 41.5],
            [-95.5, 41.5],
            [-95.5, 39.5],
          ],
        ],
      },
    },
  ],
};

const EMPTY = { type: "FeatureCollection", features: [] };

async function stubAviation(page: Page) {
  await page.route("**/api/data/airsigmet*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SIGMET),
    });
  });
  await page.route("**/api/data/gairmet*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY),
    });
  });
  await page.route("**/awc_aviation_weather/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPTY),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the hazard areas and refuses to be a flight plan", async ({
  page,
}) => {
  await stubAviation(page);
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    // This layer's four products only. The surface observations layer is on
    // the same host and its own request is not one of these.
    if (
      url.includes("/api/data/airsigmet") ||
      url.includes("/api/data/gairmet") ||
      url.includes("awc_aviation_weather")
    ) {
      asked.push(url);
    }
  });
  await page.goto("/?testMode=1&lon=-94.5&lat=40.5&zoom=6&bearing=0&pitch=0");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".toggle-row")
    .filter({ hasText: "Aviation Hazards" })
    .getByRole("checkbox")
    .check();

  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  await page.keyboard.press("Escape");

  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("CONVECTIVE");
  // The valid window and the altitude the forecaster drew it to.
  await expect(popup).toContainText("Valid");
  await expect(popup).toContainText("34,000 ft");
  // The line the acceptance asks for, on the popup rather than in a note
  // somebody has to go and find.
  await expect(popup).toContainText(/not for flight planning/i);

  // Four requests, one per product, and none of them says where the reader is
  // looking: the rate limit is one a minute per product and this is a fifth
  // of that.
  expect(asked).toHaveLength(4);
  expect(asked.some((url) => url.includes("bbox"))).toBe(false);
});

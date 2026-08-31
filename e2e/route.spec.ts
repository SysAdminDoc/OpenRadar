import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

const unexpectedExternalRequests = new WeakMap<Page, string[]>();

const place = (name: string, lat: number, lon: number) =>
  JSON.stringify({
    results: [{ id: 1, name, latitude: lat, longitude: lon, country: "US" }],
  });

test.beforeEach(async ({ page }) => {
  const unexpectedRequests: string[] = [];
  unexpectedExternalRequests.set(page, unexpectedRequests);
  await page.route("https://**/*", async (route) => {
    unexpectedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });

  await routeWorkspace(page);

  await page.route("https://api.weather.gov/alerts/**", async (route) => {
    await route.fulfill({
      contentType: "application/geo+json",
      body: JSON.stringify({ features: [] }),
    });
  });

  await page.route("https://geocoding-api.open-meteo.com/**", async (route) => {
    const name = new URL(route.request().url()).searchParams.get("name") ?? "";
    await route.fulfill({
      contentType: "application/json",
      body: name.startsWith("D")
        ? place("Dallas", 32.78, -96.8)
        : place("Houston", 29.76, -95.37),
    });
  });

  await page.route("https://valhalla1.openstreetmap.de/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        trip: {
          status: 0,
          units: "miles",
          summary: { length: 239, time: 14400 },
          legs: [{ shape: "_o}p}@~neswD~nyo@_oyo@~zgeC_{rc@" }],
        },
      }),
    });
  });

  await page.route("https://api.open-meteo.com/**", async (route) => {
    const points = (
      new URL(route.request().url()).searchParams.get("latitude") ?? ""
    ).split(",").length;
    const hourly = {
      time: [
        "2026-08-30T12:00",
        "2026-08-30T13:00",
        "2026-08-30T14:00",
        "2026-08-30T15:00",
        "2026-08-30T16:00",
      ],
      temperature_2m: [80, 84, 88, 90, 92],
      precipitation_probability: [5, 20, 55, 90, 90],
      weather_code: [1, 1, 61, 95, 95],
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.from({ length: points }, () => ({ hourly }))),
    });
  });

  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(unexpectedExternalRequests.get(page) ?? []).toEqual([]);
});

test("plans a drive and draws it coloured by the chance of rain", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Route", exact: true }).click();
  await page.getByLabel("Start").fill("Dallas");
  await page.getByLabel("Destination").fill("Houston");
  // Eight in the morning in New York is noon UTC, where the fixture series
  // starts, so the far end of the drive lands in its rainy hours.
  await page.getByLabel("Leaving").fill("2026-08-30T08:00");
  await page.getByRole("button", { name: /Plan the drive/ }).click();

  await expect(page.getByText(/Dallas to Houston/)).toBeVisible();
  const rows = page.locator(".route-row");
  await expect(rows.first()).toContainText("0 mi");
  expect(await rows.count()).toBeGreaterThan(2);
  // The far end of the drive lands in the rainy hours of the series.
  await expect(rows.last()).toContainText("90%");

  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-route-line/,
  );

  await page.getByRole("button", { name: "Close Route" }).click();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /openradar-route-line/,
  );
});

test("offers the straight line when the road router refuses", async ({
  page,
}) => {
  // The public router promises no uptime, and the weather along the way does not
  // depend on which road you take, so a refusal is not the end of the question.
  await page.route("https://valhalla1.openstreetmap.de/**", async (route) => {
    await route.fulfill({ status: 429, body: "slow down" });
  });

  await page.getByRole("button", { name: "Route", exact: true }).click();
  await page.getByLabel("Start").fill("Dallas");
  await page.getByLabel("Destination").fill("Houston");
  await page.getByRole("button", { name: "Plan the drive" }).click();

  const failure = page.locator(".panel-error");
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("429");

  await failure.getByRole("button", { name: "Use a straight line" }).click();

  // The drive is planned, and the panel says what it is looking at.
  await expect(
    page.getByText(/straight line between the two places/i),
  ).toBeVisible();
  await expect(page.locator(".route-row").first()).toBeVisible();
});

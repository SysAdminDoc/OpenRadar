import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { routeWorkspace } from "./support/fixtures";
import { openSurface } from "./support/surfaces";

/**
 * The Forecast panel with a forecast in it.
 *
 * Nothing in the suite ever stubbed one, so every scan of this surface was a
 * scan of the line that says it is unavailable: the rows, the day headings,
 * the temperature ranges and the chance-of-rain figures had never been read
 * by anything.
 */

/** Seven days from the service the panel actually reads. */
function sevenDays() {
  const day = 24 * 60 * 60 * 1000;
  const from = Date.UTC(2026, 8, 3);
  const dates = Array.from({ length: 7 }, (_, at) =>
    new Date(from + at * day).toISOString().slice(0, 10),
  );
  return {
    current: {
      temperature_2m: 24.4,
      apparent_temperature: 26.1,
      precipitation: 0.4,
      weather_code: 61,
      wind_speed_10m: 12.5,
    },
    daily: {
      time: dates,
      weather_code: [61, 3, 95, 0, 45, 71, 2],
      temperature_2m_max: [27.1, 29.4, 31.2, 30.0, 21.6, 2.2, 18.9],
      temperature_2m_min: [18.3, 19.1, 21.7, 20.4, 12.9, -3.1, 9.8],
      precipitation_probability_max: [80, 20, 95, 0, 45, 60, 15],
    },
  };
}

async function openForecast(page: Page) {
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(sevenDays()),
    });
  });
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await openSurface(page, "forecast");
  const panel = page.getByRole("dialog", { name: "Forecast" });
  // A day with a real range in it, so the scan below is over rows rather
  // than over the "unavailable" line this panel used to be scanned in.
  await expect(panel).toContainText("95%");
  return panel;
}

test("draws the week, and is clean reading it", async ({ page }) => {
  const panel = await openForecast(page);
  await expect(panel).not.toContainText("unavailable");
  await expectClean(page, "the forecast panel with a week in it");
});

test("is clean in the light theme too", async ({ page }) => {
  await openForecast(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await openSurface(page, "forecast");
  await expectClean(page, "the forecast panel in light");
});

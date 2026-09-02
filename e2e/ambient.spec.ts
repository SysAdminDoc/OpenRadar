import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * The weather where the reader watches, drawn on the chrome.
 *
 * Two things are worth holding here rather than in a unit test: that it is
 * driven by what a station actually reported, and that there is no way for it
 * to reach the map. The second is the one that matters, so it is measured
 * rather than asserted about a class name.
 */
const HOME: [number, number] = [-96.8, 32.78];

function station(raw: string, minutesAgo: number) {
  return [
    {
      icaoId: "KAMB",
      obsTime: Math.floor(Date.now() / 1000) - minutesAgo * 60,
      temp: 12,
      dewp: 11,
      wdir: 180,
      wspd: 8,
      wgst: null,
      rawOb: raw,
      lat: HOME[1],
      lon: HOME[0],
      name: "Ambient Test Field, TX, US",
      cover: "OVC",
      fltCat: "MVFR",
    },
  ];
}

async function start(page: Page, rows: unknown, ambient = true) {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        ambient: value,
        watch: {
          enabled: true,
          sound: false,
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      }),
    );
  }, ambient);
  await routeWorkspace(page);
  await stubHost(page, "https://aviationweather.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

test("draws what the nearest station is reporting, and only on the chrome", async ({
  page,
}) => {
  await start(
    page,
    station("KAMB 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989", 5),
  );
  await expect(page.locator("html")).toHaveAttribute("data-ambient", "rain");

  // The measurement that matters: whatever the effect is painted on, its box
  // must not reach the map. The command bar and the map stage share an edge
  // and nothing more.
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector(".command-bar")?.getBoundingClientRect();
    const map = document
      .querySelector(".maplibregl-canvas")
      ?.getBoundingClientRect();
    if (!bar || !map) return null;
    const across =
      Math.min(bar.right, map.right) - Math.max(bar.left, map.left);
    const down = Math.min(bar.bottom, map.bottom) - Math.max(bar.top, map.top);
    return Math.max(0, across) * Math.max(0, down);
  });
  expect(overlap).toBe(0);

  // And the bar's own colour is untouched: the effect is a background image
  // over it rather than instead of it.
  const painted = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".command-bar")!);
    return {
      image: style.backgroundImage,
      colour: style.backgroundColor,
    };
  });
  expect(painted.image).toContain("gradient");
  expect(painted.colour).not.toBe("rgba(0, 0, 0, 0)");
});

test("says nothing when the station says nothing", async ({ page }) => {
  await start(page, station("KAMB 021253Z 18008KT 10SM FEW040 21/09 A3001", 5));
  await expect(page.locator("html")).not.toHaveAttribute("data-ambient", /./);
});

test("stops rather than drawing a report too old to speak for now", async ({
  page,
}) => {
  await start(
    page,
    station("KAMB 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989", 200),
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-ambient", /./);
});

test("is off until it is asked for", async ({ page }) => {
  await start(
    page,
    station("KAMB 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989", 5),
    false,
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-ambient", /./);
  // And one switch is all it takes, in either direction.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Weather on the chrome" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-ambient", "rain");
  await page.getByRole("checkbox", { name: "Weather on the chrome" }).uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-ambient", /./);
});

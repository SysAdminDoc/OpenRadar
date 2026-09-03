import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * A place where the weather made history, found by going there.
 *
 * What is worth holding in the real workspace: that nothing marks one on the
 * map, that going to the place finds it and going back does not find it
 * again, that finding one is a card and never a toast, and that nothing
 * appears while a warning is in force where the reader watches.
 *
 * The camera is moved the way a reader moves it, through the place search,
 * rather than through a handle put on the window for the test. A hook that
 * exists only for testing proves the hook works.
 */

/** Mount Washington, which is in the set that ships with the app. */
const SUMMIT: [number, number] = [-71.3033, 44.2706];
const HOME: [number, number] = [-96.8, 32.78];

function place(name: string, [lon, lat]: [number, number], id: number) {
  return {
    id,
    name,
    latitude: lat,
    longitude: lon,
    country: "United States",
    admin1: "Somewhere",
  };
}

async function start(page: Page, options: { warning?: boolean } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        catchUp: false,
        curiosities: true,
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
    "https://geocoding-api.open-meteo.com/**",
    async (route) => {
      const query =
        new URL(route.request().url()).searchParams.get("name") ?? "";
      const results = /summit/i.test(query)
        ? [place("The Summit", SUMMIT, 1)]
        : [place("Back Home", HOME, 2)];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results }),
      });
    },
  );
  await stubHost(
    page,
    "https://mapservices.weather.noaa.gov/**",
    async (route) => {
      const [lon, lat] = HOME;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: options.warning
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

/** Goes somewhere the way a reader does: search, then choose the result. */
async function goTo(page: Page, query: string, name: string) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("textbox").fill(query);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  // Choosing a result closes the panel and flies the map. Waiting on that
  // rather than on nothing is what makes "the card did not appear" mean
  // something: without it, a search that never worked passes every test
  // below that asserts an absence.
  await expect(page.getByRole("heading", { name: "Search" })).toHaveCount(0);
  await expect(page.getByRole("application")).toBeVisible();
}

test("nothing marks one on the map", async ({ page }) => {
  await start(page);
  // The only way to reach one is to have gone and looked at that part of the
  // world. A marker sitting there waiting to be clicked would be a different
  // feature entirely.
  await expect(page.locator("[data-curiosity]")).toHaveCount(0);
});

test("finds one by going there, once", async ({ page }) => {
  await start(page);
  await goTo(page, "summit", "The Summit");

  const card = page.locator("[data-curiosity]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Mount Washington");
  // Who says so, and where to read it.
  await expect(card.locator("a")).toHaveAttribute("href", /mountwashington/);
  await expectClean(page, "curiosity card");
  // A card, and nothing else: nothing was announced beside it.
  await expect(page.locator("[data-toast]")).toHaveCount(0);

  await card.getByRole("button").click();
  await expect(card).toHaveCount(0);

  // Away and back again. A place that announced itself every time the map
  // passed over it would be a notification about the app.
  await goTo(page, "home", "Back Home");
  await goTo(page, "summit", "The Summit");
  await expect(page.locator("[data-curiosity]")).toHaveCount(0);
});

test("stays quiet while a warning is in force where you watch", async ({
  page,
}) => {
  await start(page, { warning: true });
  // The positive control: the warning really did land, so this is a test
  // about suppression rather than a test that nothing loaded.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await goTo(page, "summit", "The Summit");
  // A map with a warning on it is a serious instrument, and a card about a
  // measurement taken in 1934 can wait.
  await expect(page.locator("[data-curiosity]")).toHaveCount(0);
});

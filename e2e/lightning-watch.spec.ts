import { expect, test } from "@playwright/test";
import { fakeDesktop, routeWorkspace } from "./support/fixtures";

/**
 * Lightning near a place somebody watches.
 *
 * Only the desktop reads flashes, so this is one of the specs that fakes the
 * native side. What it plants is the thing the rule turns on: flashes inside
 * the radius and flashes outside it, at the same moment, so a rule that
 * counted the whole national window would say the same thing either way.
 */
async function openWith(
  page: Parameters<typeof routeWorkspace>[0],
  options: { inside: number[]; outside: number[]; radius?: number },
) {
  await page.addInitScript(
    (value: { inside: number[]; outside: number[]; radius: number }) => {
      const now = Date.now();
      const settings = {
        schemaVersion: 3,
        watch: {
          enabled: true,
          center: [-93.6, 41.6],
          radiusMiles: 25,
          minSeverity: "severe",
          sound: false,
        },
        layers: { lightningFlashes: true },
        lightningWatch: {
          enabled: true,
          radiusMiles: value.radius,
          count: 1,
          sound: false,
        },
      };
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify(settings),
      );
      (window as unknown as { __settings: unknown }).__settings = settings;
      const flashes = [...value.inside, ...value.outside].map((miles) => ({
        latitude: 41.6 + miles / 69,
        longitude: -93.6,
        energyJoules: 1,
        areaSquareKm: 10,
        time: now / 1000,
      }));
      (
        window as unknown as {
          __answer: (command: string) => [unknown] | undefined;
        }
      ).__answer = (command: string) => {
        if (command === "lightning_flashes") {
          return [
            {
              satellite: "GOES-19",
              windowMinutes: 5,
              observed: Math.floor(now / 1000),
              flashes,
              trimmed: false,
              filesRead: 5,
              filesExpected: 5,
            },
          ];
        }
        return undefined;
      };
    },
    {
      inside: options.inside,
      outside: options.outside,
      radius: options.radius ?? 10,
    },
  );
  await fakeDesktop(page, { settingsFromPage: true });
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

test("says so when flashes fall inside the radius", async ({ page }) => {
  await openWith(page, { inside: [2, 6], outside: [40] });
  // Scoped to the one this spec is about: the workspace shows a welcome
  // hint on a first launch and a toast count would be counting that.
  const toast = page.locator(".toast", { hasText: "Lightning near" });
  await expect(toast).toBeVisible();
  // Two, not three: the one forty miles out is in the same national window
  // and is not near this place.
  await expect(toast).toContainText("2 flashes within 10 miles");
  // And what these flashes are, which is the thing a reader must not take
  // for a report of what reached the ground.
  await expect(toast).toContainText("not a report of what reached the ground");
});

test("says nothing when every flash is outside the radius", async ({
  page,
}) => {
  // The same national window, the same storm, a different place. A rule that
  // counted the window rather than the radius would say the same thing here.
  await openWith(page, { inside: [], outside: [30, 45, 60] });
  await expect(
    page.locator(".toast", { hasText: "Lightning near" }),
  ).toHaveCount(0);
  // And the workspace is up rather than having fallen over quietly.
  await expect(page.getByRole("application")).toBeVisible();
});

test("is off until it is asked for", async ({ page }) => {
  await page.addInitScript(() => {
    const settings = {
      schemaVersion: 3,
      watch: {
        enabled: true,
        center: [-93.6, 41.6],
        radiusMiles: 25,
        minSeverity: "severe",
        sound: false,
      },
      layers: { lightningFlashes: true },
    };
    window.localStorage.setItem("openradar.settings", JSON.stringify(settings));
    (window as unknown as { __settings: unknown }).__settings = settings;
    const now = Date.now();
    (
      window as unknown as {
        __answer: (command: string) => [unknown] | undefined;
      }
    ).__answer = (command: string) => {
      if (command === "lightning_flashes") {
        return [
          {
            satellite: "GOES-19",
            windowMinutes: 5,
            observed: Math.floor(now / 1000),
            flashes: [
              {
                latitude: 41.61,
                longitude: -93.6,
                energyJoules: 1,
                areaSquareKm: 10,
                time: now / 1000,
              },
            ],
            trimmed: false,
            filesRead: 5,
            filesExpected: 5,
          },
        ];
      }
      return undefined;
    };
  });
  await fakeDesktop(page, { settingsFromPage: true });
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
  // A flash right on top of the watched place, and nothing said, because
  // nobody asked to be told.
  await expect(
    page.locator(".toast", { hasText: "Lightning near" }),
  ).toHaveCount(0);
});

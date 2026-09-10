import { expect } from "@playwright/test";
import { fakeDesktop, routeWorkspace, test } from "./support/fixtures";

/**
 * A rule set on a number the network publishes, near a place somebody watches.
 *
 * Only the desktop decodes the grids, so this fakes the native side and
 * plants the one thing the rule turns on: what the strongest cell within the
 * radius reads. The grid itself never crosses into the browser, which is why
 * the command answers a number rather than a raster.
 */
async function openWith(
  page: Parameters<typeof routeWorkspace>[0],
  options: {
    /** Millimetres, the unit the hail grid is published in. */
    hailMm: number | null;
    /** Inches, the size the rule is set to. */
    size?: number;
    enabled?: boolean;
  },
) {
  await page.addInitScript(
    (value: { hailMm: number | null; size: number; enabled: boolean }) => {
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
        hailWatch: {
          enabled: value.enabled,
          radiusMiles: 10,
          threshold: value.size,
          sound: false,
        },
      };
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify(settings),
      );
      (window as unknown as { __settings: unknown }).__settings = settings;
      const asked: string[] = [];
      (window as unknown as { __gridAsked: string[] }).__gridAsked = asked;
      (
        window as unknown as {
          __answer: (
            command: string,
            args?: Record<string, unknown>,
          ) => [unknown] | undefined;
        }
      ).__answer = (command: string, args?: Record<string, unknown>) => {
        if (command !== "mrms_peak_near") return undefined;
        asked.push(JSON.stringify(args ?? {}));
        // Null is the network having seen none of the circle, which is not
        // the same as a reading of nothing and must not announce either way.
        if (value.hailMm === null) return [null];
        return [
          { value: value.hailMm, time: Math.floor(now / 1000), miles: 4.2 },
        ];
      };
    },
    {
      hailMm: options.hailMm,
      size: options.size ?? 1,
      enabled: options.enabled ?? true,
    },
  );
  await fakeDesktop(page, { settingsFromPage: true });
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

test("says once when the estimate first meets the size the reader set", async ({
  page,
}) => {
  // An inch and a half of hail against a rule set at an inch. 38.1 mm is
  // exactly an inch and a half, which is what says the millimetres the grid
  // publishes are read into the inches the rule is written in: compared
  // without the conversion, 38.1 would clear every size the panel offers.
  await openWith(page, { hailMm: 38.1, size: 1 });
  const toast = page.locator(".toast", { hasText: "Hail estimated" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("1.50");
  // What the number is, on the notice itself rather than in a panel somebody
  // has to go and open.
  await expect(toast).toContainText(/not a report of hail on the ground/i);

  // And the question carries the place and the radius, and nothing about
  // where the map is looking.
  const asked = await page.evaluate(
    () => (window as unknown as { __gridAsked: string[] }).__gridAsked,
  );
  expect(asked.length).toBeGreaterThan(0);
  const first = JSON.parse(asked[0]) as Record<string, unknown>;
  expect(first.product).toBe("mesh");
  expect(first.latitude).toBeCloseTo(41.6, 3);
  expect(first.longitude).toBeCloseTo(-93.6, 3);
  expect(first.radiusMiles).toBe(10);
  // And which of the five national grids covers the place, because they do
  // not overlap and CONUS has no rows over San Juan or Anchorage.
  expect(first.domain).toBe("CONUS");
});

test("is silent when the estimate is under the size", async ({ page }) => {
  // Twenty millimetres is about four fifths of an inch, under a rule set at
  // an inch. The grid answered, so this is the rule deciding rather than the
  // service failing.
  await openWith(page, { hailMm: 20, size: 1 });
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            () => (window as unknown as { __gridAsked: string[] }).__gridAsked,
          )
        ).length,
    )
    .toBeGreaterThan(0);
  await expect(
    page.locator(".toast", { hasText: "Hail estimated" }),
  ).toHaveCount(0);
});

test("says nothing where the network saw none of the circle", async ({
  page,
}) => {
  // No coverage is not an estimate of no hail. Announced on, it would say
  // clear air where nothing was measured at all.
  await openWith(page, { hailMm: null, size: 1 });
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(
            () => (window as unknown as { __gridAsked: string[] }).__gridAsked,
          )
        ).length,
    )
    .toBeGreaterThan(0);
  await expect(
    page.locator(".toast", { hasText: "Hail estimated" }),
  ).toHaveCount(0);
});

test("asks for nothing at all until the rule is switched on", async ({
  page,
}) => {
  // Off until asked for, like every other notice that is not a warning, and
  // off means it does not talk to the network either.
  await openWith(page, { hailMm: 50, size: 1, enabled: false });
  await page.waitForTimeout(1500);
  const asked = await page.evaluate(
    () => (window as unknown as { __gridAsked: string[] }).__gridAsked,
  );
  expect(asked).toEqual([]);
  await expect(
    page.locator(".toast", { hasText: "Hail estimated" }),
  ).toHaveCount(0);
});

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
    /** A second watched place, for the rules that poll every one of them. */
    alsoAt?: [number, number];
  },
) {
  await page.addInitScript(
    (value: {
      hailMm: number | null;
      size: number;
      enabled: boolean;
      alsoAt: [number, number] | null;
    }) => {
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
        watchPlaces: value.alsoAt
          ? [
              {
                id: "cabin",
                name: "The cabin",
                enabled: true,
                center: value.alsoAt,
                radiusMiles: 25,
                minSeverity: "severe",
                sound: false,
              },
            ]
          : [],
      };
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify(settings),
      );
      (window as unknown as { __settings: unknown }).__settings = settings;
      const asked: string[] = [];
      (window as unknown as { __gridAsked: string[] }).__gridAsked = asked;
      (window as unknown as { __framesAsked: string[] }).__framesAsked = [];
      (
        window as unknown as {
          __answer: (
            command: string,
            args?: Record<string, unknown>,
          ) => [unknown] | undefined;
        }
      ).__answer = (command: string, args?: Record<string, unknown>) => {
        // Which grids the network publishes where the reader watches. The
        // panel asks the bucket rather than reading a table, because MRMS
        // publishes no shear at all for some regions.
        if (command === "mrms_frames") {
          const domain = String(args?.domain ?? "CONUS");
          (window as unknown as { __framesAsked: string[] }).__framesAsked.push(
            domain,
          );
          const published = (
            window as unknown as {
              __gridPublished?: boolean | Record<string, boolean>;
            }
          ).__gridPublished;
          const has =
            typeof published === "object" && published !== null
              ? published[domain] !== false
              : published !== false;
          return [has ? [{ time: 1_756_000_000, key: "k" }] : []];
        }
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
      alsoAt: options.alsoAt ?? null,
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

test("says so where the network publishes no grid for a rule", async ({
  page,
}) => {
  // MRMS has no merged azimuthal shear product for Alaska at all, so a
  // rotation rule set at Anchorage asked for frames that do not exist,
  // failed, and recorded nothing every two minutes forever while the switch
  // sat on looking like it worked.
  await page.addInitScript(() => {
    (window as unknown as { __gridPublished: boolean }).__gridPublished = false;
  });
  await openWith(page, { hailMm: null, size: 1, enabled: true });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rotation = page.locator('[data-grid-watch="rotation"]');
  await expect(rotation).toContainText("does not publish this grid");
});

test("asks about every watched place, not only the first", async ({ page }) => {
  // The rule polls every enabled place, each against the national grid that
  // covers it. Asking about home alone said nothing was wrong for a reader
  // whose second place is in a region that publishes no shear at all.
  await page.addInitScript(() => {
    (
      window as unknown as { __gridPublished: Record<string, boolean> }
    ).__gridPublished = { CONUS: true, ALASKA: false };
  });
  await openWith(page, {
    hailMm: null,
    size: 1,
    enabled: true,
    // Anchorage, in a region the network publishes no shear for at all.
    alsoAt: [-149.9, 61.22],
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator('[data-grid-watch="rotation"]')).toContainText(
    "does not publish this grid",
  );
  // And the regions it actually asked about, which is both rather than home.
  const regions = await page.evaluate(
    () => (window as unknown as { __framesAsked: string[] }).__framesAsked,
  );
  expect([...new Set(regions)].sort()).toEqual(["ALASKA", "CONUS"]);
});

test("says nothing about the grid where the network does publish it", async ({
  page,
}) => {
  // The control. Without it the line above passes just as well on a panel
  // that says the same thing everywhere.
  await openWith(page, { hailMm: null, size: 1, enabled: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const rotation = page.locator('[data-grid-watch="rotation"]');
  await expect(rotation).not.toContainText("does not publish this grid");
});

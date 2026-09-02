import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * The workspace as something to leave on a second monitor.
 *
 * What is worth holding in the real workspace: that it fills the window and
 * keeps the time, the place and the source on screen; that it is entered
 * deliberately and never on its own by default; that a warning where the
 * reader watches takes it down; and that leaving it puts everything back.
 */

const HOME: [number, number] = [-96.8, 32.78];

async function start(page: Page, warning = false) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        catchUp: false,
        curiosities: false,
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
    "https://mapservices.weather.noaa.gov/**",
    async (route) => {
      const [lon, lat] = HOME;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: warning
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

async function enter(page: Page) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="ambient-screen"]').click();
}

test("is entered deliberately and never on its own", async ({ page }) => {
  await start(page);
  // Nothing has taken the workspace over: the default is never.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();

  await enter(page);
  const readout = page.locator("[data-ambient-readout]");
  await expect(readout).toBeVisible();
  // The time, the place, and what the map is showing.
  await expect(readout).toContainText("Casa");
  await expect(readout).toContainText(/\d/);
  // And nothing else: the chrome is gone.
  await expect(page.locator(".command-bar")).toBeHidden();
});

test("puts the workspace back without rebuilding it", async ({ page }) => {
  await start(page);
  // A mark on the map element itself. Nothing is unmounted by this mode, so
  // the same node has to come back: a remounted map is a new WebGL context,
  // a refetched loop and a lost camera.
  await page.evaluate(() => {
    document
      .querySelector('[role="application"]')
      ?.setAttribute("data-was-here", "1");
  });

  await enter(page);
  await expect(page.locator("[data-ambient-readout]")).toBeVisible();
  await expect(page.locator(".command-bar")).toBeHidden();

  // The way out is on the readout itself: the command bar it was reached
  // from is one of the things the mode hides, and this project has no
  // keyboard shortcuts.
  await page
    .getByRole("button", { name: "Leave the full-screen view" })
    .click();

  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
  await expect(page.locator('[role="application"]')).toHaveAttribute(
    "data-was-here",
    "1",
  );
});

test("stands aside for a warning where you watch", async ({ page }) => {
  await start(page, true);
  // The positive control: the warning really did land.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await enter(page);
  // The whole point of the app is the thing that just happened, and a second
  // monitor showing a clean loop through it hides the app's reason to exist.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
});

test("the second-monitor setting reads like the switches above it", async ({
  page,
}) => {
  // `.settings-field` had no rule in the stylesheet at all, so this setting's
  // title rendered inline at 16px beside its detail at 13px in one run-on
  // paragraph, under a run of switches whose titles are 12px with the detail
  // on its own line at 10px. It was the one part of Settings that looked
  // unfinished.
  await start(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const setting = page.locator("[data-ambient-screen-setting]");
  await setting.scrollIntoViewIfNeeded();
  await expect(setting).toBeVisible();

  // Measured against the switches it actually sits under, and on every
  // figure that was wrong rather than only the two easy ones. The first pass
  // mirrored the bare `.toggle-row`, but every switch in this panel is a
  // `.toggle-row--plain` inside a `.surface-panel`, and both add overrides:
  // the block came out indented four pixels past every switch, its detail a
  // point smaller with the wrong line height, and it was the only row in the
  // panel with no rule under it. The old assertions passed over all three.
  const shape = await setting.evaluate((node) => {
    const row = node.parentElement!.querySelector(".toggle-row")!;
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        size: style.fontSize,
        leading: style.lineHeight,
        display: style.display,
      };
    };
    const box = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        // The title's own edge, not the block's: padding moves the words and
        // leaves the container where it was, so measuring the container said
        // nothing about the four pixels this got wrong.
        left: element.querySelector("strong")!.getBoundingClientRect().left,
        rule: `${style.borderBottomWidth} ${style.borderBottomColor}`,
      };
    };
    return {
      title: read(node.querySelector("strong")!),
      detail: read(node.querySelector("small")!),
      rowTitle: read(row.querySelector("strong")!),
      rowDetail: read(row.querySelector("small")!),
      field: box(node),
      row: box(row),
    };
  });
  expect(shape.title.size).toBe(shape.rowTitle.size);
  expect(shape.detail.display).toBe("block");
  expect(shape.detail.size).toBe(shape.rowDetail.size);
  expect(shape.detail.leading).toBe(shape.rowDetail.leading);
  expect(shape.field.left).toBe(shape.row.left);
  expect(shape.field.rule).toBe(shape.row.rule);
});

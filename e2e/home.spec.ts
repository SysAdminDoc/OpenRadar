import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

/**
 * A place the reader named, and one action back to it.
 *
 * The watch has always been a coordinate pair with a radius. What makes it a
 * workspace rather than a viewer is that it can be called something, and that
 * getting back to it from the far side of the globe is one press.
 */
const HOME: [number, number] = [-96.8, 32.78];

async function start(
  page: Page,
  watch: Record<string, unknown> = {},
  view = "",
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        watch: {
          enabled: true,
          sound: false,
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
          ...(value as Record<string, unknown>),
        },
      }),
    );
  }, watch);
  await routeWorkspace(page);
  await page.goto(`/?testMode=1${view}`);
  await expect(page.getByRole("application")).toBeVisible();
}

function camera(page: Page) {
  return page.getByRole("application").first().getAttribute("data-camera");
}

async function runHome(page: Page) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="home"]').click();
}

test("comes home from the other side of the world in one action", async ({
  page,
}) => {
  // Opened over Perth, a hundred and fifty degrees of the globe from home.
  // This used to get away from home with six presses of the left arrow, and
  // since the arrows moved a readout cursor instead of the camera, six presses
  // from the middle of the map never reach the edge that pans it: the camera
  // stayed where it was and the test stopped there.
  //
  // Not the antipode itself, which has a test of its own below.
  await start(page, {}, "&lon=115.86&lat=-31.95&zoom=3&bearing=0&pitch=0");
  // The globe is the case worth covering: a camera on the far side of it is
  // the longest way home.
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await camera(page))?.split(",").slice(0, 2).join(","))
    .toBe("115.86000,-31.95000");

  await runHome(page);
  await expect
    .poll(async () => (await camera(page))?.split(",").slice(0, 2).join(","))
    .toBe(`${HOME[0].toFixed(5)},${HOME[1].toFixed(5)}`);

  // The projection is the reader's choice and coming home is not an opinion
  // about it, so the globe is still the globe.
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();
});

test("comes home from the exact far side of the world", async ({ page }) => {
  // The antipode itself. A flight to the exact opposite point has no one
  // great circle to follow, and MapLibre's globe answered it with a
  // projection matrix it could not invert, throwing on every frame with the
  // camera stuck. The flight is skipped there and the camera goes straight
  // home.
  await start(page, {}, "&lon=83.2&lat=-32.78&zoom=3&bearing=0&pitch=0");
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();
  await runHome(page);
  await expect
    .poll(async () => (await camera(page))?.split(",").slice(0, 2).join(","))
    .toBe(`${HOME[0].toFixed(5)},${HOME[1].toFixed(5)}`);
});

test("says what the reader calls home, in the watch and in an alert", async ({
  page,
}) => {
  await start(page, { name: "Casa" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("What you call home")).toHaveValue("Casa");
});

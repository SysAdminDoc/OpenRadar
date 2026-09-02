import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * A place the reader named, and one action back to it.
 *
 * The watch has always been a coordinate pair with a radius. What makes it a
 * workspace rather than a viewer is that it can be called something, and that
 * getting back to it from the far side of the globe is one press.
 */
const HOME: [number, number] = [-96.8, 32.78];

async function start(page: Page, watch: Record<string, unknown> = {}) {
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
  await page.goto("/?testMode=1");
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
  await start(page);
  // The globe is the case worth covering: a camera on the far side of it is
  // as far from home as the app can put somebody.
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();

  const pane = page.getByRole("application").first();
  await pane.click({ position: { x: 60, y: 60 } });
  const before = await camera(page);
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await expect.poll(() => camera(page)).not.toBe(before);

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

test("says what the reader calls home, in the watch and in an alert", async ({
  page,
}) => {
  await start(page, { name: "Casa" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("What you call home")).toHaveValue("Casa");
});

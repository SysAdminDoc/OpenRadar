import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

const NEWEST = 1788083202;

/**
 * Both lightning products are decoded natively: the density grid through the
 * MRMS tile scheme, the flashes through a command. What is being tested here
 * is what reaches the map and what the legend says about it, including that it
 * does not pass itself off as a warning.
 */
async function fakeNativeSide(page: Page) {
  await page.addInitScript(
    ({ newest }: { newest: number }) => {
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: (path: string, scheme: string) =>
          `http://${scheme}.localhost/${path}`,
        invoke: (command: string, args: Record<string, unknown>) => {
          if (command === "mrms_products") {
            return Promise.resolve([
              {
                id: "composite",
                label: "MRMS composite",
                unit: "dBZ",
                floor: 5,
                stops: [[5, "#04e9e7"]],
              },
              {
                id: "lightning",
                label: "Cloud-to-ground lightning, 5 min",
                unit: "flashes/km2/min",
                floor: 0.01,
                stops: [
                  [0.01, "#38bdf8"],
                  [2, "#f43f5e"],
                ],
              },
            ]);
          }
          if (command === "mrms_frames") {
            const limit = Number(args.limit);
            return Promise.resolve(
              Array.from({ length: limit }, (_, index) => ({
                time: newest - (limit - 1 - index) * 120,
                key: `CONUS/x/${newest}`,
              })),
            );
          }
          if (command === "lightning_flashes") {
            return Promise.resolve({
              satellite: "GOES-19 East",
              windowMinutes: 5,
              observed: Math.floor(Date.now() / 1000),
              trimmed: false,
              flashes: [
                {
                  latitude: 27.5,
                  longitude: -83.5,
                  energyJoules: 1,
                  areaSquareKm: 100,
                  time: Math.floor(Date.now() / 1000),
                },
                {
                  latitude: 27.6,
                  longitude: -83.4,
                  energyJoules: 2,
                  areaSquareKm: 120,
                  time: Math.floor(Date.now() / 1000) - 120,
                },
              ],
            });
          }
          if (command.startsWith("plugin:store|")) return Promise.resolve(null);
          return Promise.reject(new Error(`${command} is not stubbed`));
        },
        transformCallback: (callback: unknown) => callback,
      };
    },
    { newest: NEWEST },
  );
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await fakeNativeSide(page);
  await page.route("http://mrms.localhost/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("draws the cloud-to-ground density grid with its own scale", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Lightning Density/ }).check();

  await expect(pane).toHaveAttribute("data-layer-stack", /mrms-lightning/);
  await expect(
    page.getByText("Cloud-to-ground lightning, 5 min (flashes/km2/min)"),
  ).toBeVisible();
  // This is the layer that matters to anyone standing outside, and it must
  // not pass for a warning on its own.
  await expect(
    page.getByText(/Where flashes were, not where the next one will be/),
  ).toBeVisible();
  await expect(
    page.getByText(/Use official warnings for life-safety decisions/),
  ).toBeVisible();
});

test("draws the satellite flashes and says what they are not", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Lightning Flashes/ }).check();

  await expect(pane).toHaveAttribute("data-layer-stack", /flash-points/);
  await expect(page.getByText(/2 from GOES-19 East/)).toBeVisible();
  // The one thing this layer must never be taken for.
  await expect(
    page.getByText(/Total lightning, not a strike report/),
  ).toBeVisible();
  await expect(
    page.getByText(/Use official warnings for life-safety decisions/),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: /Lightning Flashes/ }).uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /flash-points/);
});

test("keeps the flashes above the radar and under the warnings", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Lightning Density/ }).check();
  await page.getByRole("checkbox", { name: /Lightning Flashes/ }).check();
  await expect(pane).toHaveAttribute("data-layer-stack", /flash-points/);

  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  expect(stack.indexOf("openradar-mrms-lightning")).toBeLessThan(
    stack.indexOf("openradar-flash-points"),
  );
  expect(stack.indexOf("openradar-flash-points")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );
});

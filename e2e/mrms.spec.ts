import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

const NEWEST = 1788083202;
const PRODUCTS = [
  {
    id: "composite",
    label: "MRMS composite",
    unit: "dBZ",
    floor: 5,
    stops: [
      [5, "#04e9e7"],
      [50, "#fd0000"],
      [75, "#fdfdfd"],
    ],
  },
  {
    id: "rotation",
    label: "Rotation tracks, past hour",
    unit: "1/s",
    floor: 0.002,
    stops: [
      [0.002, "#38bdf8"],
      [0.01, "#f43f5e"],
    ],
  },
  {
    id: "mesh",
    label: "Maximum estimated hail size",
    unit: "mm",
    floor: 6,
    stops: [
      [6, "#38bdf8"],
      [70, "#f43f5e"],
    ],
  },
];

/**
 * MRMS grids are decoded natively and served to the map over a local scheme,
 * so a browser needs both halves stood in for: the commands that list what has
 * been published, and the scheme the tiles come back on.
 */
async function fakeNativeSide(page: Page) {
  await page.addInitScript(
    ({ newest, products }: { newest: number; products: unknown }) => {
      const calls: Array<{ command: string; args: unknown }> = [];
      (window as unknown as { __mrmsCalls: typeof calls }).__mrmsCalls = calls;
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        // Windows spells a custom scheme this way, which is the platform the
        // app is built on.
        convertFileSrc: (path: string, scheme: string) =>
          `http://${scheme}.localhost/${path}`,
        invoke: (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "mrms_products") return Promise.resolve(products);
          if (command === "mrms_frames") {
            const limit = Number(args.limit);
            return Promise.resolve(
              Array.from({ length: limit }, (_, index) => ({
                time: newest - (limit - 1 - index) * 120,
                key: `CONUS/x/${newest}`,
              })),
            );
          }
          if (command.startsWith("plugin:store|")) return Promise.resolve(null);
          return Promise.reject(new Error(`${command} is not stubbed`));
        },
        transformCallback: (callback: unknown) => callback,
      };
    },
    { newest: NEWEST, products: PRODUCTS },
  );
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await fakeNativeSide(page);
  // The locally served tiles are ordinary HTTP on Windows, so they can be
  // answered here the same way any other tile host is.
  await page.route("http://mrms.localhost/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
});

test("leads with the MRMS grid rather than the mosaic", async ({ page }) => {
  const tiles: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://mrms.localhost/")) {
      tiles.push(request.url());
    }
  });

  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  // The timeline credits MRMS, not RIDGE, and the frames are its two-minute
  // grids rather than the mosaic's.
  await expect(page.getByText(/of 60 radar frames · NOAA MRMS/)).toBeVisible();

  await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Every tile names the product and the moment it belongs to.
  expect(
    tiles.every((url) =>
      /\/composite\/17880\d{5}\/\d+\/\d+\/\d+\.png$/.test(url),
    ),
  ).toBe(true);
});

test("draws rotation tracks and hail with their own scales", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.goto("/?testMode=1");
  await expect(pane).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Rotation Tracks/ }).check();

  await expect(pane).toHaveAttribute("data-layer-stack", /mrms-rotation/);
  await expect(
    page.getByText("Rotation tracks, past hour (1/s)"),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: /Hail Size/ }).check();
  await expect(pane).toHaveAttribute("data-layer-stack", /mrms-mesh/);
  await expect(
    page.getByText("Maximum estimated hail size (mm)"),
  ).toBeVisible();

  // Hail draws over rotation, because a hail core is the smaller target.
  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  expect(stack.indexOf("openradar-mrms-rotation")).toBeLessThan(
    stack.indexOf("openradar-mrms-mesh"),
  );
  // Both sit under the warnings, which must never be covered.
  expect(stack.indexOf("openradar-mrms-mesh")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );

  await page.getByRole("checkbox", { name: /Rotation Tracks/ }).uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /mrms-rotation/);
  await expect(pane).toHaveAttribute("data-layer-stack", /mrms-mesh/);
});

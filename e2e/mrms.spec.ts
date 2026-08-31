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
  {
    id: "hail-swath",
    label: "Hail swath",
    unit: "mm",
    floor: 6,
    stops: [[6, "#38bdf8"]],
  },
  {
    id: "lightning",
    label: "Lightning density",
    unit: "count",
    floor: 1,
    stops: [[1, "#facc15"]],
  },
  {
    id: "echo-tops",
    label: "Echo tops",
    unit: "kft",
    floor: 5,
    stops: [[5, "#38bdf8"]],
  },
  {
    id: "vil",
    label: "Liquid held aloft",
    unit: "kg/m²",
    floor: 1,
    stops: [[1, "#38bdf8"]],
  },
  {
    id: "precip-rate",
    label: "Rain rate",
    unit: "mm/h",
    floor: 0.1,
    stops: [[0.1, "#38bdf8"]],
  },
  {
    id: "qpe-hour",
    label: "Rain, past hour",
    unit: "mm",
    floor: 0.1,
    stops: [[0.1, "#38bdf8"]],
  },
  {
    id: "qpe-day",
    label: "Rain, past day",
    unit: "mm",
    floor: 0.1,
    stops: [[0.1, "#38bdf8"]],
  },
  {
    id: "precip-type",
    label: "Precipitation type",
    // A category rather than a quantity, so no unit and a list of names
    // instead of a scale.
    unit: "",
    floor: 0.5,
    stops: [
      [1, "#a6dda0"],
      [3, "#62b6f5"],
    ],
    categories: [
      [1, "#a6dda0", "warmStratiform"],
      [3, "#62b6f5", "snow"],
      [7, "#e05555", "hail"],
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
  // Sixty two-minute grids span the two-hour loop, and twenty of them are
  // drawn: each is a fifty megabyte decode, and six-minute steps show the
  // same weather.
  await expect(page.getByText(/of 20 radar frames · NOAA MRMS/)).toBeVisible();

  await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Every tile names the product, the moment it belongs to, and the colour
  // table it was drawn with.
  expect(
    tiles.every((url) =>
      /\/composite\/17880\d{5}\/\d+\/\d+\/\d+\.png\?p=\d+$/.test(url),
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

test("keeps a full stack of product legends inside the scaled viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "130%", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  for (const label of [
    "Rotation Tracks",
    "Hail Size",
    "Hail Swath",
    "Lightning Density",
    "Echo Tops",
    "Liquid Held Aloft",
    "Rain Rate",
    "Rain, Past Hour",
    "Rain, Past Day",
  ]) {
    await page
      .locator(".setting-list")
      .getByRole("checkbox", { name: new RegExp(label) })
      .check();
  }
  await page.getByRole("button", { name: "Close Layers" }).click();

  const legends = page.locator(".product-legends");
  await expect(legends.locator(".product-legend")).toHaveCount(9);
  const box = await legends.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewport: window.innerHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.viewport);
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
});

test("lists precipitation type by name rather than as a scale", async ({
  page,
}) => {
  await fakeNativeSide(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=6");
  await expect(page.getByRole("application")).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Rain or Snow/ })
    .check();
  await page.getByRole("button", { name: "Close Layers" }).click();

  const legend = page.locator(".product-legend", {
    hasText: "Precipitation type",
  });
  await expect(legend).toBeVisible();
  // Names, not numbers: six is not more than three, it is convection rather
  // than snow, and a scale would say otherwise.
  await expect(legend.locator("ol.is-categorical")).toBeVisible();
  await expect(legend).toContainText("Snow");
  await expect(legend).toContainText("Hail");
  await expect(legend).not.toContainText("kg/m²");
  // And it says what it is: the network's own classification rather than
  // somebody looking out of a window.
  await expect(legend).toContainText("classification");
});

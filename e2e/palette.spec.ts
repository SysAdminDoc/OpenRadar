import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

/** A small reflectivity table, in the shape people pass round. */
const PAL = [
  "; OpenRadar test palette",
  "Product: BR",
  "Units: dBZ",
  "Step: 5",
  "Color: 5 0 0 0",
  "Color: 50 128 128 128",
  "SolidColor: 75 255 255 255",
  "IconFile: 1, 15, 25, 8, 25, http://example.test/icons.png",
].join("\n");

async function fakeNativeSide(page: Page) {
  await page.addInitScript(() => {
    const calls: Array<{ command: string; args: unknown }> = [];
    (window as unknown as { __paletteCalls: typeof calls }).__paletteCalls =
      calls;
    let generation = 0;
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      invoke: (command: string, args: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === "set_palette") {
          generation += 1;
          return Promise.resolve(generation);
        }
        if (command === "mrms_products") {
          return Promise.resolve([
            {
              id: "composite",
              label: "MRMS composite",
              unit: "dBZ",
              floor: 5,
              stops: [[5, "#04e9e7"]],
            },
          ]);
        }
        if (command === "mrms_frames") {
          const limit = Number(args.limit);
          return Promise.resolve(
            Array.from({ length: limit }, (_, index) => ({
              time: 1788083202 - (limit - 1 - index) * 120,
              key: "CONUS/x/1788083202",
            })),
          );
        }
        if (command.startsWith("plugin:store|")) return Promise.resolve(null);
        return Promise.reject(new Error(`${command} is not stubbed`));
      },
      transformCallback: (callback: unknown) => callback,
    };
  });
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

async function loadPalette(page: Page) {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "reflectivity.pal",
    mimeType: "text/plain",
    buffer: Buffer.from(PAL),
  });
}

test("takes a colour table and hands it to the renderers", async ({ page }) => {
  const tiles: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://mrms.localhost/")) {
      tiles.push(request.url());
    }
  });

  await loadPalette(page);

  // What was read out of the file, said plainly rather than left to guess at.
  await expect(page.getByText(/reflectivity\.pal applied/)).toBeVisible();
  await expect(
    page.getByText(/3 colours, for dBZ, iconfile left out/),
  ).toBeVisible();

  const sent = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls.filter((call) => call.command === "set_palette"),
  );
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)?.args).toMatchObject({
    units: "dBZ",
    stops: [
      { value: 5, color: "#000000", toColor: null },
      { value: 50, color: "#808080", toColor: null },
      { value: 75, color: "#ffffff", toColor: null },
    ],
  });

  // The map has to ask for its tiles again, or it keeps showing the old
  // colours until every tile happens to be re-requested.
  await expect
    .poll(() => tiles.filter((url) => /[?&]p=[1-9]/.test(url)).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

test("draws the legend from the table rather than the built-in ramp", async ({
  page,
}) => {
  // Before: the NWS scale the mosaics are drawn with.
  await expect(page.getByLabel(/from 5 to 75 dBZ/)).toBeVisible();

  await loadPalette(page);

  // After: the table's own range, and its own colours in the bar.
  await expect(page.getByLabel(/from 5 to 75 dBZ/)).toBeVisible();
  const ramp = page.locator(".radar-legend .legend-ramp");
  // The browser writes the hex back out as rgb.
  await expect(ramp).toHaveAttribute("style", /rgb\(0, 0, 0\)/);
  await expect(ramp).toHaveAttribute("style", /rgb\(255, 255, 255\)/);
  // The middle stop is where the table puts it, not where an even spread would.
  await expect(ramp).toHaveAttribute("style", /rgb\(128, 128, 128\) 64\./);
});

test("refuses a file with no colours in it", async ({ page }) => {
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "empty.pal",
    mimeType: "text/plain",
    buffer: Buffer.from("Product: BR\nUnits: dBZ\n"),
  });
  await expect(
    page.getByText(/That palette has no colours this map can use/),
  ).toBeVisible();
});

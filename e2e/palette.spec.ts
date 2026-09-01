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
        if (command === "set_palettes") {
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
    page.getByText(/3 colours, for dBZ, iconfile, product and step left out/),
  ).toBeVisible();

  const sent = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls.filter((call) => call.command === "set_palettes"),
  );
  expect(sent.length).toBeGreaterThan(0);
  // Whether a stop is solid travels with it. The last line of the file is a
  // SolidColor, and dropping that flag on the way over drew it as a blend
  // into nothing, which is not what the reader's file says.
  expect(sent.at(-1)?.args).toMatchObject({
    tables: [
      {
        units: "dBZ",
        stops: [
          { value: 5, color: "#000000", toColor: null, solid: false },
          { value: 50, color: "#808080", toColor: null, solid: false },
          { value: 75, color: "#ffffff", toColor: null, solid: true },
        ],
      },
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

test("can be taken off again long after the toast has gone", async ({
  page,
}) => {
  await loadPalette(page);

  // The toast offers Remove, but it clears itself after a few seconds and the
  // table stays on. The panel that loaded it has to be able to take it off.
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const row = page.locator("[data-palette='reflectivity.pal']");
  await expect(row).toBeVisible();
  await expect(row).toContainText("3 colours");

  await page.getByRole("button", { name: "Remove reflectivity.pal" }).click();
  await expect(row).toHaveCount(0);

  // And the renderer is told, rather than being left drawing the old table.
  const cleared = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls
      .filter((call) => call.command === "set_palettes")
      .at(-1),
  );
  // An empty set, not a set holding an empty table: leaving the folded colour
  // behind would keep the old table's purple on the map.
  expect(cleared?.args).toEqual({ tables: [] });

  // Loading a table is a file found, opened and dropped on the window, and
  // clearing it threw all of that away with no way back.
  await expect(page.getByText("Colour table removed")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();

  await expect(row).toBeVisible();
  await expect(row).toContainText("3 colours");
  const restored = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls
      .filter((call) => call.command === "set_palettes")
      .at(-1),
  );
  // The whole table, not an empty one under the old name.
  const back = (restored?.args.tables as Array<Record<string, unknown>>)[0];
  expect(back.units).toBe("dBZ");
  expect((back.stops as unknown[]).length).toBe(3);
});

test("holds a reflectivity table and a velocity table at the same time", async ({
  page,
}) => {
  // The whole point of a library. One slot meant importing the second threw
  // the first away without a word.
  await loadPalette(page);
  // Importing closes the panel, so the second one starts from the bar again.
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "velocity.pal",
    mimeType: "text/plain",
    buffer: Buffer.from(
      ["Units: kt", "Color: -60 0 255 0", "Color: 60 255 0 0"].join("\n"),
    ),
  });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.locator("[data-palette='reflectivity.pal']")).toBeVisible();
  await expect(page.locator("[data-palette='velocity.pal']")).toBeVisible();

  const sent = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls
      .filter((call) => call.command === "set_palettes")
      .at(-1),
  );
  const tables = sent?.args.tables as Array<Record<string, unknown>>;
  expect(tables.map((table) => table.units).sort()).toEqual(["dBZ", "kt"]);
});

test("takes a table out of force without taking it off the shelf", async ({
  page,
}) => {
  await loadPalette(page);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const row = page.locator("[data-palette='reflectivity.pal']");
  await expect(row).toHaveAttribute("data-palette-in-force", "1");

  await page.getByRole("button", { name: "In force for dBZ" }).click();
  await expect(row).toHaveAttribute("data-palette-in-force", "0");
  // Still on the shelf, which is the difference between this and Remove.
  await expect(row).toBeVisible();

  // And the map goes back to the built-in scale rather than keeping the
  // table's colours with nothing in force.
  const sent = await page.evaluate(() =>
    (
      window as unknown as {
        __paletteCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__paletteCalls
      .filter((call) => call.command === "set_palettes")
      .at(-1),
  );
  expect(sent?.args).toEqual({ tables: [] });
  await expect(page.getByLabel(/from 5 to 75 dBZ/)).toBeVisible();
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

import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

/**
 * Level II is decoded natively, so a browser has no site to show. Standing in
 * for the native side is the only way to exercise the handover, and what is
 * being tested here is the handover: which picture the map draws, what the
 * legend says, and what happens when the view zooms back out.
 */
async function fakeNativeSide(page: Page) {
  await page.addInitScript(
    ({ png }: { png: string }) => {
      const sweep = (station: string, product: string, tilt: number) => {
        const products: Record<string, [string, string]> = {
          reflectivity: ["Reflectivity", "dBZ"],
          velocity: ["Velocity", "m/s"],
          "spectrum-width": ["Spectrum width", "m/s"],
          "differential-reflectivity": ["Differential reflectivity", "dB"],
          "correlation-coefficient": ["Correlation coefficient", ""],
        };
        const tilts = [0.48, 0.87, 1.31, 1.8];
        const [label, unit] = products[product] ?? ["Reflectivity", "dBZ"];
        return {
          station,
          siteName: "Des Moines, IA",
          product: label,
          unit,
          elevationDegrees: tilts[Math.min(tilt, tilts.length - 1)],
          tilts,
          tiltIndex: tilt,
          collected: new Date().toISOString(),
          west: -96.5,
          south: 39.6,
          east: -91.0,
          north: 43.8,
          image: png,
          volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
        };
      };

      const calls: Array<{ command: string; args: unknown }> = [];
      (window as unknown as { __sweepCalls: typeof calls }).__sweepCalls =
        calls;
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        invoke: (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "level2_nearest_site") return Promise.resolve("KDMX");
          if (command === "level2_sweep") {
            return Promise.resolve(
              sweep(
                String(args.station),
                String(args.product),
                Number(args.tilt),
              ),
            );
          }
          // The settings store is not what this test is about, and a
          // rejection here would only raise a toast over the map.
          if (command.startsWith("plugin:store|")) return Promise.resolve(null);
          return Promise.reject(new Error(`${command} is not stubbed`));
        },
        transformCallback: (callback: unknown) => callback,
      };
    },
    {
      png: `data:image/png;base64,${transparentPng.toString("base64")}`,
    },
  );
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await fakeNativeSide(page);
});

async function open(page: Page, zoom: number) {
  await page.goto(
    `/?testMode=1&lon=-93.72&lat=41.73&zoom=${zoom}&bearing=0&pitch=0`,
  );
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
}

test("hands a close-in view over to the nearest site and back again", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await open(page, 9);
  // The site's own sweep is drawn, and the mosaic steps aside for it rather
  // than showing through from underneath.
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.00");
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();
  await expect(page.getByText("0.48° TILT")).toBeVisible();

  const asked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __sweepCalls: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__sweepCalls,
  );
  expect(asked.map((call) => call.command)).toContain("level2_nearest_site");
  const sweepCall = asked.find((call) => call.command === "level2_sweep");
  expect(sweepCall?.args).toMatchObject({
    station: "KDMX",
    product: "reflectivity",
    tilt: 0,
  });

  // Zooming back out is the mosaic's job again.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.70");
  await expect(page.getByText("Composite Radar")).toBeVisible();
});

test("switches product and tilt on the site already on screen", async ({
  page,
}) => {
  await open(page, 9);
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();

  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("velocity");
  await expect(page.getByText("KDMX Velocity")).toBeVisible();
  // The legend has to change scale with the product, not keep showing dBZ.
  await expect(page.getByLabel(/Velocity from -35 to 35 m\/s/)).toBeVisible();

  await page.getByRole("combobox", { name: "Level II tilt" }).selectOption("2");
  await expect(page.getByText("1.31° TILT")).toBeVisible();

  const asked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __sweepCalls: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__sweepCalls,
  );
  const sweeps = asked.filter((call) => call.command === "level2_sweep");
  expect(sweeps.at(-1)?.args).toMatchObject({ product: "velocity", tilt: 2 });
});

test("turning single site off puts the mosaic back", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await open(page, 9);
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);

  await page.getByRole("button", { name: /KDMX/ }).first().click();
  await page.getByRole("checkbox", { name: /Single site up close/ }).uncheck();

  await expect(pane).not.toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.70");
});

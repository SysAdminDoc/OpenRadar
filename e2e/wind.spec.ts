import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/** A tiny field, enough for the layer to have something to animate. */
const FIELD = {
  columns: 4,
  rows: 3,
  north: 90,
  west: 0,
  dLat: 60,
  dLon: 90,
  minU: -20,
  maxU: 20,
  minV: -20,
  maxV: 20,
  init: "2026-08-30T06:00:00+00:00",
  leadHours: 0,
  image:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAHElEQVQI12P8z8DwnwEJMDEgAWQOE7oAigATANvXBAcHrJC1AAAAAElFTkSuQmCC",
};

async function fakeNativeSide(page: Page, field: unknown = FIELD) {
  await page.addInitScript((wind) => {
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      invoke: (command: string) => {
        if (command === "gfs_wind") return Promise.resolve(wind);
        if (command === "set_palette") return Promise.resolve(0);
        if (command.startsWith("plugin:store|")) return Promise.resolve(null);
        return Promise.reject(new Error(`${command} is not stubbed`));
      },
      transformCallback: (callback: unknown) => callback,
    };
  }, field);
}

test("draws wind particles and says which run they are from", async ({
  page,
}) => {
  await routeWorkspace(page);
  await fakeNativeSide(page);
  await page.goto("/?testMode=1");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await expect(pane).not.toHaveAttribute("data-layer-stack", /openradar-wind/);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Wind/ }).check();

  await expect(pane).toHaveAttribute("data-layer-stack", /openradar-wind/);
  // Which run, and how old, because model guidance that does not say which
  // run it is could be from yesterday.
  await expect(page.locator("[data-wind-run]")).toBeVisible();
  await expect(page.getByText(/GFS 06Z · \d+ h old/)).toBeVisible();
  await expect(
    page.getByText(/Model guidance, not an observation/),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: /^Wind/ }).uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /openradar-wind/);
});

test("holds the particles back when the device asks for less movement", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await routeWorkspace(page);
  await fakeNativeSide(page);
  await page.goto("/?testMode=1");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Wind/ }).check();

  // The switch is on and stays on, but nothing animates, and the panel says
  // why rather than looking broken.
  await expect(page.getByRole("checkbox", { name: /^Wind/ })).toBeChecked();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /openradar-wind/);
  await expect(
    page.getByText(/Held back because this device asks for less movement/),
  ).toBeVisible();

  await context.close();
});

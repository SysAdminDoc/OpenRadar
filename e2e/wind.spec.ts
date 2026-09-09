import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

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

test("takes the layer back out when its shaders will not build", async ({
  page,
}) => {
  // A program that compiles on one driver and not the next is the ordinary
  // way a WebGL layer fails, and it fails silently: the layer is added, the
  // switch says it is on, and nothing is drawn. The map then reads as a calm
  // afternoon, which on a hazard display is the worst thing it can do. Two
  // readers of another radar app hit exactly this in a week, on GLSL ES 100
  // and on GLSL 120, and in both the layer stayed in the style.
  //
  // The compile check is refused rather than the shader source being broken,
  // because what is under test is what the app does about a card that says
  // no, not any particular card's reason for saying it.
  //
  // Only this layer's shaders. The map's own programs go through the same
  // call, and refusing all of them takes the basemap down instead, which
  // tests nothing about the wind layer and everything about MapLibre. The
  // sources are recorded as they are handed over and matched on `u_wind`,
  // which no other program in the style declares.
  await page.addInitScript(() => {
    const gl = WebGL2RenderingContext.prototype;
    const sources = new WeakMap<WebGLShader, string>();
    const handOver = gl.shaderSource;
    gl.shaderSource = function (
      this: WebGL2RenderingContext,
      shader: WebGLShader,
      source: string,
    ) {
      sources.set(shader, source);
      return handOver.call(this, shader, source);
    };
    const ask = gl.getShaderParameter;
    gl.getShaderParameter = function (
      this: WebGL2RenderingContext,
      shader: WebGLShader,
      name: number,
    ) {
      if (
        name === this.COMPILE_STATUS &&
        sources.get(shader)?.includes("u_wind")
      ) {
        return false;
      }
      return ask.call(this, shader, name) as unknown;
    } as typeof ask;
  });
  await routeWorkspace(page);
  await fakeNativeSide(page);
  await page.goto("/?testMode=1");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Wind/ }).check();

  // Said in the app's own words, in the reader's own language.
  await expect(
    page.getByText("The wind layer could not be drawn on this graphics card."),
  ).toBeVisible();
  // The switch follows the picture rather than describing a layer that is not
  // there, and the layer is out of the style.
  await expect(page.getByRole("checkbox", { name: /^Wind/ })).not.toBeChecked();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /openradar-wind/);

  // And the rest of the map is untouched: one layer failing is not the
  // workspace failing, which is what the whole-window recovery screen means.
  await expect(
    page.getByText("The interface could not finish drawing."),
  ).toHaveCount(0);
  await expect(pane).toHaveAttribute("data-layer-stack", /radar/);
});

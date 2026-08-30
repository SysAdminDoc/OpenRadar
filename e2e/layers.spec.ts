import { expect, test, type Locator } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/** Every switch in the Layers panel and the map layer it is meant to control. */
const LAYERS: Array<{ label: RegExp; layerId: string; onByDefault: boolean }> =
  [
    {
      label: /Weather Alerts/,
      layerId: "openradar-overlay-alerts-fill",
      onByDefault: true,
    },
    {
      label: /Earthquakes/,
      layerId: "openradar-overlay-earthquakes-circle",
      onByDefault: false,
    },
    {
      label: /Wildfires/,
      layerId: "openradar-overlay-wildfires-fill",
      onByDefault: false,
    },
    {
      label: /Tropical/,
      layerId: "openradar-overlay-tropical-cone",
      onByDefault: true,
    },
  ];

/** The camera eases into place, so a reading is only good once it stops moving. */
async function settledCamera(pane: Locator): Promise<string> {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await pane.getAttribute("data-camera");
        const stable = current !== null && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [150, 150, 150, 150, 150, 150, 150, 150] },
    )
    .toBe(true);
  return previous ?? "";
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

for (const layer of LAYERS) {
  test(`the ${layer.label.source} switch adds and removes its map layer`, async ({
    page,
  }) => {
    const pane = page.getByRole("application", {
      name: "Interactive weather map",
    });
    const stack = new RegExp(layer.layerId);

    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const toggle = page.getByRole("checkbox", { name: layer.label });

    if (layer.onByDefault) {
      await expect(pane).toHaveAttribute("data-layer-stack", stack);
      await toggle.uncheck();
      await expect(pane).not.toHaveAttribute("data-layer-stack", stack);
      await toggle.check();
      await expect(pane).toHaveAttribute("data-layer-stack", stack);
      return;
    }

    await expect(pane).not.toHaveAttribute("data-layer-stack", stack);
    await toggle.check();
    await expect(pane).toHaveAttribute("data-layer-stack", stack);
    await toggle.uncheck();
    await expect(pane).not.toHaveAttribute("data-layer-stack", stack);
  });
}

test("saves, reopens, and undoes a preset", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const home = await settledCamera(pane);

  await page.getByRole("button", { name: "Zoom in" }).click();
  const saved = await settledCamera(pane);
  expect(saved).not.toBe(home);

  await page.getByLabel("Save preset 2").click();
  await expect(page.getByText("Preset 2 saved")).toBeVisible();
  await expect(page.getByLabel("Open preset 2")).toBeVisible();

  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect(await settledCamera(pane)).not.toBe(saved);

  await page.getByLabel("Open preset 2").click();
  await expect(page.getByText("Preset 2 opened")).toBeVisible();
  expect(await settledCamera(pane)).toBe(saved);

  // Saving again offers an undo, which puts the slot back to empty.
  await page.getByLabel("Save preset 3").click();
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(page.getByLabel("Save preset 3")).toBeVisible();
});

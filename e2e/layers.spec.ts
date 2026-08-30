import { expect, test, type Locator } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

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

test("puts satellite under the radar and names its own image time", async ({
  page,
}) => {
  await page.route("https://gibs.earthdata.nasa.gov/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Satellite/ }).check();

  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-satellite-layer/,
  );
  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  expect(stack.indexOf("openradar-satellite-layer")).toBeLessThan(
    stack.indexOf("openradar-radar-layer-observed"),
  );
  await expect(page.locator(".satellite-chip small")).toContainText("min old");

  await page.getByRole("checkbox", { name: /Satellite/ }).uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /openradar-satellite-layer/,
  );
});

test("draws a GRLevelX placefile in its own colours", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "reports.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "Title: Test Reports",
        "Refresh: 5",
        // Magenta, which nothing else in the workspace draws.
        "Color: 255 0 255",
        'Line: 12, 0, "Warned area"',
        " 24.0, -88.0",
        " 27.0, -83.0",
        "End:",
        'Place: 26.5, -85.5, "Hail 2.0 in"',
        'IconFile: 1, 15, 25, 8, 25, "https://example.test/icons.png"',
      ].join(String.fromCharCode(10)),
    ),
  });

  await expect(page.getByText(/reports.txt added/)).toBeVisible();
  await expect(page.getByText(/refreshed every 5 min/)).toBeVisible();
  await expect(page.getByText(/Icon left out/)).toBeVisible();
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-line/);
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);

  // The colour the file asked for reaches the map, not a house default.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return 0;
        const target = document.createElement("canvas");
        target.width = canvas.width;
        target.height = canvas.height;
        const context = target.getContext("2d");
        if (!context) return 0;
        context.drawImage(canvas, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          target.width,
          target.height,
        ).data;
        let magenta = 0;
        for (let at = 0; at < pixels.length; at += 4) {
          if (pixels[at] > 200 && pixels[at + 1] < 80 && pixels[at + 2] > 200) {
            magenta += 1;
          }
        }
        return magenta;
      }),
    )
    .toBeGreaterThan(600);
});

test("keeps warnings above the context layers", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /alerts-fill/);
  await expect(pane).toHaveAttribute("data-layer-stack", /tropical-cone/);

  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  expect(stack.indexOf("openradar-overlay-tropical-cone")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );
});

test("lists an active storm and flies to it", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Tropical", exact: true }).click();

  const row = page.locator(".storm-row").first();
  await expect(row).toContainText("Hurricane Test");
  await expect(row).toContainText("Category 2");
  await expect(row).toContainText("85 kt");
  await expect(row).toContainText("Advisory 7");
  await expect(
    page.getByRole("link", { name: /Read the advisory/ }),
  ).toHaveAttribute("href", "https://www.nhc.noaa.gov/graphics_at1.shtml");

  await page
    .getByRole("button", { name: /Follow/ })
    .first()
    .click();
  // The camera eases in, so the storm centre is where it comes to rest.
  await expect
    .poll(() => pane.getAttribute("data-camera"))
    .toBe("-79.00000,25.00000,5.500,0.00,0.00");
});

test("the Custom Overlay switch removes imported shapes", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "shapes.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-85.5, 25.5] },
            properties: {},
          },
        ],
      }),
    ),
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: /Custom Overlay/ });
  await toggle.uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /custom-points/);
  await toggle.check();
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);
});

test("watches a point and says when a warning reaches it", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  // The fixture warning sits about thirty-five miles from the default centre.
  // The label names the units the slider is actually in, which is the point
  // of the change that renamed it.
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();
  await expect(page.getByText("Watching this point")).toBeVisible();

  // The fixture alert covers the default centre, so the watch has to speak up.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await expect(
    page.getByText(/miles from the point you watch|where you are watching/),
  ).toBeVisible();
});

test("draws the severe outlook under the warnings it is guidance about", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Severe Outlook/ }).check();

  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-spcOutlooks-fill/,
  );

  // Guidance about what might happen belongs under what is happening.
  const stack = (await pane.getAttribute("data-layer-stack"))!.split(" ");
  expect(stack.indexOf("openradar-overlay-spcOutlooks-fill")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );
});

test("shows what people on the ground reported, under the warnings", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Storm Reports/ }).check();

  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-stormReports-points/,
  );

  // A report is what happened, so it belongs over the guidance about what
  // might and under the warning that is still out.
  const stack = (await pane.getAttribute("data-layer-stack"))!.split(" ");
  expect(stack.indexOf("openradar-overlay-stormReports-points")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );
});

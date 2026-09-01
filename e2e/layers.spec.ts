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
      label: /Smoke/,
      layerId: "openradar-overlay-smoke-fill",
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
    // Scoped to the layer switches. The alert kinds below them are also
    // checkboxes in this panel, and one of them is called Tropical too, so a
    // name on its own now matches two different things.
    const toggle = page
      .locator(".setting-list")
      .getByRole("checkbox", { name: layer.label });

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

test("puts a failed enabled layer beside its switch", async ({ page }) => {
  await page.route("https://services3.arcgis.com/**", async (route) => {
    await route.fulfill({ status: 503, body: "maintenance" });
  });
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const row = page.locator(".toggle-row").filter({ hasText: "Wildfires" });
  await row.getByRole("checkbox").check();
  await expect(row).toContainText("NIFC returned 503");
});

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

test("keeps several imported files apart, each on its own switch", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  const drop = async (name: string, lon: number) => {
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.setInputFiles('.drop-zone input[type="file"]', {
      name,
      mimeType: "application/geo+json",
      buffer: Buffer.from(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, 25.5] },
              properties: {},
            },
          ],
        }),
      ),
    });
  };

  await drop("spotters.geojson", -85.5);
  await expect(page.getByText("spotters.geojson added")).toBeVisible();
  await drop("counties.geojson", -85.4);
  await expect(page.getByText("counties.geojson added")).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const files = page.locator("[data-overlay-files] li");
  await expect(files).toHaveCount(2);
  // Shown top first, so the file imported last is at the top of the list.
  await expect(files.first()).toHaveAttribute(
    "data-overlay-file",
    "counties.geojson",
  );

  // Importing the same file again updates it rather than adding a second.
  await drop("spotters.geojson", -85.6);
  await expect(page.getByText("spotters.geojson replaced")).toBeVisible();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(files).toHaveCount(2);

  // One file off leaves the other on the map.
  await page.getByRole("checkbox", { name: "Show counties.geojson" }).uncheck();
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);

  await page.getByRole("button", { name: "Remove spotters.geojson" }).click();
  await expect(files).toHaveCount(1);
  // Nothing switched on is left, so nothing is drawn.
  await expect(pane).not.toHaveAttribute("data-layer-stack", /custom-points/);
});

test("watches more than one place and names the ones a warning reached", async ({
  page,
}) => {
  // One point cannot be home, a school, and the far end of tomorrow's drive.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();

  // A second place, which starts from home's own settings.
  await page
    .getByRole("button", { name: /Add the map centre as a place/ })
    .click();
  const name = page.getByLabel("Place name");
  await expect(name).toHaveValue("Place 2");

  // The fixture warning covers the map centre, so the new place hears about
  // it and the announcement says which place it is about. Whether one warning
  // covering two places is said once is settled in the unit tests, which can
  // put both places down before anything is announced; what is being checked
  // here is that a place added through the panel reaches the watch at all.
  const named = page.locator(".toast", { hasText: "At Place 2" });
  await expect(named).toHaveCount(1);
  await expect(named).toContainText("Tornado Warning");

  // Renaming does not restart the watch and say everything again, which is
  // why the announcement above still carries the name it was added with.
  await name.fill("School");
  await expect(name).toHaveValue("School");
  await expect(
    page.locator(".toast", { hasText: "Tornado Warning" }),
  ).toHaveCount(2);

  // And the list is bounded: nine beside home is all there is room for.
  for (let at = 0; at < 9; at += 1) {
    const add = page.getByRole("button", {
      name: /Add the map centre as a place/,
    });
    if (!(await add.count())) break;
    await add.click();
  }
  await expect(
    page.getByRole("button", { name: /Add the map centre as a place/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/That is all 10 places/)).toBeVisible();
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
  // Scoped to the toast, because the same news now reaches two places and an
  // unscoped match resolves to both.
  const toast = page.locator(".toast-host");
  await expect(toast.getByText("Tornado Warning").first()).toBeVisible();
  await expect(
    toast.getByText(/miles from the point you watch|where you are watching/),
  ).toBeVisible();

  // The other place is the one a screen reader is listening to, and it has to
  // carry the same warning rather than a summary of it.
  await expect(page.locator('.live-region [aria-live="assertive"]')).toHaveText(
    /Tornado Warning.*miles from the point you watch/,
  );
});

test("falls back to yesterday's smoke before today's analysis lands", async ({
  page,
}) => {
  // NOAA publishes one file a day and it is not there in the small hours.
  // The stub answers today with a 404, which is what the reader would meet
  // every morning, and the layer has to draw yesterday rather than nothing.
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("hms_smoke")) asked.push(url);
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Smoke/ }).check();
  await page.getByRole("button", { name: "Close Layers" }).click();

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-smoke-fill/,
  );
  // Today first, then yesterday. Asking for yesterday first would be showing
  // stale smoke on every day the analysis did land.
  await expect.poll(() => asked.length).toBeGreaterThanOrEqual(2);
  const today = new Date();
  const stamp = (at: Date) =>
    `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, "0")}${String(
      at.getUTCDate(),
    ).padStart(2, "0")}`;
  expect(asked[0]).toContain(`hms_smoke${stamp(today)}`);
  expect(asked[1]).toContain(
    `hms_smoke${stamp(new Date(today.getTime() - 86_400_000))}`,
  );

  // And it says which day it is showing, beside the scale it is drawn with.
  const legend = page.locator("[data-smoke-legend]");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Heavy smoke");
  await expect(legend).toContainText("analysed");

  // The warning still draws above it, which is the rule no layer may break.
  const stack = (await pane.getAttribute("data-layer-stack")) ?? "";
  expect(stack.indexOf("openradar-overlay-smoke-fill")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts"),
  );
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

test("switching a kind of alert off takes it out of what is drawn", async ({
  page,
}) => {
  // The fixture serves one Tornado Warning, so the switch it belongs under is
  // the one that has to move it and none of the others.
  //
  // What is checked is the panel rather than the layer list, because the layer
  // stays and draws nothing: an empty source is still a source, and every
  // overlay here works that way. The panel lists exactly what the map has been
  // given, so it is the honest place to see the filter working.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /alerts-fill/);

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Tornado Warning")).toBeVisible();
  await page.getByRole("button", { name: "Close Alerts" }).click();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // A kind nobody has touched is on. The switch is named for what it is for
  // rather than for one of the products under it, because it also holds
  // tsunami warnings and the civil emergencies, and each switch carries a line
  // saying what is under it: matching on the leading words rather than the
  // whole label is what that leaves.
  const tornado = page.getByRole("checkbox", { name: /^Take cover now/ });
  await expect(tornado).toBeChecked();

  // Switching off a kind this alert is not, leaves it alone.
  await page.getByRole("checkbox", { name: /^Flood/ }).uncheck();
  await page.getByRole("button", { name: "Close Layers" }).click();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Tornado Warning")).toBeVisible();
  await page.getByRole("button", { name: "Close Alerts" }).click();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await tornado.uncheck();
  await page.getByRole("button", { name: "Close Layers" }).click();

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Tornado Warning")).toHaveCount(0);
  await expect(page.getByText("No active alerts in view")).toBeVisible();
  await page.getByRole("button", { name: "Close Alerts" }).click();

  // And back again straight away, without waiting on the service.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Take cover now/ }).check();
  await page.getByRole("button", { name: "Close Layers" }).click();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Tornado Warning")).toBeVisible();
});

test("lets the reader say which overlay sits on top, but not over a warning", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const stackNow = async () =>
    (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // More than one movable overlay, or there is no order to arrange. Warnings
  // are on by default and are not movable at all.
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Earthquakes/ })
    .check();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Wildfires/ })
    .check();

  const before = await stackNow();
  expect(before.indexOf("openradar-overlay-tropical-cone")).toBeLessThan(
    before.indexOf("openradar-overlay-alerts-fill"),
  );

  // The list is shown top first, so the first row is what is currently over
  // everything else in the movable band.
  const rows = page.locator(".layer-order li");
  await expect(rows.first()).toBeVisible();
  const topmost = await rows.first().getAttribute("data-overlay");
  expect(topmost).toBeTruthy();

  // Push the bottom one all the way up.
  const bottom = rows.last();
  const moving = await bottom.getAttribute("data-overlay");
  const count = await rows.count();
  for (let step = 0; step < count - 1; step += 1) {
    await page
      .locator(`.layer-order li[data-overlay="${moving}"] button`)
      .first()
      .click();
  }
  await expect(rows.first()).toHaveAttribute("data-overlay", String(moving));

  await page.getByRole("button", { name: "Close Layers" }).click();

  // The map followed, and the warnings are still on top of everything.
  const after = await stackNow();
  const alerts = after.indexOf("openradar-overlay-alerts-fill");
  expect(alerts).toBeGreaterThan(-1);
  for (const id of after) {
    if (id.startsWith("openradar-overlay-") && !id.includes("alerts")) {
      expect(after.indexOf(id), id).toBeLessThan(alerts);
    }
  }
  // And the order of the two that moved actually changed.
  expect(after.join(" ")).not.toBe(before.join(" "));
});

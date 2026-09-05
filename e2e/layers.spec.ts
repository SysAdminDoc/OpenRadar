import { expect, test, type Locator, type Page } from "@playwright/test";
import { routeWorkspace, stubHost, transparentPng } from "./support/fixtures";
import { expectClean } from "./support/axe";
import { contrast } from "./support/contrast";

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
      // Anchored: the forecast smoke row also carries the word.
      label: /^Smoke/,
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
  // The sentence a reader can act on, in their own language. The status
  // code itself goes to the log rather than to the panel.
  await expect(row).toContainText("The NIFC fire service is busy");
});

test("says when the storm reports came from the second source", async ({
  page,
}) => {
  // The fallback shipped drawing the weather service's reports and saying
  // nothing about it: the note reached the overlay's state and the panel was
  // never handed it, so the catalogue line for it could not render at all.
  // A reader looking at this switch is looking because the layer went quiet,
  // and "these came from somewhere else" is the answer they came for.
  await page.route(
    "https://mesonet.agron.iastate.edu/geojson/lsr.geojson**",
    async (route) => {
      await route.fulfill({ status: 503, body: "maintenance" });
    },
  );
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // By the switch's own name rather than by the row's words: the Counties
  // row explains itself with "how warnings and storm reports are worded",
  // and `hasText` does not care about case, so filtering on the layer's name
  // matches two rows.
  const row = page
    .locator(".toggle-row")
    .filter({ has: page.getByRole("checkbox", { name: /^Storm Reports/ }) });
  await row.getByRole("checkbox").check();
  await expect(row).toContainText(
    "coming from the weather service rather than the usual archive",
  );
  // The other half, that the note goes when the archive answers again, is
  // carried by `reports.test.ts` asserting an archive answer has no note on
  // it at all, and by `useOverlays` writing whatever the answer carries on
  // every success. No browser test can watch it happen: this layer refreshes
  // every five minutes.
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
  // The unit, not the number: this fixture's image is four days old and the
  // chip used to say so as a five-digit minute count, which is the thing the
  // age formatting exists to stop. Asserting "min old" was asserting that.
  await expect(page.locator(".satellite-chip small").first()).toContainText(
    /\d+ (min|hours?|days?) old/,
  );
  await expect(page.locator(".satellite-chip small").first()).not.toContainText(
    /\d{3,} min/,
  );

  await page.getByRole("checkbox", { name: /Satellite/ }).uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /openradar-satellite-layer/,
  );
});

test("offers the infrared band beside GeoColor and swaps only itself", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route("https://gibs.earthdata.nasa.gov/**", async (route) => {
    asked.push(route.request().url());
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

  // GeoColor to begin with, which is what the chip says and what is asked for.
  const chip = page.locator(".satellite-chip");
  await expect(chip).toContainText("GeoColor");
  await expect(chip).toContainText("A rendering, not a measurement");
  await expect
    .poll(() => asked.filter((url) => url.includes("GeoColor")).length)
    .toBeGreaterThan(0);

  const before = (await pane.getAttribute("data-layer-stack")) ?? "";
  const mosaicBefore = await pane.getAttribute("data-mosaic-opacity");
  const nonSatellite = () =>
    asked.filter((url) => !url.includes("gibs.earthdata.nasa.gov")).length;
  const otherBefore = nonSatellite();

  await page.getByRole("button", { name: "Clean infrared" }).click();

  // The other band, at its own layer and its own matrix set, and the chip
  // says it is a measurement with a scale rather than a picture.
  await expect(chip).toContainText("Clean infrared");
  await expect(chip.locator(".satellite-chip__legend")).toContainText(
    "Brightness temperature",
  );
  await expect
    .poll(
      () => asked.filter((url) => url.includes("Band13_Clean_Infrared")).length,
    )
    .toBeGreaterThan(0);
  expect(
    asked.some(
      (url) =>
        url.includes("Band13_Clean_Infrared") &&
        url.includes("GoogleMapsCompatible_Level6"),
    ),
  ).toBe(true);

  // Nothing outside the satellite layer moved: the same layers in the same
  // order, the radar drawn at the same strength, and no request to anything
  // that is not the satellite service. The radar frame itself is not checked
  // because the loop advances on its own clock.
  expect(await pane.getAttribute("data-layer-stack")).toBe(before);
  expect(await pane.getAttribute("data-mosaic-opacity")).toBe(mosaicBefore);
  expect(nonSatellite()).toBe(otherBefore);
});

/**
 * How many pixels of the sheet's own colour the map is drawing.
 *
 * Zero is the assertion that works. The other direction, a sheet that loads
 * and paints, could not be made to read back: see `AUD-247` in
 * `Roadmap_Blocked.md` for how far it gets and where it stops.
 */
async function magentaPixels(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return 0;
    const target = document.createElement("canvas");
    target.width = canvas.width;
    target.height = canvas.height;
    const context = target.getContext("2d");
    if (!context) return 0;
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let magenta = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      if (pixels[at] > 200 && pixels[at + 1] < 80 && pixels[at + 2] > 200) {
        magenta += 1;
      }
    }
    return magenta;
  });
}

test("draws a dot where the icon sheet will not load", async ({ page }) => {
  // The other half. A sheet that answers 404 must not leave the position
  // drawing nothing at all: the circle layer skips a feature that has an
  // icon on purpose, so without the fallback the report vanishes.
  await stubHost(
    page,
    "https://mesonet.agron.iastate.edu/pictures/**",
    async (route) => {
      await route.fulfill({ status: 404, body: "gone" });
    },
  );

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "spotters.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "Title: Spotters",
        'IconFile: 1, 15, 25, 7, 24, "https://mesonet.agron.iastate.edu/pictures/sheet.png"',
        "Object: 25.5,-85.5",
        'Icon: 0, 0, 0, 1, 1, "Chaser"',
        "End:",
      ].join(String.fromCharCode(10)),
    ),
  });

  await expect(page.getByText(/spotters.txt added/)).toBeVisible();
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);
  // Nothing of the sheet's colour, because the sheet never arrived.
  await expect.poll(() => magentaPixels(page)).toBe(0);
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
        // The workspace opens centred here, so the click below lands on it.
        'Place: 25.5, -85.5, "Hail 2.0 in"',
        'IconFile: 1, 15, 25, 8, 25, "https://example.test/icons.png"',
      ].join(String.fromCharCode(10)),
    ),
  });

  await expect(page.getByText(/reports.txt added/)).toBeVisible();
  await expect(page.getByText(/refreshed every 5 min/)).toBeVisible();
  // Named, not just counted: "nothing appeared" and "we may not ask that
  // server for the pictures" are different problems for a reader to act on.
  await expect(
    page.getByText(/Icon images from example.test left out/),
  ).toBeVisible();
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

test("says what an imported shape carried when it is clicked", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  // Put the point exactly where the workspace is already looking, so the
  // click below lands on it. Read rather than assumed: the opening camera is
  // a setting, and a test that hard-codes it is testing the setting.
  const [lon, lat] = (await settledCamera(pane)).split(",").map(Number);

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "spotters.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "Title: Reports",
        "Color: 255 0 255",
        `Place: ${lat}, ${lon}, "Hail 2.0 in"`,
      ].join(String.fromCharCode(10)),
    ),
  });
  await expect(page.getByText(/spotters.txt added/)).toBeVisible();
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-points/);

  const box = await pane.boundingBox();
  const popup = page.locator(".map-popup");
  // Clicking again is what waiting for MapLibre to make a published layer
  // queryable looks like from out here; no number of clicks opens a popup
  // over nothing.
  await expect(async () => {
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await expect(popup).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 6_000 });

  // The file it came from, and the words the file carried for this shape.
  await expect(popup).toContainText("spotters.txt");
  await expect(popup).toContainText("Hail 2.0 in");
});

test("holds a placefile shape back until the map is close enough", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.setInputFiles('.drop-zone input[type="file"]', {
    name: "gated.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "Title: Close in only",
        // 750 nautical miles of view, which the workspace opens wider than.
        "Threshold: 750",
        "Color: 255 0 255",
        'Line: 12, 0, "Only close in"',
        " 25.0, -86.0",
        " 26.0, -85.0",
        "End:",
      ].join(String.fromCharCode(10)),
    ),
  });

  await expect(page.getByText(/gated.txt added/)).toBeVisible();
  // The file is in the set and the shape is not on the map, which is the
  // whole of what a threshold is for.
  await expect(pane).not.toHaveAttribute("data-layer-stack", /custom-line/);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(pane).toHaveAttribute("data-layer-stack", /custom-line/);
});

test("switches the convective outlook to another day and hazard", async ({
  page,
}) => {
  // The Day 1 categorical is what a person means by the outlook, so it
  // stays the default and the other twenty-three are a choice.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  // The outlook is off until somebody asks for it, and the chooser belongs
  // to the switch rather than standing on its own.
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Severe Outlook/ })
    .check();
  const section = page.locator("[data-spc-day]");
  await expect(section).toHaveAttribute("data-spc-day", "1");
  await expect(section).toHaveAttribute("data-spc-hazard", "categorical");

  // Day 1 tornado probability is layer 3, with its hatched significant
  // area on layer 2 over the top.
  await section.getByRole("button", { name: "Tornado" }).click();
  await expect(section).toHaveAttribute("data-spc-hazard", "tornado");
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-spcOutlooks-hatch/,
  );

  // Day 4 publishes one probability and no hazard split, so the hazard
  // row goes rather than offering a choice the service cannot answer.
  await section.getByRole("button", { name: "4", exact: true }).click();
  await expect(section).toHaveAttribute("data-spc-day", "4");
  await expect(section.getByRole("button", { name: "Tornado" })).toHaveCount(0);
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
  // A warning toast is the app's loudest moment and the accessibility gate
  // could never reach it: it needs a watched place and a warning over it,
  // which is exactly the fixture this test already builds.
  await expectClean(page, "warning toast");
  await expect(
    toast.getByText(/miles from the point you watch|where you are watching/),
  ).toBeVisible();

  // The other place is the one a screen reader is listening to, and it has to
  // carry the same warning rather than a summary of it.
  await expect(page.locator('.live-region [aria-live="assertive"]')).toHaveText(
    /Tornado Warning.*miles from the point you watch/,
  );
});

test("leaves the map where it is when following is off", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const before = await settledCamera(pane);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();

  // The fixture warning reaches the watched point straight away and says so.
  // With the switch off, that is all that happens.
  await expect(
    page.locator(".toast-host").getByText("Tornado Warning").first(),
  ).toBeVisible();
  await expect(page.getByText(/Went to the/)).toBeHidden();
  expect(await settledCamera(pane)).toBe(before);
});

test("goes to a new warning when asked, and says how to stop", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const before = await settledCamera(pane);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  // Switched on before the watch is, so the first warning to arrive is a
  // warning this is meant to follow.
  await page.getByRole("checkbox", { name: /Go to new warnings/ }).check();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();

  await expect(page.getByText(/Went to the Tornado Warning/)).toBeVisible();
  await expect(page.getByText(/Following new warnings is on/)).toBeVisible();
  // The camera moved to the polygon rather than staying where the reader had
  // it, which is the whole of what the switch does.
  expect(await settledCamera(pane)).not.toBe(before);

  // And the toast carries the way back out, which is the switch itself.
  await page.getByRole("button", { name: "Stop following" }).click();
  await expect(
    page.getByRole("checkbox", { name: /Go to new warnings/ }),
  ).not.toBeChecked();
});

test("never saves a warning up to fly to later", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  // Warnings off first, so the announcement arrives with nothing for the
  // flight to look a polygon up in. That is also the whole of a replay, and
  // the watch keeps announcing through both.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const alerts = page
    .locator(".toggle-row")
    .filter({ hasText: "Weather Alerts" })
    .getByRole("checkbox");
  await alerts.uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /overlay-alerts-fill/,
  );

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Go to new warnings/ }).check();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();

  // Announced, and not flown to, because there is nothing drawn to fly to.
  await expect(
    page.locator(".toast-host").getByText("Tornado Warning").first(),
  ).toBeVisible();
  await expect(page.getByText(/Went to the/)).toBeHidden();
  const parked = await settledCamera(pane);

  // An announcement that could not be acted on is spent, not saved. Coming
  // back to the map minutes later and being flown somewhere is worse than
  // not flying at all.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await alerts.check();
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts-fill/);
  await expect(page.getByText(/Went to the/)).toBeHidden();
  expect(await settledCamera(pane)).toBe(parked);
});

test("leaves the camera alone after the reader has moved it themselves", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Go to new warnings/ }).check();
  await page.keyboard.press("Escape");

  // Zooming with the button is the reader moving the map, and so is panning
  // with the keyboard. Neither fires the gesture events a drag does, so both
  // used to leave somebody open to having the view taken off them.
  await page.getByRole("button", { name: "Zoom in" }).click();
  const mine = await settledCamera(pane);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByLabel("Watched radius, in miles").fill("60");
  await page.getByRole("button", { name: /Watch the map centre/ }).click();

  // The warning still arrives and is still announced. What it does not do is
  // move the view.
  await expect(
    page.locator(".toast-host").getByText("Tornado Warning").first(),
  ).toBeVisible();
  await expect(page.getByText(/Went to the/)).toBeHidden();
  expect(await settledCamera(pane)).toBe(mine);
});

test("hands a warning to the layer that explains it", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts-fill/);

  // The fixture warning is a square from -86,26 to -85,27, so the view goes
  // to the middle of it and the click lands inside the polygon.
  await page.goto("/?testMode=1&lon=-85.5&lat=26.5&zoom=7&bearing=0&pitch=0");
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts-fill/);
  const box = await pane.boundingBox();
  const popup = page.locator(".map-popup");
  // MapLibre publishes a layer before a query against it will answer, and
  // `data-layer-stack` says only that it was published. Under the full suite
  // the click landed in that gap about one run in three: the popup never
  // opened, the test failed on a stylesheet change that had nothing to do
  // with it, and it passed every time the file was run alone. Clicking again
  // is what waiting for the map to answer looks like from out here, and the
  // test still fails deterministically when the layer is genuinely absent,
  // because no number of clicks opens a popup over nothing.
  await expect(async () => {
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await expect(popup).toBeVisible({ timeout: 1000 });
    // Six seconds, not fifteen. The wait is for MapLibre to make a layer it
    // has already published queryable, which takes one frame; a window wide
    // enough to sit through a click being swallowed or a popup taking ten
    // seconds to open would hide the next regression rather than this one.
  }).toPass({ timeout: 6_000 });
  await expect(popup).toContainText("Tornado Warning");
  // What the office wrote, which used to be a link out and nothing else. The
  // words are the forecaster's own: the app neither shortens nor rewrites
  // them.
  await expect(popup).toContainText("confirmed tornado was located");
  await expect(popup).toContainText("TAKE COVER NOW!");
  await expect(popup).toContainText("Collier, FL");
  // A popup over the map is markup the gate had no way to open: it takes a
  // click that lands inside a warning polygon.
  await expectClean(page, "warning popup");

  // The close button is MapLibre's, drawn on MapLibre's white card, and it
  // is a sibling of `.map-popup` rather than a child, so the ink fixed
  // there never reached it. The app's reset hands every button `color:
  // inherit`, which walked all the way up to the workspace text colour:
  // near-white on white in the dark theme, which is the one the app opens
  // in. The card is a fixed light surface in both themes, so this reads the
  // same in both, and inheriting again in either fails it.
  const closeInk = async () =>
    await page.locator(".maplibregl-popup-close-button").evaluate((node) => {
      const style = getComputedStyle(node);
      const card = node.closest(".maplibregl-popup-content");
      return {
        ink: style.color,
        card: card ? getComputedStyle(card).backgroundColor : "",
      };
    });
  const dark = await closeInk();
  expect(
    contrast(dark.ink, dark.card),
    `${dark.ink} on ${dark.card}`,
  ).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();
  const light = await closeInk();
  expect(
    contrast(light.ink, light.card),
    `${light.ink} on ${light.card}`,
  ).toBeGreaterThanOrEqual(4.5);
  // The same ink in both themes, which is the half that says it is not
  // inheriting. The light theme's own text is dark, so a contrast reading
  // there passes whether this rule exists or not.
  expect(light.ink).toBe(dark.ink);

  // The app already holds the thing that explains this warning. The reader
  // should not have to know where it is.
  const action = popup.getByRole("button", { name: /wind in the storm/ });
  await expect(action).toBeVisible();
  await action.click();

  await expect(page.getByText(/Rotation Tracks is on/)).toBeVisible();
  await expect(page.getByText(/Nothing else changed/)).toBeVisible();
  // Switches only: the warning is still drawn exactly as it was, and the
  // switch the action named is the one that moved. The grid itself is
  // decoded natively and draws nothing in a browser preview, which is why
  // this reads the switch rather than the layer stack.
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts-fill/);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const rotation = page
    .locator(".toggle-row")
    .filter({ hasText: "Rotation Tracks" })
    .getByRole("checkbox");
  await expect(rotation).toBeChecked();

  // And it is one action, undone in one.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rotation).not.toBeChecked();
});

test("draws surface observations as station plots, and only close in", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("aviationweather.gov"))
      asked.push(request.url());
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Surface Obs/ }).check();

  // The default view is zoomed out past the point the plots are legible, so
  // the layer says what to do about that rather than asking for a continent.
  await expect(
    page.getByText(/Zoom in to see the station plots/),
  ).toBeVisible();
  expect(asked).toHaveLength(0);
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /overlay-metar-barb/,
  );

  await page.getByRole("button", { name: "Close Layers" }).click();
  // Zoomed by where the camera actually is rather than by a count of clicks,
  // because the layouts do not all start at the same zoom and the threshold
  // is a property of the layer, not of the window.
  const zoomOf = async () =>
    Number(((await pane.getAttribute("data-camera")) ?? "").split(",")[2]);
  for (let step = 0; step < 12 && (await zoomOf()) < 6.5; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect.poll(zoomOf).toBeGreaterThanOrEqual(6.5);

  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-metar-barb/);
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  // The box it asks for is the view it is drawing, in the order the service
  // documents: south, west, north, east.
  const bbox = new URL(asked[0]).searchParams.get("bbox");
  expect(bbox).toMatch(/^-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/);
  const [south, west, north, east] = String(bbox).split(",").map(Number);
  expect(south).toBeLessThan(north);
  expect(west).toBeLessThan(east);

  // The icons are registered, which the layer stack cannot tell you: MapLibre
  // answers a missing icon with a transparent pixel and no complaint, so a
  // symbol layer whose images were never added is on the map drawing nothing.
  await expect
    .poll(async () => (await pane.getAttribute("data-overlay-icons")) ?? "")
    .toContain("station-barb-25");
  const icons = (await pane.getAttribute("data-overlay-icons")) ?? "";
  expect(icons).toContain("station-sky-OVC");

  // Every piece of the plot is its own layer, and the warnings stay above.
  const stack = (await pane.getAttribute("data-layer-stack")) ?? "";
  for (const part of ["barb", "sky", "temp", "dewp"]) {
    expect(stack).toContain(`overlay-metar-${part}`);
  }
  expect(stack.indexOf("overlay-metar-barb")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts"),
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
  await page.getByRole("checkbox", { name: /^Smoke/ }).check();
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
  await expect(page.getByText("No active warnings in view")).toBeVisible();
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

test("switches the day the WPC outlook is for", async ({ page }) => {
  // A day selector that redraws the same day whichever button is pressed looks
  // entirely correct on screen, so this reads the layer the app actually asked
  // the service for. The excessive rainfall days are layers 0 to 4, one behind
  // the day, which is the arithmetic most likely to be wrong.
  const asked: number[] = [];
  await page.route("**/wpc_precip_hazards/**", async (route) => {
    const layer = /MapServer\/(\d+)\/query/.exec(route.request().url())?.[1];
    if (layer !== undefined) asked.push(Number(layer));
    await route.fallback();
  });

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const toggle = page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Excessive Rainfall/ });
  await toggle.check();

  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-wpcExcessiveRain-fill/,
  );
  const chooser = page.locator("[data-wpc-day]");
  await expect(chooser).toHaveAttribute("data-wpc-day", "1");
  await expect.poll(() => asked).toContain(0);

  await page.getByRole("button", { name: "Day 3", exact: true }).click();
  await expect(chooser).toHaveAttribute("data-wpc-day", "3");
  // At once, rather than after the poll: a different day is a different
  // picture, not a stale one.
  await expect.poll(() => asked, { timeout: 5000 }).toContain(2);
  expect(asked).not.toContain(3);

  await page.getByRole("button", { name: "Day 5", exact: true }).click();
  await expect.poll(() => asked, { timeout: 5000 }).toContain(4);

  await toggle.uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /openradar-overlay-wpcExcessiveRain-fill/,
  );
});

test("draws the satellite that is actually over the view, while panning", async ({
  page,
}) => {
  // The whole reason there are three. A reader in Seattle watching the
  // Pacific through GOES-East is looking at the edge of a disk photographed
  // from over Brazil, and nothing on screen said so.
  //
  // One page, dragged, rather than a reload per place: every piece of state
  // this feature has, the missing-slot counter and the band substitution,
  // lives across a camera move, and a test that remounts between readings
  // cannot see any of it.
  await page.route("https://gibs.earthdata.nasa.gov/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.goto("/?testMode=1&lon=-80.2&lat=25.8&zoom=2&bearing=0&pitch=0");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Satellite/ })
    .check();

  const chip = page.locator(".satellite-chip");
  await expect(chip).toHaveAttribute("data-satellite", /^east:/);
  await expect(chip.locator("strong")).toContainText("GOES-East");

  /** Drags the map west, which is what a reader following weather does. */
  const dragWest = async () => {
    const box = await pane.boundingBox();
    if (!box) throw new Error("the map has no layout box");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 14 });
    await page.mouse.up();
  };

  // Westward until the satellite hands over, which it does at 106 west.
  for (let pull = 0; pull < 6; pull += 1) {
    if ((await chip.getAttribute("data-satellite"))?.startsWith("west:")) break;
    await dragWest();
  }
  await expect(chip).toHaveAttribute("data-satellite", /^west:/);
  await expect(chip.locator("strong")).toContainText("GOES-West");

  // And on across the date line, where the only picture is Japan's. Himawari
  // carries no GeoColor on this service, so the band substitutes and the
  // panel says which one is on screen rather than leaving it to be found.
  for (let pull = 0; pull < 8; pull += 1) {
    const now = await chip.getAttribute("data-satellite");
    if (now?.startsWith("himawari:")) break;
    await dragWest();
  }
  await expect(chip).toHaveAttribute("data-satellite", "himawari:clean-ir");
  await expect(chip.locator("strong")).toContainText("Himawari");
  const substitute = page.locator("[data-satellite-substitute]");
  await expect(substitute).toBeVisible();
  // Naming the band that was asked for, not the one it fell back to. It read
  // "Himawari has no Clean infrared here, so this is clean infrared."
  await expect(substitute).toContainText("GeoColor");
});

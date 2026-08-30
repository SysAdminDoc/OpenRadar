import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const ridgeCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Name>conus</Name>
      <Layer queryable="1">
        <Name>conus_bref_qcd</Name>
        <Title>Base Reflectivity</Title>
        <Dimension name="time" units="ISO8601" default="2026-08-30T05:40:00.000Z">2026-08-30T03:40:00.000Z,2026-08-30T04:00:00.000Z,2026-08-30T04:20:00.000Z,2026-08-30T04:40:00.000Z,2026-08-30T05:00:00.000Z,2026-08-30T05:15:00.000Z,2026-08-30T05:30:00.000Z,2026-08-30T05:40:00.000Z</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const nowcoastCapabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Capability>
    <Layer>
      <Layer queryable="1">
        <Name>base_reflectivity_mosaic</Name>
        <Dimension name="time" units="ISO8601">2026-08-30T05:24:00.000Z,2026-08-30T05:28:00.000Z</Dimension>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const emptyCollection = JSON.stringify({
  type: "FeatureCollection",
  features: [],
});

test.beforeEach(async ({ page }) => {
  // Overlay feeds answer empty by default so no test reaches a live service.
  for (const host of [
    "https://mapservices.weather.noaa.gov/**",
    "https://earthquake.usgs.gov/**",
    "https://services3.arcgis.com/**",
  ]) {
    await page.route(host, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: emptyCollection,
      });
    });
  }
  await page.route("https://opengeo.ncep.noaa.gov/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fulfill({
        contentType: "application/xml",
        body: ridgeCapabilities,
      });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("switches globe projection without changing the radar timeline", async ({
  page,
}) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("8 radar frames");
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();
  await expect(timeline).toContainText("8 radar frames");
});

test("opens layers and saves a map preset", async ({ page }) => {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
  const earthquakes = page.getByRole("checkbox", { name: /Earthquakes/ });
  await earthquakes.check();
  await expect(earthquakes).toBeChecked();

  await page.getByRole("button", { name: "Close Layers" }).click();
  await page.getByLabel("Save preset 1").click();
  await expect(page.getByText("Preset 1 saved")).toBeVisible();
  await expect(page.getByLabel("Open preset 1")).toBeVisible();
});

test("opens dual pane and exposes drawing feedback", async ({ page }) => {
  await page.getByRole("button", { name: "Dual Pane" }).click();
  await expect(page.getByRole("application")).toHaveCount(2);
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByText("Click the map to draw a path")).toBeVisible();
});

test("applies the light theme from settings", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keeps both panes on one camera when the second pane is dragged", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Dual Pane" }).click();
  const panes = page.getByRole("application");
  await expect(panes).toHaveCount(2);

  const before = await panes.first().getAttribute("data-camera");
  const box = await panes.nth(1).boundingBox();
  if (!box) throw new Error("The secondary pane has no layout box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 150,
    box.y + box.height / 2 - 70,
    { steps: 12 },
  );
  await page.mouse.up();

  await expect
    .poll(() => panes.first().getAttribute("data-camera"))
    .not.toBe(before);
  await expect
    .poll(async () => {
      const [left, right] = await Promise.all([
        panes.first().getAttribute("data-camera"),
        panes.nth(1).getAttribute("data-camera"),
      ]);
      return left === right;
    })
    .toBe(true);
});

test("shows an earlier radar frame in the compare pane", async ({ page }) => {
  await page.getByRole("button", { name: "Dual Pane" }).click();
  await page.getByRole("button", { name: "Pause radar animation" }).click();
  // React suppresses a change event when the slider already holds the value,
  // so move away from the target frame before selecting it.
  const scrubber = page.getByLabel("Radar frame");
  await scrubber.fill("0");
  await scrubber.fill("7");

  const panes = page.getByRole("application");
  const compare = page.locator(".pane-compare small");
  const live = (await compare.textContent()) ?? "";
  expect(live.length).toBeGreaterThan(0);
  await expect(panes.nth(1)).toHaveAttribute("data-radar-frame", "1788068400");

  await page.getByRole("button", { name: "6 back", exact: true }).click();
  await expect(compare).not.toHaveText(live);
  await expect(panes.first()).toHaveAttribute("data-radar-frame", "1788068400");
  await expect(panes.nth(1)).toHaveAttribute("data-radar-frame", "1788062400");

  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(compare).toHaveText(live);
  await expect(panes.nth(1)).toHaveAttribute("data-radar-frame", "1788068400");
});

test("names the radar source and fails over to nowCOAST", async ({ page }) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("NWS RIDGE II");

  await page.route("https://opengeo.ncep.noaa.gov/**", async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });
  await page.route("https://nowcoast.noaa.gov/**", async (route) => {
    if (route.request().url().includes("GetCapabilities")) {
      await route.fulfill({
        contentType: "application/xml",
        body: nowcoastCapabilities,
      });
      return;
    }
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await page.reload();

  await expect(timeline).toContainText("NOAA nowCOAST");
  await expect(timeline).toContainText("2 radar frames");

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByText(/NWS RIDGE II/).first()).toBeVisible();
  await expect(page.getByText(/returned 503/).first()).toBeVisible();
});

test("adds and removes a map layer when a toggle changes", async ({ page }) => {
  await page.route("https://earthquake.usgs.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [-95, 35, 8] },
            properties: {
              mag: 4.4,
              place: "Test County",
              time: 1788068400000,
              url: "https://earthquake.usgs.gov/x",
            },
          },
        ],
      }),
    });
  });

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).not.toHaveAttribute(
    "data-overlay-layers",
    /earthquakes-circle/,
  );

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Earthquakes/ }).check();
  await expect(pane).toHaveAttribute(
    "data-overlay-layers",
    /openradar-overlay-earthquakes-circle/,
  );

  await page.getByRole("checkbox", { name: /Earthquakes/ }).uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-overlay-layers",
    /earthquakes-circle/,
  );
});

test("lists viewport alerts and flies to one", async ({ page }) => {
  await page.route("https://mapservices.weather.noaa.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-86, 26],
                  [-85, 26],
                  [-85, 27],
                  [-86, 27],
                  [-86, 26],
                ],
              ],
            },
            properties: {
              prod_type: "Tornado Warning",
              sig: "W",
              wfo: "MFL",
              issuance: "2026-08-30T05:00:00Z",
              expiration: "2026-08-30T06:00:00Z",
              url: "https://api.weather.gov/alerts/test",
            },
          },
        ],
      }),
    });
  });

  await page.reload();

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute(
    "data-overlay-layers",
    /openradar-overlay-alerts-fill/,
  );

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expect(page.getByText("Tornado Warning")).toBeVisible();

  const before = await pane.getAttribute("data-camera");
  await page.getByText("Tornado Warning").click();
  await expect.poll(() => pane.getAttribute("data-camera")).not.toBe(before);
});

test("applies a shorter loop length to the timeline right away", async ({
  page,
}) => {
  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("8 radar frames");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Loop length in minutes").fill("60");

  await expect(timeline).toContainText("5 radar frames");
});

test("keeps a scrubbed frame when the loop refreshes", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Pause radar animation" }).click();
  const scrubber = page.getByLabel("Radar frame");
  await scrubber.fill("7");
  await scrubber.fill("5");
  await expect(pane).toHaveAttribute("data-radar-frame", "1788066900");

  // A refresh that carries the same frame must leave the playhead alone.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Earthquakes/ }).check();
  await expect(pane).toHaveAttribute("data-radar-frame", "1788066900");
});

test("records a failed radar source in diagnostics", async ({ page }) => {
  await page.route("https://opengeo.ncep.noaa.gov/**", async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });
  await page.route("https://nowcoast.noaa.gov/**", async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });
  await page.reload();

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnostics" }),
  ).toBeVisible();
  await expect(page.getByText(/NWS RIDGE II failed/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open log folder/ }),
  ).toBeVisible();
});

test("keeps radar under the alert polygons", async ({ page }) => {
  await page.route("https://mapservices.weather.noaa.gov/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-86, 26],
                  [-85, 26],
                  [-85, 27],
                  [-86, 27],
                  [-86, 26],
                ],
              ],
            },
            properties: { prod_type: "Tornado Warning", sig: "W" },
          },
        ],
      }),
    });
  });
  await page.reload();

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /alerts-fill/);

  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  expect(
    stack.indexOf("openradar-radar-layer-observed"),
  ).toBeGreaterThanOrEqual(0);
  expect(stack.indexOf("openradar-radar-layer-observed")).toBeLessThan(
    stack.indexOf("openradar-overlay-alerts-fill"),
  );
});

test("removes an imported overlay when its switch goes off", async ({
  page,
}) => {
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
  await page.getByRole("checkbox", { name: /Custom Overlay/ }).uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /custom-points/);
});

test("says the alerts layer is off instead of showing an empty list", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Weather Alerts/ }).uncheck();
  await page.getByRole("button", { name: "Close Layers" }).click();

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(
    page.getByText("The alerts layer is switched off"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Turn on Weather Alerts" }).click();
  await expect(page.getByText("No active alerts in view")).toBeVisible();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /alerts-fill/);
});

test("copies a link that carries the current view", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await page
    .getByRole("button", { name: "Share", exact: true })
    .first()
    .click();

  await expect(page.getByText("Map link copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const url = new URL(copied);
  expect(url.searchParams.get("projection")).toBe("globe");
  expect(Number(url.searchParams.get("lon"))).toBeCloseTo(-85.5, 3);
  expect(Number(url.searchParams.get("lat"))).toBeCloseTo(25.5, 3);
  expect(Number(url.searchParams.get("zoom"))).toBeCloseTo(4.55, 2);
});

test("opens a shared view from a link in the address bar", async ({ page }) => {
  await page.goto(
    "/?testMode=1&lon=-96.80000&lat=32.78000&zoom=7.25&bearing=18.0&pitch=42.0&projection=globe",
  );
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute(
    "data-camera",
    "-96.80000,32.78000,7.250,18.00,42.00",
  );
});

test("extends the scrubber past now with the forecast run", async ({
  page,
}) => {
  await page.route(
    "https://mesonet.agron.iastate.edu/data/gis/**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ model_init_utc: "2026-08-30T05:00:00Z" }),
      });
    },
  );
  await page.route(
    "https://mesonet.agron.iastate.edu/cache/**",
    async (route) => {
      await route.fulfill({ contentType: "image/png", body: transparentPng });
    },
  );

  const timeline = page.getByLabel("Radar animation", { exact: true });
  await expect(timeline).toContainText("8 radar frames");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Future radar/ }).check();
  await page.getByRole("button", { name: "Close Settings" }).click();

  // Eight observed frames plus six hours of quarter-hour forecast steps.
  await expect(timeline).toContainText("32 radar frames");

  await page.getByRole("button", { name: "Pause radar animation" }).click();
  const scrubber = page.getByLabel("Radar frame");
  await scrubber.fill("0");
  await scrubber.fill("8");
  // The run starts at 05Z and the newest observation is 05:40, so the tail
  // picks up at the next quarter-hour step after it.
  await expect(timeline).toContainText("HRRR init 05Z, +45 min");
  await scrubber.fill("31");
  await expect(timeline).toContainText("HRRR init 05Z, +390 min");
  await expect(page.locator(".radar-timeline")).toHaveClass(/is-forecast/);
});

test("says what is wrong when the machine has no WebGL2", async ({ page }) => {
  // MapLibre 6 dropped WebGL1, so a window that cannot make a WebGL2 context
  // has no map. Without the check the failure arrives from inside the
  // renderer, and the reader is told the interface could not finish drawing,
  // which is true and useless.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind === "webgl2") return null;
      return (
        original as unknown as (
          this: HTMLCanvasElement,
          kind: string,
          ...rest: unknown[]
        ) => unknown
      ).call(this, kind, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/?testMode=1");

  const notice = page.getByRole("alert");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("WebGL2");
  // It names the setting to look at rather than only the symptom.
  await expect(notice).toContainText(/hardware acceleration/i);
  // And the map is not there to be interacted with.
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveCount(0);
});

test("saves the whole workspace to a file and puts it back", async ({
  page,
}) => {
  // A reinstall or a second machine should not mean setting four presets and a
  // watched place up again from memory.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Metres and Celsius" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save settings to a file" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("openradar-settings.json");

  const path = await saved.path();
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as { units: string; schemaVersion: number };
  expect(parsed.units).toBe("metric");
  expect(parsed.schemaVersion).toBe(2);

  // Back to imperial, then restore the file and watch it return.
  await page.getByRole("button", { name: "Feet and Fahrenheit" }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();

  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(path);

  await expect(page.getByText("Settings restored")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Metres and Celsius" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close Settings" }).click();

  // The file is plain JSON in a folder anyone can open, so it comes back
  // through the same checks the stored one does rather than being trusted.
  const edited = join(dirname(path), "edited-settings.json");
  await writeFile(
    edited,
    JSON.stringify({
      ...parsed,
      radar: { ...(parsed as Record<string, never>).radar, opacity: 40 },
      textScale: 900,
    }),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(edited);
  // The first toast is still up, so wait for the second rather than for text
  // that now matches both.
  await expect(page.getByText("Settings restored")).toHaveCount(2);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  // Clamped to the range the slider allows, not the 4000% the file asked for.
  await expect(
    page.getByRole("button", { name: "100%", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".settings-section output").first()).toHaveText(
    "100%",
  );
  await page.getByRole("button", { name: "Close Settings" }).click();

  // A file from a build that knows more than this one loads with whatever
  // this one understands, and says as much. Claiming a full restore over a
  // file half of which was dropped is the failure this guards.
  const newer = join(dirname(path), "newer-settings.json");
  await writeFile(
    newer,
    JSON.stringify({
      ...parsed,
      schemaVersion: 99,
      soundscape: { alerts: true },
    }),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(newer);
  await expect(page.getByText("Settings restored, in part")).toBeVisible();
  await expect(page.getByText(/newer version/)).toBeVisible();
  await expect(page.getByText(/soundscape/)).toBeVisible();

  // And one that is not JSON at all is named for what it is, rather than
  // being handed to the map reader and refused for not being a map.
  const broken = join(dirname(path), "broken-settings.json");
  await writeFile(broken, '{"schemaVersion": 2, "theme": ');
  // The panel closes itself on a restore, so it has to be opened again.
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(broken);
  await expect(
    page.getByText("That settings file could not be read"),
  ).toBeVisible();
});

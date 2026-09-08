import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";

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

test("says where everything is, once", async ({ page }) => {
  // There is no other onboarding. Everything the workspace can do is behind
  // Commands and Layers, and nothing on screen says either exists, so somebody
  // opening it for the first time sees a map and no way in. The station the
  // fixture serves reported hours ago, so the opening line has nothing worth
  // saying and the signpost is the whole of it.
  const hint = page.getByText("Commands searches every product");
  await expect(hint).toBeVisible();

  // Dismissing it is the end of it, this run and every run after.
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await expect(hint).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await expect(hint).toBeHidden();
});

test("does not say it again to somebody who found the commands first", async ({
  page,
}) => {
  // Running a command is finding them, so the hint has nothing left to say.
  await expect(page.getByText("Commands searches every product")).toBeVisible();
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="layer:stormReports"]').click();

  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await expect(page.getByText("Commands searches every product")).toBeHidden();
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

test("the basemap follows the theme until somebody picks one", async ({
  page,
}) => {
  // Choosing Light used to leave the dark basemap under white panels, because
  // the theme only ever set an attribute on the document.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-map-style", "pro-dark");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(pane).toHaveAttribute("data-map-style", "pro-light");
  await page.getByRole("button", { name: "Close Settings" }).click();

  // A style chosen outright is the reader saying what they want, and the theme
  // does not get to overrule it.
  await page.getByRole("button", { name: "Map Type", exact: true }).click();
  await page.getByRole("button", { name: /Roads/ }).click();
  await expect(pane).toHaveAttribute("data-map-style", "roads");
  await page.getByRole("button", { name: "Close Map Type" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(pane).toHaveAttribute("data-map-style", "roads");
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
  // The sentence a reader can act on rather than the protocol's number,
  // which goes to the log. Diagnostics still carries the status through the
  // log block a bug report is pasted from.
  await expect(page.getByText(/is busy/).first()).toBeVisible();
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

test("leaves the reader's place out of a report unless they add it", async ({
  page,
  context,
}) => {
  // The place is the one thing in the report that is about the person rather
  // than the machine. The switch that adds it is beside the button that acts
  // on it, and it starts off every time the panel opens.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?testMode=1&lon=-93.7123&lat=41.7456&zoom=9");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Tell me about warnings" }).check();
  await page.getByRole("button", { name: "Close Settings" }).click();

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  const consent = page.getByRole("checkbox", {
    name: /Include my watched place/,
  });
  await expect(consent).not.toBeChecked();

  await page.getByRole("button", { name: "Copy for a bug report" }).click();
  await expect(page.getByText("Diagnostics copied")).toBeVisible();
  const without = await page.evaluate(() => navigator.clipboard.readText());
  expect(without).not.toContain("Watched place");

  await consent.check();
  await page.getByRole("button", { name: "Copy for a bug report" }).click();
  const asked = await page.evaluate(() => navigator.clipboard.readText());
  expect(asked).toContain("Watched place (added by the reader):");
  // Still rounded to about a kilometre, which is what the app holds it to
  // everywhere else in the report.
  expect(asked).toMatch(/Watched place: -?\d+\.\d, -?\d+\.\d\b/);
  expect(asked).not.toContain("41.7456");

  // And it is off again the next time the panel is opened, rather than
  // remembering a decision somebody made once about one report.
  await page.getByRole("button", { name: "Close Diagnostics" }).click();
  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Include my watched place/ }),
  ).not.toBeChecked();
});

test("hands over a diagnostics block with nothing private in it", async ({
  page,
  context,
}) => {
  // There is no tracker to round-trip through, so the first message somebody
  // sends has to carry enough to work with, and nothing more than that. What
  // this covers is the button and the clipboard; the redaction itself is held
  // by the unit tests, which can plant a position and a path to find. A run
  // here may legitimately log neither.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?testMode=1&lon=-93.7123&lat=41.7456&zoom=9");

  await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
  await page.getByRole("button", { name: "Copy for a bug report" }).click();
  await expect(page.getByText("Diagnostics copied")).toBeVisible();

  const block = await page.evaluate(() => navigator.clipboard.readText());
  expect(block).toContain("OpenRadar");
  expect(block).toContain("Renderer:");
  expect(block).toContain("Sources:");
  // Nothing finer than about a kilometre in the log, which is the only part
  // that carries a position. The header carries version numbers shaped the
  // same way and has to keep them.
  // Every log message, with the timestamp that starts each line taken off:
  // its milliseconds are shaped like a coordinate and are not one.
  for (const line of block.slice(block.indexOf("Log:")).split("\n").slice(1)) {
    const message = line.replace(/^\s*\S+Z\s+\S+\s+\S+:\s*/, "");
    expect(message, line).not.toMatch(/-?\d+\.\d{2,}/);
  }
  expect(block).not.toMatch(/[A-Za-z]:[\\/]Users[\\/]/);
  expect(block).not.toMatch(/\/(?:home|Users)\/[^/\s]+/);
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
  // Both of them, before either is compared against the other. Waiting on
  // the warnings alone and then requiring the radar is a race the radar loses
  // whenever the machine is busy: the two lanes arrive from different
  // services and nothing orders them.
  await expect(pane).toHaveAttribute("data-layer-stack", /alerts-fill/);
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-radar-layer-observed/,
  );

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
  await expect(page.getByText("No active warnings in view")).toBeVisible();
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
  await expect(timeline).toContainText("HRRR run 05Z, 45 min ahead");
  await scrubber.fill("31");
  await expect(timeline).toContainText("HRRR run 05Z, 390 min ahead");
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
  expect(saved.suggestedFilename()).toBe("openradar-workspace.json");

  const path = await saved.path();
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as {
    type: string;
    backupVersion: number;
    settings: {
      units: string;
      schemaVersion: number;
      radar: Record<string, unknown>;
      textScale: number;
    };
    overlayFiles: unknown[];
  };
  expect(parsed.type).toBe("OpenRadarWorkspace");
  // The imported set travels with the backup, empty here because nothing was
  // imported. Its own round trip is held by the unit tests.
  expect(parsed.overlayFiles).toEqual([]);
  expect(parsed.settings.units).toBe("metric");
  // The same version the app is writing to its own settings file, read from
  // the app rather than written here as a number: what matters is that the
  // backup is stamped with the build that wrote it, and a literal only means
  // that until the next schema change.
  const stamped = await page.evaluate(
    () =>
      (
        JSON.parse(
          window.localStorage.getItem("openradar.settings") ?? "{}",
        ) as { schemaVersion?: number }
      ).schemaVersion,
  );
  expect(stamped).toBeGreaterThan(0);
  expect(parsed.settings.schemaVersion).toBe(stamped);

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
      settings: {
        ...parsed.settings,
        radar: { ...parsed.settings.radar, opacity: 40 },
        textScale: 900,
      },
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
      settings: {
        ...parsed.settings,
        schemaVersion: 99,
        soundscape: { alerts: true },
      },
    }),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(newer);
  await expect(page.getByText("Settings restored, in part")).toBeVisible();
  await expect(page.getByText(/newer version/)).toBeVisible();
  await expect(page.getByText(/soundscape/)).toBeVisible();

  // A file that names the format but omits its required envelope is not a
  // request to reset the workspace to defaults. It is rejected before any
  // currently loaded setting changes.
  const malformed = join(dirname(path), "malformed-settings.json");
  await writeFile(malformed, JSON.stringify({ type: "OpenRadarWorkspace" }));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.locator('.drop-zone input[type="file"]').setInputFiles(malformed);
  await expect(
    page.getByText("That workspace backup is incomplete or invalid"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Metres and Celsius" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close Settings" }).click();

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

test("counts every press of the zoom button, not just the ones between eases", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const zoomOf = async () =>
    Number(((await pane.getAttribute("data-camera")) ?? "").split(",")[2]);
  const before = await zoomOf();

  // Pressed the way somebody actually presses it: as fast as the button
  // takes it, without waiting for the map to settle. Stepping from the live
  // zoom counts from wherever the ease has got to, so all but the first
  // press or two are swallowed.
  for (let press = 0; press < 6; press += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect.poll(zoomOf).toBeGreaterThanOrEqual(before + 5.5);

  for (let press = 0; press < 6; press += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect.poll(zoomOf).toBeLessThanOrEqual(before + 0.5);
});

test("the scrubber has a handle big enough to grab", async ({ page }) => {
  // The most dragged control in the app, and its handle was whatever the
  // browser draws: about sixteen pixels, under the twenty-four WCAG asks of
  // a pointer target. Every slider in Settings and Layers had the same one.
  const scrubber = page.locator(".radar-timeline input[type='range']").first();
  await expect(scrubber).toBeVisible();

  // The input's own box, which is the hit area: a handle drawn at
  // twenty-four pixels inside a four pixel input is still a four pixel
  // target. The drawn size of the handle itself is held in `theme.test.ts`,
  // because Chromium will not report a form control's internal pseudo
  // element through `getComputedStyle` and answers with the input's own
  // values instead, which made an assertion here pass at any size.
  const box = await scrubber.evaluate(
    (node) => node.getBoundingClientRect().height,
  );
  expect(box).toBeGreaterThanOrEqual(24);
});

test("the rail says when there is more of it than fits", async ({ page }) => {
  // It scrolls with its scrollbar hidden, and at this size it ends partway
  // through a button: half a label was the only sign the tools below it
  // existed, and that reads as a layout fault rather than as "there is more".
  const region = page.locator(".command-scroll-region");
  await expect(region).toBeVisible();

  const scrolls = await region.evaluate(
    (node) => node.scrollHeight > node.clientHeight + 1,
  );
  test.skip(!scrolls, "the rail fits at this size");

  await expect(region).toHaveAttribute("data-more-below", "");
  await expect(region).not.toHaveAttribute("data-more-above", "");

  await region.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(region).toHaveAttribute("data-more-above", "");
  await expect(region).not.toHaveAttribute("data-more-below", "");
});

test("puts the arrangement back without touching what the reader set up", async ({
  page,
}) => {
  // Reset layout on the crash screen. The pure function has unit tests; what
  // this covers is the wiring around it, which nothing exercised: a read that
  // never happens, a write of the wrong object, or a reload that beats the
  // write are all green without it.
  //
  // Written straight into the page rather than through an init script: the
  // beforeEach above has already navigated, so an init script added here
  // would not run until the reload below and would fight the file the
  // workspace has by then written for itself.
  await page.evaluate(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        textScale: 130,
        projection: "globe",
        overlayOrder: ["something", "left", "over"],
        camera: { center: [12.3, 45.6], zoom: 14, bearing: 90, pitch: 60 },
        watch: {
          enabled: true,
          sound: false,
          name: "Casa",
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      }),
    );
  });
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const stored = async () => {
    try {
      const raw = await page.evaluate(() =>
        window.localStorage.getItem("openradar.settings"),
      );
      return JSON.parse(raw ?? "{}") as Record<string, unknown>;
    } catch {
      // A reload is in flight. Poll again.
      return {};
    }
  };

  // What the workspace is actually holding, read after it has started rather
  // than assumed from the seed: it normalises and rewrites the file on the
  // way up, and a test that asserted against the seed would be asserting
  // against something the app had already replaced.
  await expect.poll(async () => (await stored()).textScale).toBe(130);
  const before = await stored();
  expect((before.watch as { name?: string }).name).toBe("Casa");

  // Now break it. The workspace reads `matchMedia` while it renders, so a
  // getter that throws lands in the boundary the same way a decoder throwing
  // mid-draw does.
  await page.addInitScript(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      get() {
        throw new Error("the sweep could not be drawn");
      },
    });
  });
  await page.reload();
  await expect(page.locator(".fatal-error")).toBeVisible();

  await page.getByRole("button", { name: "Reset layout" }).click();

  await expect
    .poll(async () => (await stored()).textScale, { timeout: 10_000 })
    .toBe(100);

  const after = await stored();
  expect(after.projection).toBe("mercator");
  expect(after.overlayOrder).toEqual([]);
  expect((after.camera as { zoom: number }).zoom).not.toBe(14);

  // And nothing the reader set up. Compared against what the workspace was
  // holding a moment before the crash, field by field, so a reset that
  // quietly replaced any of it fails here.
  expect(after.watch).toEqual(before.watch);
  expect(after.watchPlaces).toEqual(before.watchPlaces);
  expect(after.radar).toEqual(before.radar);
  expect(after.layers).toEqual(before.layers);
  expect(after.palettes).toEqual(before.palettes);
  expect(after.incidentPacks).toEqual(before.incidentPacks);
  expect(after.presets).toEqual(before.presets);
});

test("the rail's own words fit the rail", async ({ page }) => {
  // The clipping sweep cannot see these. It skips everything inside a
  // scroller, on the grounds that a scroller's contents are allowed to
  // overflow it, and the rail scrolls: so two captions were cut off in
  // English, in the app's own primary navigation, at the size the README
  // screenshot is taken, and nothing said so for as long as the rail has
  // existed. Measured directly instead.
  const cut = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".command-button span"))
      .filter((span) => span.scrollWidth > span.clientWidth + 1)
      .map(
        (span) =>
          `${span.textContent}: ${span.scrollWidth} in ${span.clientWidth}`,
      ),
  );
  expect(cut).toEqual([]);
});

test("keeps the compare card and the cursor readout out from under everything", async ({
  page,
}) => {
  // Two corners' worth of collisions. The compare card sat at 12px from the
  // right, which is inside the zoom stack's own column, so its time read
  // "4:58 P" behind the compass button at every width. And neither it nor the
  // cursor readout was on the list of things a right-hand panel shifts, so
  // opening Settings drew both under the panel: the offsets could not be
  // clicked and the coordinates could not be read.
  await page.getByRole("button", { name: "Dual Pane" }).click();
  const card = page.locator(".pane-compare");
  const zoom = page.locator(".zoom-controls");
  await expect(card).toBeVisible();

  const boxes = async () => {
    const one = (await card.boundingBox())!;
    const two = (await zoom.boundingBox())!;
    return { one, two };
  };

  const apart = ({
    one,
    two,
  }: {
    one: { x: number; y: number; width: number; height: number };
    two: { x: number; y: number; width: number; height: number };
  }) =>
    one.x + one.width <= two.x ||
    two.x + two.width <= one.x ||
    one.y + one.height <= two.y ||
    two.y + two.height <= one.y;

  expect(apart(await boxes())).toBe(true);

  // And clear of the toasts, which is the other thing that owns that corner.
  // A toast stops its own dismissal clock while a pointer is on it, so one
  // parked over these buttons is not a moment's overlap: it never goes away
  // and the controls under it cannot be clicked at all. The "Dual pane
  // opened" toast is on screen right now, which is what makes this the
  // moment to ask.
  const toast = page.locator(".toast-host");
  await expect(toast).toContainText(/./);
  const toastBox = (await toast.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(
    cardBox.y >= toastBox.y + toastBox.height ||
      toastBox.y >= cardBox.y + cardBox.height ||
      cardBox.x >= toastBox.x + toastBox.width ||
      toastBox.x >= cardBox.x + cardBox.width,
    "a toast is drawn over the compare controls",
  ).toBe(true);

  // With the panel open, both have to be the thing under the pointer at their
  // own middle. A box that has merely moved is not enough: the panel is drawn
  // over anything it reaches whatever the coordinates say.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".surface-panel")).toBeVisible();
  const pane = page.locator(".map-viewport").first();
  const map = (await pane.boundingBox())!;
  await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
  await expect(page.locator(".map-readout")).toBeVisible();

  // The card is a control, so the question is whether a click reaches it.
  const covered = await page.evaluate(() => {
    const node = document.querySelector(".pane-compare");
    if (!node) return "missing";
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit && (node === hit || node.contains(hit)) ? "" : "covered";
  });
  expect(covered, "the compare card is drawn under something").toBe("");

  // The readout takes no pointer events, so `elementFromPoint` answers with
  // whatever is behind it whether or not anything is in front, and asking it
  // would be a check that cannot pass. What matters for a label is whether it
  // is drawn over the map or over the panel.
  const overlap = await page.evaluate(() => {
    const readout = document.querySelector(".map-readout");
    const panel = document.querySelector(".surface-panel");
    if (!readout || !panel) return "missing";
    const one = readout.getBoundingClientRect();
    const two = panel.getBoundingClientRect();
    const clear =
      one.right <= two.left ||
      two.right <= one.left ||
      one.bottom <= two.top ||
      two.bottom <= one.top;
    return clear ? "" : `${Math.round(one.left)} into ${Math.round(two.left)}`;
  });
  expect(overlap, "the cursor readout is under the panel").toBe("");

  expect(apart(await boxes())).toBe(true);

  // And it still works as a control from under there.
  await page.getByRole("button", { name: "3 back" }).click();
  await expect(page.getByRole("button", { name: "3 back" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("shows whole buttons on the rail and a way to reach the rest", async ({
  page,
}) => {
  // The tool list scrolls with its scrollbar hidden. At 1440 by 900 it ended
  // through the middle of the Range button, so the only sign that eleven more
  // tools existed was an icon with no caption, which reads as a rendering
  // fault. Export and Upload, the two a reader looks for first, were among
  // the hidden.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("button", { name: "Close Layers" }).click();

  const region = page.locator(".command-scroll-region");
  /**
   * Buttons the region shows part of.
   *
   * The argument says which end to ask about. At rest both have to be clean,
   * which is the state this exists for: it is what a reader opens the app to,
   * and where the Range button was cut in half. Scrolled, the top is held to
   * the same standard and the bottom is not. The list is a run of 48px buttons
   * broken by group dividers, so an offset that starts on a button cannot also
   * end on one at every height, and the fade at that edge is a button tall and
   * says so.
   */
  const cut = async (edge: "both" | "top" = "both") =>
    region.evaluate((node, which) => {
      const box = node.getBoundingClientRect();
      return (
        [...node.querySelectorAll(".command-button")]
          .map((button) => {
            const seen = button.getBoundingClientRect();
            return {
              label: button.getAttribute("aria-label") ?? "",
              seen,
              box,
            };
          })
          // Part in and part out: the case this exists to stop. Two pixels of
          // slack, because a fractional layout leaves a hair of a button over
          // an edge and that is not a caption anybody loses; the failure this
          // guards against is half a button.
          .filter(
            ({ seen, box: within }) =>
              (which !== "top" &&
                seen.top < within.bottom - 2 &&
                seen.bottom > within.bottom + 2) ||
              (seen.top < within.top - 2 && seen.bottom > within.top + 2),
          )
          .map(
            ({ label, seen, box: within }) =>
              `${label} ${Math.round(seen.top)}..${Math.round(seen.bottom)} in ${Math.round(within.top)}..${Math.round(within.bottom)} at ${node.scrollTop}`,
          )
      );
    }, edge);

  expect(await cut()).toEqual([]);

  // A control, not just a fade. It is only there when something is hidden,
  // which on this window it is.
  const down = page.getByRole("button", { name: "More tools" });
  await expect(down).toBeVisible();
  const before = await region.evaluate((node) => node.scrollTop);
  await down.click();
  await expect
    .poll(() => region.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(before);

  // And it still starts on a whole button after paging.
  expect(await cut("top")).toEqual([]);
  // Going back up is offered once there is something above.
  await expect(
    page.getByRole("button", { name: "Earlier tools" }),
  ).toBeVisible();

  // All the way to the end, one press at a time. Pressing once and stopping
  // was the whole of this check before, and it missed both of the ways this
  // can go wrong: a step that shrinks with the region until the chevron does
  // nothing at all, and a last page that regrows the box and cuts a button at
  // the top edge instead of the bottom.
  const started = await region.evaluate((node) => node.scrollTop);
  let moves = 0;
  for (let press = 0; press < 30; press += 1) {
    if ((await down.count()) === 0) break;
    const at = await region.evaluate((node) => node.scrollTop);
    await down.click();
    const now = await region.evaluate((node) => node.scrollTop);
    if (now === at) break;
    moves += 1;
    // Every rest on the way down starts on a button. The last rest is the
    // content's own end rather than a button top, because the list is broken
    // by dividers and no height makes both edges land on a boundary at every
    // offset; that one is checked below by what it shows instead.
    //
    // Both facts read in one go: the chevron unmounts a render after the
    // scroll, so asking the DOM about it separately races the React that is
    // taking it away.
    const straddling = await region.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const ended = node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
      if (ended) return [];
      return [...node.querySelectorAll(".command-button")]
        .filter((button) => {
          const seen = button.getBoundingClientRect();
          return seen.top < box.top - 2 && seen.bottom > box.top + 2;
        })
        .map((button) => button.getAttribute("aria-label") ?? "");
    });
    expect(straddling, `after press ${press + 1}`).toEqual([]);
  }
  expect(moves, "the chevron stopped moving the list").toBeGreaterThan(0);
  // It reached the end rather than stalling in the middle, which is what the
  // paging step used to do: shrink with the region until a press moved
  // nothing while eighteen tools were still below.
  await expect(down).toHaveCount(0);
  expect(await region.evaluate((node) => node.scrollTop)).toBeGreaterThan(
    started,
  );

  // And the end shows the end: the last tool in the list, whole.
  const last = await region.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll(".command-button")];
    const seen = buttons[buttons.length - 1]!.getBoundingClientRect();
    return {
      label: buttons[buttons.length - 1]!.getAttribute("aria-label"),
      inside: seen.top >= box.top - 2 && seen.bottom <= box.bottom + 2,
    };
  });
  expect(last.inside, `${last.label} is not wholly on screen at the end`).toBe(
    true,
  );
});

test("asks for an icon it actually has", async ({ page }) => {
  // Both pages declared none, so the webview asked for /favicon.ico on every
  // launch and was answered with a 404: the first error in the console of a
  // working build, and the one a reader looking for a real fault finds first.
  const missed: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 404) missed.push(response.url());
  });
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const declared = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="icon"]')].map(
      (link) => link.getAttribute("href") ?? "",
    ),
  );
  expect(declared.length).toBeGreaterThan(0);
  // And what it names is there.
  for (const href of declared) {
    const answer = await page.request.get(href);
    expect(answer.status(), `${href} is declared but not served`).toBe(200);
  }
  expect(missed.filter((url) => url.includes("favicon"))).toEqual([]);
});

test("a toast does not land on a right-hand panel's own title", async ({
  page,
}) => {
  // Every other fixed piece of map chrome steps aside for a panel: the zoom
  // stack, the legends, the credits, the watermark, the compare card and the
  // cursor readout all shift by the panel's width. The toasts did not, and
  // three at once is what the host allows, so they covered about 210 pixels
  // of whatever was open: with Nearby the intro sentence and the warnings
  // heading, with Alerts the panel's own title.
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();

  // The Upload panel is a right-hand one, and refusing a file is the shortest
  // way to a toast that arrives while it is open, which is the case the
  // defect was found in.
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="surface:upload"]').click();
  const panel = page.getByRole("dialog", { name: "Upload" });
  await expect(panel).toBeVisible();
  await expect(page.locator('.app-shell[data-panel-side="right"]')).toHaveCount(
    1,
  );

  await page.locator('.drop-zone input[type="file"]').setInputFiles({
    name: "rubbish.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from("this is not geojson"),
  });
  const toast = page.locator(".toast-host .toast").first();
  await expect(toast).toBeVisible();

  const header = panel.locator(".surface-panel__header");
  const [over, under] = await Promise.all([
    toast.boundingBox(),
    header.boundingBox(),
  ]);
  expect(over).not.toBeNull();
  expect(under).not.toBeNull();
  const apart =
    over!.x + over!.width <= under!.x + 0.5 ||
    under!.x + under!.width <= over!.x + 0.5 ||
    over!.y + over!.height <= under!.y + 0.5 ||
    under!.y + under!.height <= over!.y + 0.5;
  expect(
    apart,
    `toast ${JSON.stringify(over)} overlaps the panel header ${JSON.stringify(under)}`,
  ).toBe(true);

  // And it is still on the screen rather than pushed off the side.
  const width = page.viewportSize()?.width ?? 0;
  expect(over!.x).toBeGreaterThanOrEqual(0);
  expect(over!.x + over!.width).toBeLessThanOrEqual(width + 0.5);
  // Wide enough to read. The first version of this rule took the host down to
  // 78 pixels over a band of widths, which clears the panel and says nothing.
  expect(over!.width).toBeGreaterThanOrEqual(240);
});

test("a toast stays readable when the whole workspace is drawn larger", async ({
  page,
}) => {
  // The band the first version of this got wrong. `data-narrow` is set from
  // the viewport divided by the text scale, and the rule meant to stand the
  // panel-aware width down sat in a raw viewport query, so at 130 per cent the
  // two disagreed over eighty pixels of width: the host was measured at 78
  // across, which clears the panel and says nothing. Both read the same signal
  // now.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        textScale: 130,
        unitsChosen: true,
        seenWelcome: true,
        seenReveal: true,
      }),
    );
  });

  // Both sides of the narrow edge. 884 used to be inside a band where a raw
  // media query and `data-narrow` disagreed, and this asserted the toast
  // cleared the panel at all three because the panel was still drawn as a
  // side panel there whatever `data-narrow` said. Those queries read the
  // scaled width now, so at 130 per cent 884 and 800 are the narrow layout,
  // where the panel covers the map on purpose and a toast over it is the
  // design rather than a collision. What has to hold at every width is that
  // the toast is readable and on screen, and that it clears the panel
  // wherever the panel is still a panel.
  // 885 and 881 rather than 884, which divides by 1.3 to exactly 680.0 and
  // leaves the narrow test deciding on `680 <= 680`. One unit in the last
  // place the other way and it lands on the other side of the edge.
  for (const width of [900, 885, 881, 800]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?testMode=1");
    await expect(page.getByRole("application")).toBeVisible();
    await page.getByRole("button", { name: "Commands", exact: true }).click();
    await page.locator('[data-command="surface:upload"]').click();
    const panel = page.getByRole("dialog", { name: "Upload" });
    await expect(panel).toBeVisible();
    await page.locator('.drop-zone input[type="file"]').setInputFiles({
      name: "rubbish.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from("this is not geojson"),
    });
    const toast = page.locator(".toast-host .toast").first();
    await expect(toast).toBeVisible();

    const [over, under, narrow] = await Promise.all([
      toast.boundingBox(),
      panel.locator(".surface-panel__header").boundingBox(),
      page.locator("html").getAttribute("data-narrow"),
    ]);
    expect(
      over!.width,
      `at ${width} the host has collapsed to ${Math.round(over!.width)}`,
    ).toBeGreaterThanOrEqual(240);

    // On screen, wherever it is. The failure this test was written for put
    // the host at an x of minus 34.
    const room = page.viewportSize()!.width;
    expect(
      over!.x,
      `at ${width} the toast starts at ${over!.x}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      over!.x + over!.width,
      `at ${width} the toast ends at ${over!.x + over!.width} of ${room}`,
    ).toBeLessThanOrEqual(room + 0.5);

    // And beside the panel wherever the panel is a panel rather than the
    // whole surface.
    if (!(narrow ?? "").split(" ").includes("680")) {
      expect(
        over!.x + over!.width <= under!.x + 0.5,
        `at ${width} the toast ${JSON.stringify(over)} runs into the panel ${JSON.stringify(under)}`,
      ).toBe(true);
    }
  }
});

test("the map style cards do not wrap into ragged rows", async ({ page }) => {
  // The panel is 336 pixels wide at every window width, so each card's text
  // column is about ninety. "Match the theme", the default and the first card
  // a reader sees, wrapped its title onto two lines and its detail onto five,
  // standing seven lines tall beside "Greyscale / Quiet labels" at two. The
  // clipping test cannot see it because nothing is clipped, which is why this
  // measures rather than looks.
  for (const [language, copy] of [
    ["en", en],
    ["es", es],
    ["fr", fr],
  ] as const) {
    // An init script rather than a poke after the load, and the stacking is
    // the point rather than a flaw: Playwright runs them in registration
    // order, so the language this iteration asks for is the last one written
    // and wins. Poking `localStorage` after the page is up races the
    // workspace's own debounced persist, which writes the settings it already has
    // back over it: measured, the French iteration came up in Spanish and the
    // panel button could not be found by name.
    await page.addInitScript((which: string) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({
          schemaVersion: 3,
          language: which,
          unitsChosen: true,
          seenWelcome: true,
          seenReveal: true,
        }),
      );
    }, language);
    await page.goto("/?testMode=1");
    await expect(page.getByRole("application")).toBeVisible();
    // Named out of the catalogue rather than in English, because the button
    // this opens from is translated like everything else.
    await page
      .getByRole("button", { name: copy["panel.mapType"], exact: true })
      .click();
    const grid = page.locator(".map-style-grid");
    await expect(grid.locator(".map-style-card").first()).toBeVisible();

    const measured = await grid.evaluate((node) => {
      const cards = Array.from(
        node.querySelectorAll<HTMLElement>(".map-style-card"),
      );
      const rest = cards
        .slice(1)
        .map((card) => card.getBoundingClientRect().height);
      return {
        firstSpans:
          Math.abs(
            (cards[0]?.getBoundingClientRect().width ?? 0) -
              node.getBoundingClientRect().width,
          ) < 2,
        tallest: Math.max(...rest),
        shortest: Math.min(...rest),
        count: cards.length,
      };
    });

    expect(measured.count, language).toBeGreaterThan(4);
    // The one card with something to explain gets the width to explain it in.
    expect(measured.firstSpans, language).toBe(true);
    // And every pair under it stands within a line of the pair beside it. A
    // line of the detail type is fourteen pixels.
    // No spread assertion here, and its absence is deliberate: the grid gives
    // every row the height of its tallest card, so the spread is zero by
    // construction and an assertion on it could never fail. What that levelling
    // costs is that one card's copy growing a line grows the whole section, and
    // a ceiling is what sees that.
    //
    // Ninety-six is a statement about the default text scale, which is what
    // this test runs at: two title lines and two detail lines with the card's
    // own padding, against a measured 60 in English, 74 in Spanish and 76 in
    // French. At 130 per cent the same cards measure 78, 96 and 99, so a
    // ceiling that covered every scale would be too loose to catch anything.
    expect(
      measured.tallest,
      `${language}: every card stands ${measured.tallest} tall`,
    ).toBeLessThanOrEqual(96);
  }
});

test("the workspace never grows wider than the window it is drawn in", async ({
  page,
}) => {
  // Once anything can scroll the shell sideways, every absolutely positioned
  // piece of map chrome moves with it and some of it goes off the left edge:
  // the toast host was measured at an x of minus 34 at 681 pixels and 130 per
  // cent. Nothing was watching for the overflow itself, only for the pieces
  // that fell off it, so each one got its own fix and the cause stayed.
  for (const scale of [100, 130]) {
    await page.addInitScript((textScale) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({
          schemaVersion: 3,
          textScale,
          unitsChosen: true,
          seenWelcome: true,
          seenReveal: true,
        }),
      );
    }, scale);
    // 981 and 681 are here because they are where the shell actually
    // overflowed worst before the breakpoints were fixed: 26 pixels over at
    // 981 and 34 at 681, against 20 at 700. A list that held only 700 was
    // catching the smallest of the four.
    for (const width of [1440, 1024, 981, 900, 800, 700, 681, 660]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/?testMode=1");
      await expect(page.getByRole("application")).toBeVisible();
      // Opened, because a panel is the widest thing the shell ever holds and
      // the measured overflow was with one open.
      await page.getByRole("button", { name: "Commands", exact: true }).click();
      await page.locator('[data-command="surface:upload"]').click();
      await expect(page.getByRole("dialog", { name: "Upload" })).toBeVisible();
      // After the panel has finished sliding in. It enters on a translateX of
      // eight pixels, so measuring while that is running reports the panel
      // eight past the shell's edge at every width, which is an animation
      // rather than an overflow.
      await page.evaluate(() =>
        Promise.all(
          // Swallowed on purpose: `finished` rejects with an AbortError when
          // an animation is cancelled, which turns a cancelled panel entry
          // into a test error rather than a measurement. What is wanted here
          // is only that nothing is still moving.
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );

      const measured = await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        const root = document.documentElement;
        return {
          shell: shell
            ? { scroll: shell.scrollWidth, client: shell.clientWidth }
            : null,
          root: { scroll: root.scrollWidth, client: root.clientWidth },
        };
      });
      const where = `${width}px at ${scale}%`;
      expect(measured.shell, where).not.toBeNull();
      // A pixel of slack for sub-pixel layout, and no more: the measured
      // failure was 34 over.
      expect(measured.shell!.scroll, `shell at ${where}`).toBeLessThanOrEqual(
        measured.shell!.client + 1,
      );
      expect(measured.root.scroll, `document at ${where}`).toBeLessThanOrEqual(
        measured.root.client + 1,
      );
    }
  }
});

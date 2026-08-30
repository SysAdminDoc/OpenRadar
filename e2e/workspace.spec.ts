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
        <Dimension name="time" units="ISO8601" default="2026-08-30T05:40:00.000Z">2026-08-30T05:20:00.000Z,2026-08-30T05:30:00.000Z,2026-08-30T05:40:00.000Z</Dimension>
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

test.beforeEach(async ({ page }) => {
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
  await expect(timeline).toContainText("3 radar frames");
  await page.getByRole("button", { name: "Globe", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Flat", exact: true }),
  ).toBeVisible();
  await expect(timeline).toContainText("3 radar frames");
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
  await scrubber.fill("2");

  const panes = page.getByRole("application");
  const compare = page.locator(".pane-compare small");
  const live = (await compare.textContent()) ?? "";
  expect(live.length).toBeGreaterThan(0);
  await expect(panes.nth(1)).toHaveAttribute("data-radar-frame", "1788068400");

  await page.getByRole("button", { name: "6 back", exact: true }).click();
  await expect(compare).not.toHaveText(live);
  await expect(panes.first()).toHaveAttribute("data-radar-frame", "1788068400");
  await expect(panes.nth(1)).toHaveAttribute("data-radar-frame", "1788067200");

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

  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByText(/NWS RIDGE II/).first()).toBeVisible();
  await expect(page.getByText(/returned 503/)).toBeVisible();
});

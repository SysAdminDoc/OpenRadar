import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * The layout somebody streaming the app puts on the screen.
 *
 * Two sizes, because that is what a stream is captured at: 1080p, which is
 * what almost everybody sends, and 1440p for the ones who do not. Anything
 * checked here has to hold at both, since a strip that is legible on one and
 * cut off on the other is worse than no mode at all.
 */
const SIZES = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
];

async function enterCapture(page: Page) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("capture");
  await page.locator('[data-command="capture"]').click();
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

for (const size of SIZES) {
  test(`hides what the streamer operates and keeps what a viewer needs at ${size.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const bar = page.locator("[data-capture-bar]");
    await expect(bar).toBeHidden();

    await enterCapture(page);
    await expect(bar).toBeVisible();

    // Everything the streamer operates is gone.
    for (const gone of [
      ".top-status",
      ".command-bar",
      ".radar-timeline",
      ".zoom-controls",
      ".map-watermark",
      ".source-attribution",
      ".toast-host",
    ]) {
      await expect(page.locator(gone)).toBeHidden();
    }

    // And the credit is not among them. These services publish for nothing
    // and a stream is where the credit reaches people who never see the app.
    const credit = bar.locator(".capture-bar__credit");
    await expect(credit).toBeVisible();
    await expect(credit).toContainText("OpenRadar");
    await expect(credit).toContainText("OpenStreetMap");

    // Large enough to survive being scaled down and compressed. Sixteen
    // pixels is the floor a caption is legible at after a stream has been
    // through 720 and a bitrate, and the clock is the one people read at a
    // glance so it is well past it.
    for (const [selector, floor] of [
      [".capture-bar__clock", 22],
      [".capture-bar__place", 15],
      [".capture-bar__credit", 13],
    ] as const) {
      const size = await bar
        .locator(selector)
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(size, selector).toBeGreaterThanOrEqual(floor);
    }

    // The strip stays across the top and never eats the frame. A streamer
    // puts their own overlay along the bottom, so the bottom stays theirs.
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeCloseTo(size.width, 0);
    expect(box!.y).toBe(0);
    expect(box!.height).toBeLessThan(size.height * 0.16);
  });
}

test("hides the chrome that only appears in some states", async ({ page }) => {
  const pane = page
    .getByRole("application", { name: "Interactive weather map" })
    .first();

  // Conditional chrome, which is why a first pass missed it: the satellite
  // chip needs the satellite layer and the cursor readout needs a pointer
  // over the map. The readout is the worst of them, because it lands in the
  // lower-right strip this mode promises to leave for the streamer's own
  // overlay.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Satellite/ }).check();
  await page.getByRole("button", { name: "Close Layers" }).click();
  await pane.hover();
  await expect(page.locator(".satellite-chip")).toBeVisible();
  await expect(page.locator(".map-readout")).toBeVisible();

  await enterCapture(page);
  await expect(page.locator("[data-capture-bar]")).toBeVisible();
  await pane.hover();

  await expect(page.locator(".satellite-chip")).toBeHidden();
  await expect(page.locator(".map-readout")).toBeHidden();
});

test("hides the compare controls a second pane brings", async ({ page }) => {
  // They sit at the top right, which is where the alert badge is.
  await page.getByRole("button", { name: "Dual Pane", exact: true }).click();
  await expect(page.locator(".pane-compare")).toBeVisible();

  await enterCapture(page);
  await expect(page.locator("[data-capture-bar]")).toBeVisible();
  await expect(page.locator(".pane-compare")).toBeHidden();
});

test("disarms a tool on the way in, whose only control it hides", async ({
  page,
}) => {
  // The tool readout holds the only Clear button, and the mode hides it. A
  // tool left armed could be drawn into the capture with nothing to undo it,
  // and the click that drew it opened a panel that appeared on the way out.
  await page.getByRole("button", { name: "Range", exact: true }).click();
  await expect(page.locator(".tool-hud")).toBeVisible();

  await enterCapture(page);
  await expect(page.locator("[data-capture-bar]")).toBeVisible();
  await expect(page.locator(".tool-hud")).toBeHidden();

  await page.getByRole("button", { name: "Leave capture layout" }).click();
  // Not merely hidden: put away, so nothing is armed behind a control that
  // was not on screen.
  await expect(page.locator(".tool-hud")).toBeHidden();
});

test("puts the workspace back exactly as it was", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  // A layer switched on and the map moved, so leaving the mode has something
  // to be wrong about beyond the chrome coming back.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Earthquakes/ }).check();
  await page.getByRole("button", { name: "Close Layers" }).click();
  const before = await pane.getAttribute("data-camera");

  await enterCapture(page);
  await expect(page.locator("[data-capture-bar]")).toBeVisible();

  await page.getByRole("button", { name: "Leave capture layout" }).click();
  await expect(page.locator("[data-capture-bar]")).toBeHidden();

  // Every piece of chrome the mode hid is back, and it is hidden by an
  // attribute rather than unmounted, so there is nothing to rebuild.
  for (const back of [
    ".top-status",
    ".command-bar",
    ".radar-timeline",
    ".zoom-controls",
    ".source-attribution",
  ]) {
    await expect(page.locator(back)).toBeVisible();
  }
  // And the mode touched no setting on the way through.
  expect(await pane.getAttribute("data-camera")).toBe(before);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Earthquakes/ }),
  ).toBeChecked();
});

test("draws the same map it drew before", async ({ page }) => {
  // The mode is a layout. Nothing about the data or the camera moves, because
  // a capture mode that redrew the weather would be a second renderer to keep
  // honest.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const before = {
    camera: await pane.getAttribute("data-camera"),
    layers: await pane.getAttribute("data-layer-stack"),
  };

  await enterCapture(page);
  await expect(page.locator("[data-capture-bar]")).toBeVisible();

  expect(await pane.getAttribute("data-camera")).toBe(before.camera);
  expect(await pane.getAttribute("data-layer-stack")).toBe(before.layers);
});

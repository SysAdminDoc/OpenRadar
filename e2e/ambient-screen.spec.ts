import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";
import { contrast } from "./support/contrast";

/**
 * The workspace as something to leave on a second monitor.
 *
 * What is worth holding in the real workspace: that it fills the window and
 * keeps the time, the place and the source on screen; that it is entered
 * deliberately and never on its own by default; that a warning where the
 * reader watches takes it down; and that leaving it puts everything back.
 */

const HOME: [number, number] = [-96.8, 32.78];

/**
 * @param radar Leave the mosaic off, for a test about what is under it. The
 * fixture's radar tile is a one-pixel opaque PNG stretched over the whole map,
 * so with the layer on every pixel of the canvas is that tile at the layer's
 * own opacity and nothing can be measured against the basemap.
 */
async function start(page: Page, warning = false, radar = true) {
  await page.addInitScript((withRadar) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        catchUp: false,
        curiosities: false,
        radar: { enabled: withRadar },
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
  }, radar);
  await routeWorkspace(page);
  await stubHost(
    page,
    "https://mapservices.weather.noaa.gov/**",
    async (route) => {
      const [lon, lat] = HOME;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: warning
            ? [
                {
                  type: "Feature",
                  geometry: {
                    type: "Polygon",
                    coordinates: [
                      [
                        [lon - 0.2, lat - 0.2],
                        [lon + 0.2, lat - 0.2],
                        [lon + 0.2, lat + 0.2],
                        [lon - 0.2, lat + 0.2],
                        [lon - 0.2, lat - 0.2],
                      ],
                    ],
                  },
                  properties: {
                    prod_type: "Tornado Warning",
                    sig: "W",
                    wfo: "FWD",
                    issuance: new Date(Date.now() - 60_000).toISOString(),
                    expiration: new Date(Date.now() + 3_600_000).toISOString(),
                  },
                },
              ]
            : [],
        }),
      });
    },
  );
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

async function enter(page: Page) {
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="ambient-screen"]').click();
}

test("is entered deliberately and never on its own", async ({ page }) => {
  await start(page);
  // Nothing has taken the workspace over: the default is never.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();

  await enter(page);
  const readout = page.locator("[data-ambient-readout]");
  await expect(readout).toBeVisible();
  // The time, the place, and what the map is showing.
  await expect(readout).toContainText("Casa");
  await expect(readout).toContainText(/\d/);
  // And nothing else: the chrome is gone.
  await expect(page.locator(".command-bar")).toBeHidden();
});

test("puts the workspace back without rebuilding it", async ({ page }) => {
  await start(page);
  // A mark on the map element itself. Nothing is unmounted by this mode, so
  // the same node has to come back: a remounted map is a new WebGL context,
  // a refetched loop and a lost camera.
  await page.evaluate(() => {
    document
      .querySelector('[role="application"]')
      ?.setAttribute("data-was-here", "1");
  });

  await enter(page);
  await expect(page.locator("[data-ambient-readout]")).toBeVisible();
  await expect(page.locator(".command-bar")).toBeHidden();

  // The way out is on the readout itself: the command bar it was reached
  // from is one of the things the mode hides, and this project has no
  // keyboard shortcuts.
  await page
    .getByRole("button", { name: "Leave the full-screen view" })
    .click();

  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
  await expect(page.locator('[role="application"]')).toHaveAttribute(
    "data-was-here",
    "1",
  );
});

test("stands aside for a warning where you watch", async ({ page }) => {
  await start(page, true);
  // The positive control: the warning really did land.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await enter(page);
  // The whole point of the app is the thing that just happened, and a second
  // monitor showing a clean loop through it hides the app's reason to exist.
  await expect(page.locator("[data-ambient-readout]")).toHaveCount(0);
  await expect(page.locator(".command-bar")).toBeVisible();
});

test("the second-monitor setting reads like the switches above it", async ({
  page,
}) => {
  // `.settings-field` had no rule in the stylesheet at all, so this setting's
  // title rendered inline at 16px beside its detail at 13px in one run-on
  // paragraph, under a run of switches whose titles are 12px with the detail
  // on its own line at 10px. It was the one part of Settings that looked
  // unfinished.
  await start(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const setting = page.locator("[data-ambient-screen-setting]");
  await setting.scrollIntoViewIfNeeded();
  await expect(setting).toBeVisible();

  // Measured against the switches it actually sits under, and on every
  // figure that was wrong rather than only the two easy ones. The first pass
  // mirrored the bare `.toggle-row`, but every switch in this panel is a
  // `.toggle-row--plain` inside a `.surface-panel`, and both add overrides:
  // the block came out indented four pixels past every switch, its detail a
  // point smaller with the wrong line height, and it was the only row in the
  // panel with no rule under it. The old assertions passed over all three.
  const shape = await setting.evaluate((node) => {
    const row = node.parentElement!.querySelector(".toggle-row")!;
    const read = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        size: style.fontSize,
        leading: style.lineHeight,
        display: style.display,
      };
    };
    const box = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        // The title's own edge, not the block's: padding moves the words and
        // leaves the container where it was, so measuring the container said
        // nothing about the four pixels this got wrong.
        left: element.querySelector("strong")!.getBoundingClientRect().left,
        rule: `${style.borderBottomWidth} ${style.borderBottomColor}`,
      };
    };
    return {
      title: read(node.querySelector("strong")!),
      detail: read(node.querySelector("small")!),
      rowTitle: read(row.querySelector("strong")!),
      rowDetail: read(row.querySelector("small")!),
      field: box(node),
      row: box(row),
    };
  });
  expect(shape.title.size).toBe(shape.rowTitle.size);
  expect(shape.detail.display).toBe("block");
  expect(shape.detail.size).toBe(shape.rowDetail.size);
  expect(shape.detail.leading).toBe(shape.rowDetail.leading);
  expect(shape.field.left).toBe(shape.row.left);
  expect(shape.field.rule).toBe(shape.row.rule);
});

test("keeps the source line readable over a light basemap", async ({
  page,
}) => {
  // The clock flips to dark ink over a light map and the line under it did
  // not: it declares its own colour, so it beat the inheritance and stayed
  // pale grey on a white halo. About 1.2:1 over the ocean, against ten for
  // the clock beside it. That line is what the view exists to show.
  //
  // Without the mosaic, because this is a question about the basemap: the
  // fixture's radar tile is one opaque pixel stretched over the world, so
  // with the layer on every sample is that tile at its own opacity.
  await start(page, false, false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await enter(page);

  const readout = page.locator("[data-ambient-readout]");
  await expect(readout).toBeVisible();
  // The positive control. Without it a readout that never got the attribute,
  // or a basemap that resolved dark, would pass every ratio below for the
  // wrong reason.
  await expect(readout).toHaveAttribute("data-over-light", "1");

  // The line has to be on screen before its colour means anything: it is a
  // flex child, so with no source yet it keeps the container's width and no
  // height at all, and a rectangle of no height samples whatever single row
  // of pixels it lands on.
  await expect(readout.locator("small")).toContainText(/\w/);

  const measured = await page.evaluate(() => {
    const line = document.querySelector("[data-ambient-readout] small");
    const clock = document.querySelector("[data-ambient-readout] strong");
    if (!line || !clock) return null;
    const box = line.getBoundingClientRect();
    if (box.height < 8 || box.width < 20) return "the line has no box";
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    // The ground is the map, not a CSS colour: this text is drawn straight
    // over the basemap. Sample what the reader is looking through.
    const target = document.createElement("canvas");
    target.width = canvas.width;
    target.height = canvas.height;
    const context = target.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0);
    // Canvas coordinates, not window ones. The map is inset by the rail and
    // the timeline and its buffer is its own size, so scaling by innerWidth
    // read a rectangle off the bottom of the picture and measured the colour
    // of nothing.
    const frame = canvas.getBoundingClientRect();
    const scale = canvas.width / frame.width;
    const left = Math.round((box.left - frame.left) * scale);
    const top = Math.round((box.top - frame.top) * scale);
    const width = Math.max(1, Math.round(box.width * scale));
    const height = Math.max(1, Math.round(box.height * scale));
    if (
      left < 0 ||
      top < 0 ||
      left + width > target.width ||
      top + height > target.height
    ) {
      return "the line is not over the map";
    }
    const pixels = context.getImageData(left, top, width, height).data;
    // The colour the line mostly sits on. Not the single darkest pixel: one
    // antialiased edge of a coastline is not the ground, and this is a
    // question about the basemap under a label rather than about the worst
    // pixel in the box.
    const counts = new Map<string, number>();
    for (let at = 0; at < pixels.length; at += 4) {
      const alpha = pixels[at + 3];
      // A WebGL readback is premultiplied, so a layer part-way through its
      // fade comes back as the right colour scaled down: the light ground
      // read as rgb(70, 71, 73) while the style was still arriving, which is
      // a dark grey nothing ever painted. Take the colour back out.
      if (alpha === 0) continue;
      const scale = 255 / alpha;
      const key = `rgb(${Math.round(pixels[at] * scale)}, ${Math.round(
        pixels[at + 1] * scale,
      )}, ${Math.round(pixels[at + 2] * scale)})`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((one, two) => two[1] - one[1]);
    if (ranked.length === 0) return "nothing is painted under the line";
    return {
      line: getComputedStyle(line).color,
      clock: getComputedStyle(clock).color,
      ground: ranked[0][0],
      spread: ranked.slice(0, 3).map(([colour]) => colour),
      // In the failure message, because a ground nothing in the style paints
      // means a layer is drawn over the whole map and the ratio is a fact
      // about that layer rather than about the basemap.
      drawn: document.querySelector(".map-viewport")?.getAttribute("data-layer-stack") ?? "",
    };
  });

  expect(measured, "the line could not be measured over the map").not.toBeNull();
  if (typeof measured === "string" || measured === null) {
    throw new Error(`the source line could not be sampled: ${measured}`);
  }
  const ratio = contrast(measured.line, measured.ground);
  expect(
    ratio,
    `the source line reads at ${ratio.toFixed(2)}:1 over ${measured.ground}, under ${measured.spread.join(" ")}, drawn ${measured.drawn}`,
  ).toBeGreaterThanOrEqual(4.5);
  // Still quieter than the clock, which is the hierarchy this always had.
  expect(contrast(measured.clock, measured.ground)).toBeGreaterThan(ratio);
});

import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

// The snowfall analysis is decoded natively, because the office publishes a
// floating point GeoTIFF with no CORS headers on it. So the native side is
// stood in for here and the test is about what the workspace does with an
// answer: which window it asks for, what the key beside the map says, and
// whether a reader is ever shown one window's total under another's name.

const LAYER = "openradar-snowfall";

/** A one-pixel picture, which is all a pinned image source needs to exist. */
const PICTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/**
 * The native side, answering the way it does.
 *
 * Every window gets its own valid time, so the legend naming the wrong one is
 * visible rather than plausible. Anything else the workspace asks for is
 * answered with nothing: this window is a browser with a fake runtime bolted
 * on, not a desktop build.
 */
async function fakeNative(page: Page) {
  await page.addInitScript((picture: string) => {
    const asked: string[] = [];
    (window as unknown as { __snowfallAsked: string[] }).__snowfallAsked =
      asked;
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string) => path,
      transformCallback: (callback: unknown) => callback,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command !== "snowfall_analysis") return null;
        const window_ = String(args.window);
        asked.push(window_);
        const valid = {
          "24h": "2026-09-09T12:00:00+00:00",
          "48h": "2026-09-09T00:00:00+00:00",
          "72h": "2026-09-08T12:00:00+00:00",
        }[window_];
        if (!valid) throw new Error(`${window_} is not a snowfall window`);
        // The three-day file is the big one and the office is slow with it.
        // A wait here is what makes the gap between asking and answering
        // long enough to see, which is the whole of the second test.
        if (window_ === "72h") {
          await new Promise((wake) => setTimeout(wake, 1200));
        }
        return {
          hours: Number(window_.replace("h", "")),
          valid,
          west: -126,
          south: 21,
          east: -66,
          north: 55,
          image: picture,
          bands: [
            { inches: 0.1, color: "#dbeafe" },
            { inches: 1, color: "#93c5fd" },
            { inches: 48, color: "#fed7aa" },
          ],
          attribution:
            "NOAA National Operational Hydrologic Remote Sensing Center",
          attributionUrl: "https://www.nohrsc.noaa.gov/snowfall/",
        };
      },
    };
  }, PICTURE);
}

async function turnOn(page: Page) {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".toggle-row")
    .filter({ hasText: "Snowfall" })
    .getByRole("checkbox")
    .check();
}

test.beforeEach(async ({ page }) => {
  await fakeNative(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1&lon=-95&lat=42&zoom=5&bearing=0&pitch=0");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("draws the day's total, and says when it was analysed and whose it is", async ({
  page,
}) => {
  await turnOn(page);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));

  // A day is what the reader gets without asking, which is the window people
  // mean when they ask how much fell.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __snowfallAsked: string[] }).__snowfallAsked,
      ),
    )
    .toEqual(["24h"]);

  const legend = page.locator("[data-snowfall-legend]");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("24 hours");
  // The scale the picture was painted with, read as ranges rather than as
  // bare numbers a reader has to work out the meaning of.
  await expect(legend).toContainText("0.1 in to 1 in");
  await expect(legend).toContainText("48 in and more");
  // The two the item asks for: when the analysis was valid, and the office.
  await expect(legend).toContainText("National Operational Hydrologic");
  await expect(
    legend.getByRole("link", { name: /Remote Sensing Center/ }),
  ).toHaveAttribute("href", "https://www.nohrsc.noaa.gov/snowfall/");
});

test("changes window without ever labelling one total as another", async ({
  page,
}) => {
  await turnOn(page);
  const legend = page.locator("[data-snowfall-legend]");
  await expect(legend).toContainText("24 hours");
  const dayValid = await legend.locator("small").innerText();

  await page
    .locator("[data-snowfall-window]")
    .getByRole("button", { name: "72 hours" })
    .click();

  // While the three-day total is on its way there is no key at all, because
  // the day's picture is not an answer to the question now being asked. The
  // failure this guards is the day's total left on the map for the second
  // and a bit it takes, under a legend reading 72 hours.
  await expect(legend).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __snowfallAsked: string[] }).__snowfallAsked,
      ),
    )
    .toEqual(["24h", "72h"]);
  await expect(legend).toContainText("72 hours");
  // And the analysis it names is a different one: three days back is valid a
  // day earlier than one day back, which a legend carrying only a time of
  // day could not say. Both read "8:00 AM EDT" before the date went on.
  await expect(legend.locator("small")).not.toHaveText(dayValid);
  await expect(page.locator("[data-snowfall-window]")).toHaveAttribute(
    "data-snowfall-window",
    "72h",
  );
});

test("takes the picture off the map when the layer goes off", async ({
  page,
}) => {
  await turnOn(page);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));

  await page
    .locator(".toggle-row")
    .filter({ hasText: "Snowfall" })
    .getByRole("checkbox")
    .uncheck();

  await expect(pane).not.toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  await expect(page.locator("[data-snowfall-legend]")).toHaveCount(0);
});

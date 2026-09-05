import { expect, test } from "@playwright/test";

/**
 * The picture the README leads with, taken the same way every time.
 *
 * It had been captured by hand once and then went stale: the file in the repo
 * predated the light-theme repairs, French, the rail rework and the accent
 * changes, and a first reader was looking at an app that no longer existed.
 * Written down as a run rather than a habit, so the next visual change can
 * re-take it in one command instead of somebody remembering how it was framed.
 *
 * Skipped unless asked for. It writes a committed file, which is not something
 * an ordinary suite run should do, and the map underneath is live weather: a
 * pixel comparison would fail on the sky.
 *
 * It is also the one thing here that does NOT stub the services. The rest of
 * the suite routes them so a run is deterministic, and a picture taken that
 * way is a picture of a black rectangle where the map should be: no basemap
 * tiles, no mosaic, and a stale-frame warning across the bottom. A screenshot
 * of an app with no map in it is worse than an out-of-date one, because it
 * looks deliberate.
 *
 *     OPENRADAR_SHOOT=1 npx playwright test e2e/screenshot.spec.ts --project=chromium
 */
const WANTED = Boolean(process.env.OPENRADAR_SHOOT);

/** What the README's alt text describes, and what the listing points at. */
const SHOT = "assets/screenshots/openradar-main.png";

/** How long the live basemap and the mosaic are given to arrive. */
const TILES_MS = 8_000;

test.describe("the README's picture", () => {
  test.skip(!WANTED, "set OPENRADAR_SHOOT=1 to re-take it");
  // The width the layout questions are asked at, and the shape the listing
  // and the README were written around.
  test.use({ viewport: { width: 1487, height: 1058 } });

  test("is the dark workspace with the alerts panel open", async ({ page }) => {
    // The greeting and the first-run hints are for a first run, and this is
    // not one. Written before the app loads rather than dismissed after, so
    // nothing has to be clicked out of the way of the picture.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({
          schemaVersion: 2,
          seenWelcome: true,
          seenReveal: true,
          layers: { counties: true },
        }),
      );
    });
    // Des Moines, north up, at a zoom where the mosaic and the county lines
    // both read: the same camera every time, so two captures differ by what
    // changed in the app rather than by where somebody had panned to.
    await page.goto("/?lon=-93.7&lat=41.7&zoom=6&bearing=0&pitch=0");
    await expect(page.getByRole("application")).toBeVisible();

    await page.getByRole("button", { name: "Alerts", exact: true }).click();
    await expect(page.locator(".surface-panel")).toBeVisible();

    // The map has to have arrived. A capture taken while the basemap is still
    // coming down is the black rectangle this was written to stop shipping.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await page.waitForTimeout(TILES_MS);
    const drawn = await page.evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
      if (!canvas) return 0;
      const shrunk = document.createElement("canvas");
      shrunk.width = 64;
      shrunk.height = 64;
      const context = shrunk.getContext("2d");
      if (!context) return 0;
      context.drawImage(canvas, 0, 0, 64, 64);
      const { data } = context.getImageData(0, 0, 64, 64);
      const shades = new Set<string>();
      for (let at = 0; at < data.length; at += 4) {
        shades.add(`${data[at]},${data[at + 1]},${data[at + 2]}`);
      }
      return shades.size;
    });
    expect(
      drawn,
      "the map is one flat colour, so the tiles never arrived",
    ).toBeGreaterThan(20);

    await page.screenshot({ path: SHOT });

    // A capture of a window that never finished laying out is worse than a
    // stale one, because it looks deliberate.
    const room = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      sideways:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }));
    expect(room).toEqual({ width: 1487, height: 1058, sideways: 0 });
  });
});

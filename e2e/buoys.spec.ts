import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

// The buoys are the marine map's one measurement. Everything else out there is
// a model; this is a hull in the water saying what the wind over it and the
// sea under it are actually doing. The service is stood in for here so the
// test is about what the map does with an answer rather than about whether
// anything was blowing on the day it runs.

const LAYER = "openradar-overlay-buoys-circle";

/**
 * The file the service publishes, in its own shape.
 *
 * Two comment lines, then one station per line in twenty-two whitespace
 * separated columns with `MM` where an instrument had nothing to say. The
 * first buoy sits exactly at the middle of the view the test opens, so a click
 * at the centre of the pane is a click on it.
 */
const FILE = `#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
41008    31.400  -80.600 2026 09 10 06 50 210   5.0   6.0  1.2   6  4.5 200 1016.3  +0.4  26.7  28.1  24.4  MM     MM
41009    30.900  -80.900 2026 09 10 06 50 190   9.0    MM  2.4   8  5.5 190 1012.1  -1.2  27.1  29.0  25.0  MM     MM
`;

async function stubBuoys(page: Page, body: string, status = 200) {
  await page.route("**/data/latest_obs/latest_obs.txt*", async (route) => {
    await route.fulfill({ status, contentType: "text/plain", body });
  });
}

async function openAt(page: Page, zoom: number) {
  await page.goto(
    `/?testMode=1&lon=-80.6&lat=31.4&zoom=${zoom}&bearing=0&pitch=0`,
  );
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
}

async function turnOn(page: Page) {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".toggle-row")
    .filter({ hasText: "Buoys" })
    .getByRole("checkbox")
    .check();
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the buoys and says what each one is measuring", async ({
  page,
}) => {
  await stubBuoys(page, FILE);
  await openAt(page, 8);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await turnOn(page);
  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));

  // The buoy at the middle of the view is the one at the centre of the pane.
  await page.keyboard.press("Escape");
  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("41008");
  // The three the item names, in the reader's own units.
  await expect(popup).toContainText("Wind");
  await expect(popup).toContainText("Waves");
  await expect(popup).toContainText("1,016.3 hPa");
});

test("asks for the whole world once, and a pan does not ask again", async ({
  page,
}) => {
  // The acceptance this layer was written to. One file answers every
  // viewport, so moving the map is not a reason to fetch anything.
  await stubBuoys(page, FILE);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("latest_obs.txt")) asked.push(request.url());
  });
  await openAt(page, 8);
  await turnOn(page);
  await page.keyboard.press("Escape");

  await expect.poll(() => asked.length).toBe(1);
  // Nothing about where the reader is looking is in the request either.
  expect(asked[0]).not.toContain("bbox");

  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  // A pan of most of a screen, twice, which on a layer asked for by area
  // would be two more requests.
  for (const step of [1, 2]) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(400 * step);
  }
  expect(asked).toHaveLength(1);
});

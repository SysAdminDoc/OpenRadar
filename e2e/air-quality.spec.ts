import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

// Two layers that answer the question the forecast smoke layer only models:
// what the air is actually like, and where the fire actually is. Both
// services are stood in for here, so these are about what the workspace does
// with an answer rather than about what was burning on the day they run.

const AIRNOW_LAYER = "openradar-overlay-airnow-circle";
const FIRMS_LAYER = "openradar-overlay-firms-circle";

/** The reporting area at the middle of the view, and two others. */
const AIRNOW = `09/10/26|09/09/26||PDT|-1|Y|Y|Chico|CA|39.7596|-121.8210|PM10|19|Good|No||Butte County AQMD
09/10/26|09/10/26|6:00|PDT|0|O|Y|Chico|CA|39.7596|-121.8210|PM2.5|168|Unhealthy|Yes||Butte County AQMD
09/10/26|09/10/26|6:00|PDT|0|O|N|Chico|CA|39.7596|-121.8210|PM10|44|Good|No||Butte County AQMD
09/10/26|09/10/26|6:00|PDT|0|O|Y|Redding|CA|40.5865|-122.3917|PM2.5|61|Moderate|No||Shasta County AQMD
`;

const FIRMS = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
39.8100,-121.7400,325.08,0.44,0.38,2026-09-09,2015,N20,high,2.0NRT,293.94,42.6,D
40.1200,-121.9000,309.42,0.4,0.37,2026-09-09,2015,N20,low,2.0NRT,293.34,1.66,D
`;

async function stub(page: Page, asked: string[]) {
  await page.route("**/airnow/today/reportingarea.dat*", async (route) => {
    asked.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: AIRNOW,
    });
  });
  await page.route("**/data/active_fire/**", async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/csv", body: FIRMS });
  });
}

async function openLayers(page: Page) {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
}

/** The panel has to be open already: pressing Layers again closes it. */
async function check(page: Page, name: string) {
  await page
    .locator(".toggle-row")
    .filter({ hasText: name })
    .getByRole("checkbox")
    .check();
}

async function turnOn(page: Page, name: string) {
  await openLayers(page);
  await check(page, name);
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the monitor reading, its category and the hour it was measured", async ({
  page,
}) => {
  const asked: string[] = [];
  await stub(page, asked);
  await page.goto(
    "/?testMode=1&lon=-121.821&lat=39.7596&zoom=8&bearing=0&pitch=0",
  );
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await turnOn(page, "Air Quality");
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    new RegExp(AIRNOW_LAYER),
  );

  // The area at the middle of the view is the one at the centre of the pane.
  await page.keyboard.press("Escape");
  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("Chico");
  // The index and the agency's own name for the band, which is what every
  // sign and forecast in the country repeats.
  await expect(popup).toContainText("168");
  await expect(popup).toContainText("Unhealthy");
  // The worst pollutant, which is what the index is being reported on. The
  // same area's PM10 row for the same hour is not a second dot.
  await expect(popup).toContainText("PM2.5");
  // The hour the monitor measured, on its own clock and in its own zone.
  await expect(popup).toContainText("6:00");
  await expect(popup).toContainText("PDT");
  await expect(popup).toContainText("Butte County AQMD");
});

test("draws a hot pixel and says it is not a confirmed fire", async ({
  page,
}) => {
  const asked: string[] = [];
  await stub(page, asked);
  await page.goto(
    "/?testMode=1&lon=-121.74&lat=39.81&zoom=8&bearing=0&pitch=0",
  );
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await turnOn(page, "Fire Detections");
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    new RegExp(FIRMS_LAYER),
  );

  await page.keyboard.press("Escape");
  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("NOAA-20");
  await expect(popup).toContainText("high");
  await expect(popup).toContainText("42.6 MW");
  // The one thing this layer has to say on every popup. It sits beside a
  // layer of real fire perimeters somebody walked, and a pixel that was hot
  // when a satellite went over is a different claim entirely.
  await expect(popup).toContainText(/not a confirmed fire/i);
});

test("asks each service once for the whole country, and a pan asks nothing", async ({
  page,
}) => {
  // Both are one file for the whole network, so nothing about where the
  // reader is looking is in either request and moving the map is not a
  // reason to fetch anything.
  const asked: string[] = [];
  await stub(page, asked);
  await page.goto(
    "/?testMode=1&lon=-121.821&lat=39.7596&zoom=8&bearing=0&pitch=0",
  );
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();
  await openLayers(page);
  await check(page, "Air Quality");
  await check(page, "Fire Detections");
  await page.keyboard.press("Escape");

  // One for the monitors, one per spacecraft for the detections.
  await expect.poll(() => asked.length).toBe(3);
  for (const url of asked) {
    expect(url).not.toMatch(/bbox|bounds|lat=|lon=/i);
  }

  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  for (const step of [1, 2]) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(400 * step);
  }
  expect(asked).toHaveLength(3);
});

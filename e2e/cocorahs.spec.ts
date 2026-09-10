import { expect, type Page } from "@playwright/test";
import { routeWorkspace, test } from "./support/fixtures";

// The volunteer gauges are the one rain figure on this map that a person
// measured rather than an instrument estimated. The service is stood in for
// here so the test is about what the workspace asks for and what it says
// about an answer, rather than about whether it rained in Iowa today.

const LAYER = "openradar-overlay-cocorahs-daily";
const HAIL_LAYER = "openradar-overlay-cocorahs-hail";

/** The gauge at the middle of the view the test opens, and two others. */
const DAILY = {
  status: "sucess",
  data: {
    reports: [
      {
        id: "baf82ee3-f3c3-47a0-8b25-e77762bbb8f1",
        st_num: "IA-PK-42",
        st_name: "Des Moines 1.1 NW",
        obs_date: "2026-09-09",
        obs_time: "07:00 AM",
        lat: 41.6,
        lng: -93.6,
        totalpcpn: 2.85,
      },
      {
        id: "02a67e9d-f011-479e-bceb-a02907b170ae",
        st_num: "IA-PK-9",
        st_name: "Ankeny 2.0 E",
        obs_date: "2026-09-09",
        obs_time: "06:45 AM",
        lat: 41.72,
        lng: -93.5,
        totalpcpn: 0.38,
      },
    ],
  },
};

const HAIL = `ObservationDate,ObservationTime,EntryDateTime,StationNumber,StationName,Latitude,Longitude,SmallestSize,AverageSize,LargestSize,DurationMinutes,DurationAccuracy,Timing,StoneConsistency,MoreRainThanHail,HailStarted,LargestHailStarted,MoreRainThanHail,Damage,AngleOfImpact,NumberOfStonesOnPad,DistanceBtwnStonesOnPad,DepthOnGround,DateTimeStamp
2026-09-09, 04:20 PM, 2026-09-09 04:40 PM, IA-PK-11, Urbandale 0.4 S, 41.66, -93.71, 0.250, 0.500, 1.000, 12, 1min, Continuous, Hard, True, After rain, After smaller hail, True, minor leaf damage, , , , , 2026-09-09 10:40 PM
`;

/**
 * Somewhere in the middle of Texas, which is the one state wide enough that a
 * reader can pan three screens across it at this zoom without the view
 * reaching a neighbour. The pan test is about a state being asked for once,
 * and a second state coming into view is a second question rather than the
 * same one repeated.
 */
const TEXAS = {
  status: "sucess",
  data: {
    reports: [
      {
        id: "3f2a82a8-8bbe-4263-bac1-ddc687d26b5a",
        st_num: "TX-MCL-7",
        st_name: "Brady 2.0 N",
        obs_date: "2026-09-09",
        obs_time: "07:00 AM",
        lat: 31.5,
        lng: -99.0,
        totalpcpn: 1.14,
      },
      {
        id: "4f2a82a8-8bbe-4263-bac1-ddc687d26b5a",
        st_num: "TX-MCL-9",
        st_name: "Brady 8.0 W",
        obs_date: "2026-09-09",
        obs_time: "07:10 AM",
        lat: 31.5,
        lng: -102.0,
        totalpcpn: 0.4,
      },
    ],
  },
};

async function stub(page: Page, asked: string[], daily: unknown = DAILY) {
  await page.route("**/export/exportreports.aspx*", async (route) => {
    const url = route.request().url();
    asked.push(url);
    if (url.includes("ReportType=Hail")) {
      await route.fulfill({ status: 200, contentType: "text/csv", body: HAIL });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(daily),
    });
  });
}

async function turnOn(page: Page) {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".toggle-row")
    .filter({ hasText: "Volunteer Gauges" })
    .getByRole("checkbox")
    .check();
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the gauges and says what one measured, and whose clock", async ({
  page,
}) => {
  const asked: string[] = [];
  await stub(page, asked);
  await page.goto("/?testMode=1&lon=-93.6&lat=41.6&zoom=8&bearing=0&pitch=0");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();

  await turnOn(page);
  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  // The hail report is a second kind on the same layer, drawn as a ring
  // rather than a filled dot.
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    new RegExp(HAIL_LAYER),
  );

  // The gauge at the middle of the view is the one at the centre of the pane.
  await page.keyboard.press("Escape");
  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const popup = page.locator(".maplibregl-popup");
  // The station id, which is what the item asks the popup to name.
  await expect(popup).toContainText("IA-PK-42");
  // Where the gauge is, which is a place and not a person. Nothing in this
  // feed carries an observer's name and nothing here asks for one.
  await expect(popup).toContainText("Des Moines 1.1 NW");
  await expect(popup).toContainText("2.85");
  // The observer's own clock, said to be theirs.
  await expect(popup).toContainText("07:00 AM");
  await expect(popup).toContainText(/observer/i);
});

test("asks for the state and nothing about where the reader is looking", async ({
  page,
}) => {
  const asked: string[] = [];
  await stub(page, asked, TEXAS);
  await page.goto("/?testMode=1&lon=-99&lat=31.5&zoom=10&bearing=0&pitch=0");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();
  await turnOn(page);
  await page.keyboard.press("Escape");

  // The rain and the hail, for the one state on screen.
  await expect.poll(() => asked.length).toBe(2);
  for (const url of asked) {
    expect(url).toContain("State=TX");
    // Not a coordinate, a bounding box or a zoom anywhere in it. A two-letter
    // state code is the finest thing this layer tells the service about the
    // reader, and the ledger says so.
    expect(url).not.toMatch(/bbox|lat=|lon=|zoom/i);
  }
  expect(asked.some((url) => url.includes("ReportType=Daily"))).toBe(true);
  expect(asked.some((url) => url.includes("ReportType=Hail"))).toBe(true);
});

test("asks a state once, however far the reader pans inside it", async ({
  page,
}) => {
  // The acceptance this layer was written to. The framework re-runs the fetch
  // whenever the view leaves the box the last answer was asked for, and over
  // one state that is the same state again: a reader following a line of
  // storms across Iowa pulled the whole state's reports every few seconds.
  const asked: string[] = [];
  await stub(page, asked, TEXAS);
  await page.goto("/?testMode=1&lon=-99&lat=31.5&zoom=10&bearing=0&pitch=0");
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toBeVisible();
  await turnOn(page);
  await page.keyboard.press("Escape");
  await expect.poll(() => asked.length).toBe(2);

  const box = await pane.boundingBox();
  if (!box) throw new Error("the map has no box");
  // Most of a screen, three times, which stays inside Texas and leaves the
  // box the first answer was asked for well behind.
  for (const step of [1, 2, 3]) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(400 * step);
  }
  await expect(pane).toHaveAttribute("data-layer-stack", new RegExp(LAYER));
  expect(asked).toHaveLength(2);
});

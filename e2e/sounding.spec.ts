import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { routeWorkspace } from "./support/fixtures";
import { clipped } from "./support/layout";
import { pseudoize } from "../src/i18n/pseudo";

// A sounding is two sources that must never be mistaken for each other: a
// balloon that went up, and a model's guess at a column of air. Both are
// stood in for here, so what is checked is that the panel draws them, works
// the right numbers out of them, and says which is which.

const RAOB = {
  profiles: [
    {
      station: "KOAX",
      valid: "08/31/2026 00:00:00",
      profile: [
        {
          pres: 1000,
          hght: 52,
          tmpc: null,
          dwpc: null,
          drct: null,
          sknt: null,
        },
        { pres: 970, hght: 300, tmpc: 30, dwpc: 22, drct: 180, sknt: 10 },
        { pres: 925, hght: 780, tmpc: 24, dwpc: 20, drct: 200, sknt: 20 },
        { pres: 850, hght: 1500, tmpc: 20, dwpc: 17, drct: 220, sknt: 25 },
        { pres: 700, hght: 3100, tmpc: 9, dwpc: 2, drct: 240, sknt: 35 },
        { pres: 500, hght: 5800, tmpc: -8, dwpc: -20, drct: 255, sknt: 50 },
        { pres: 300, hght: 9600, tmpc: -38, dwpc: -50, drct: 265, sknt: 70 },
        { pres: 200, hght: 12_400, tmpc: -55, dwpc: -68, drct: 270, sknt: 80 },
        { pres: 100, hght: 16_600, tmpc: -70, dwpc: -82, drct: 280, sknt: 90 },
      ],
    },
  ],
};

const MODEL = {
  hourly: {
    time: ["2026-09-02T00:00"],
    temperature_1000hPa: [28],
    dew_point_1000hPa: [19],
    wind_speed_1000hPa: [8],
    wind_direction_1000hPa: [170],
    geopotential_height_1000hPa: [90],
    temperature_850hPa: [18],
    dew_point_850hPa: [13],
    wind_speed_850hPa: [18],
    wind_direction_850hPa: [200],
    geopotential_height_850hPa: [1490],
    temperature_700hPa: [7],
    dew_point_700hPa: [-2],
    wind_speed_700hPa: [26],
    wind_direction_700hPa: [230],
    geopotential_height_700hPa: [3110],
    temperature_500hPa: [-10],
    dew_point_500hPa: [-24],
    wind_speed_500hPa: [42],
    wind_direction_500hPa: [250],
    geopotential_height_500hPa: [5840],
    temperature_300hPa: [-40],
    dew_point_300hPa: [-55],
    wind_speed_300hPa: [68],
    wind_direction_300hPa: [265],
    geopotential_height_300hPa: [9580],
    temperature_200hPa: [-56],
    dew_point_200hPa: [-70],
    wind_speed_200hPa: [80],
    wind_direction_200hPa: [270],
    geopotential_height_200hPa: [12_380],
  },
};

async function stubSoundings(page: Page, options: { raob?: unknown } = {}) {
  await page.route("**/json/raob.py*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.raob ?? RAOB),
    });
  });
  await page.route("**/v1/gfs*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MODEL),
    });
  });
}

async function openSounding(page: Page, language?: "pseudo" | "es") {
  await page.goto("/?testMode=1&lon=-93.6&lat=41.6&zoom=7&bearing=0&pitch=0");
  // By role alone: the map's own label is translated too, and in the
  // pseudolocale it is accented past recognition.
  await expect(page.getByRole("application").first()).toBeVisible();
  // The palette rather than a command-bar button: this one is for readers who
  // came looking for it. The keywords carry the untranslated words too, so
  // "skew" finds it whatever language the workspace is in.
  // No keyboard shortcut in this app by design, so the palette is opened the
  // way a reader opens it: the button on the command bar, whose label is in
  // whatever language the workspace is in.
  // The button's label is translated, and the pseudolocale accents it past
  // recognition, so the label comes from the app's own catalogue rather than
  // from a string typed here.
  const label =
    language === "es"
      ? "Comandos"
      : language === "pseudo"
        ? pseudoize("Commands")
        : "Commands";
  await page
    .locator(`.command-bar button[aria-label="${label}"]`)
    .first()
    .click();
  await page.locator("input[type=search]").last().fill("skew");
  await page.locator('[data-command="surface:sounding"]').click();
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
});

test("draws the nearest balloon and what can be read off it", async ({
  page,
}) => {
  await stubSoundings(page);
  await openSounding(page);

  // Which of the two this is, before anything read off it.
  const source = page.locator(".sounding-source");
  await expect(source).toHaveAttribute("data-sounding-kind", "observed");
  await expect(source).toContainText("A balloon that went up");
  await expect(source).toContainText("Omaha");

  // The chart itself: two traces over the coordinate system, and a parcel.
  const chart = page.locator("[data-sounding-chart]");
  await expect(chart).toHaveAttribute("data-sounding-chart", "observed");
  await expect(chart.locator(".skewt-temperature")).toHaveCount(1);
  await expect(chart.locator(".skewt-dewpoint")).toHaveCount(1);
  await expect(chart.locator(".skewt-parcel")).toHaveCount(1);
  // The panel with a sounding in it. The accessibility gate can open
  // Sounding but not stub a balloon, so all it ever scanned was the "nothing
  // near here" line.
  await expectClean(page, "the sounding panel with a balloon in it");
  // The background is a coordinate system rather than data, and there is a
  // lot of it: isotherms, both families of adiabat, and mixing ratio.
  await expect(chart.locator(".skewt-dry").first()).toBeVisible();
  await expect(chart.locator(".skewt-moist").first()).toBeVisible();
  await expect(chart.locator(".skewt-mixing").first()).toBeVisible();
  // The dewpoint trace is left of the temperature trace, which is what the
  // skew is for.
  const traces = await chart.evaluate((svg) => {
    const read = (selector: string) => {
      const path = svg.querySelector<SVGPathElement>(selector);
      const d = path?.getAttribute("d") ?? "";
      return Number(d.slice(1).split(",")[0]);
    };
    return {
      temperature: read(".skewt-temperature"),
      dewpoint: read(".skewt-dewpoint"),
    };
  });
  expect(traces.dewpoint).toBeLessThan(traces.temperature);

  // The wind, as the circle a forecaster reads turning off.
  await expect(page.locator(".hodograph svg")).toBeVisible();
  await expect(page.locator(".hodograph-trace")).toHaveCount(1);

  // And the numbers, with their assumptions said in the panel rather than
  // left for somebody to guess at.
  const numbers = page.locator(".sounding-numbers");
  await expect(numbers).toContainText("CAPE");
  await expect(numbers).toContainText("J/kg");
  await expect(numbers).toContainText("kt");
  await expect(
    page.getByText(/lifted from the surface, dry to its condensation level/),
  ).toBeVisible();
  await expect(
    page.getByText(/no virtual temperature correction/),
  ).toBeVisible();
});

test("says plainly when the column is a model's guess", async ({ page }) => {
  await stubSoundings(page);
  await openSounding(page);
  await expect(page.locator(".sounding-source")).toHaveAttribute(
    "data-sounding-kind",
    "observed",
  );

  await page
    .getByLabel("Which sounding")
    .getByRole("button", { name: "Forecast" })
    .click();

  // A forecast sounding taken for an observation is the one way this panel
  // could mislead somebody, so it says which it is in words and in the
  // chart's own marker.
  const source = page.locator(".sounding-source");
  await expect(source).toHaveAttribute("data-sounding-kind", "forecast");
  await expect(source).toContainText("A model's guess");
  await expect(page.locator("[data-sounding-chart]")).toHaveAttribute(
    "data-sounding-chart",
    "forecast",
  );
  // The two are never blended: the observed trace is gone, not overlaid.
  await expect(page.locator(".skewt-temperature")).toHaveCount(1);
});

test("says there is nothing rather than drawing an empty chart", async ({
  page,
}) => {
  // A place with no balloon near it in two days, which is what the archive
  // answers with for most of the ocean and some of the west.
  await stubSoundings(page, { raob: { profiles: [] } });
  await openSounding(page);

  await expect(page.getByText(/No balloon near here/)).toBeVisible();
  await expect(page.locator("[data-sounding-chart]")).toHaveCount(0);
});

/**
 * The chart has to survive a language that runs a third longer than the
 * English and one that really does, in both themes.
 *
 * A Skew-T is mostly numbers and axis labels, which is exactly the sort of
 * thing that fits in English and spills everywhere else.
 */
for (const language of ["pseudo", "es"] as const) {
  test(`fits its own labels in ${language}`, async ({ page }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({ schemaVersion: 2, language: value }),
      );
    }, language);
    await stubSoundings(page);
    await openSounding(page, language);

    await expect(page.locator("[data-sounding-chart]")).toBeVisible();
    // Give the chart a moment to lay its labels out.
    await page.waitForTimeout(400);
    // The rail may shorten a caption in the generated language, whose words
    // are a third longer than any reader's, and may not in Spanish.
    const railMayShorten = language === "pseudo";
    expect(await clipped(page, railMayShorten)).toEqual([]);

    // And the same in the other theme, since the chart draws its own colours
    // from the tokens rather than hard-coding a background.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.waitForTimeout(200);
    expect(await clipped(page, railMayShorten)).toEqual([]);
  });
}

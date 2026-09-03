import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { routeWorkspace } from "./support/fixtures";

/** Three models over the same six hours, shaped the way Open-Meteo answers. */
const GUIDANCE = {
  hourly_units: {
    time: "iso8601",
    temperature_2m_gfs_seamless: "°C",
    precipitation_gfs_seamless: "mm",
    wind_speed_10m_gfs_seamless: "km/h",
    temperature_2m_ecmwf_ifs025: "°C",
    precipitation_ecmwf_ifs025: "mm",
    wind_speed_10m_ecmwf_ifs025: "km/h",
    temperature_2m_icon_seamless: "°C",
    precipitation_icon_seamless: "mm",
    wind_speed_10m_icon_seamless: "km/h",
  },
  hourly: {
    time: [
      "2026-08-30T00:00",
      "2026-08-30T03:00",
      "2026-08-30T06:00",
      "2026-08-30T09:00",
    ],
    temperature_2m_gfs_seamless: [26, 27, 28, 29],
    temperature_2m_ecmwf_ifs025: [24, 25, 26, 27],
    temperature_2m_icon_seamless: [25, 26, 27, 28],
    precipitation_gfs_seamless: [0, 1.4, 0, 0],
    precipitation_ecmwf_ifs025: [0, 0.1, 0, 0],
    precipitation_icon_seamless: [0, 0.6, 0, 0],
    wind_speed_10m_gfs_seamless: [12, 14, 15, 16],
    wind_speed_10m_ecmwf_ifs025: [11, 13, 14, 15],
    wind_speed_10m_icon_seamless: [12, 13, 15, 16],
  },
};

const STATIONS = [
  {
    id: "8761724",
    name: "Grand Isle",
    state: "LA",
    lat: 29.2634,
    lon: -89.9567,
  },
  {
    id: "8518750",
    name: "The Battery",
    state: "NY",
    lat: 40.7006,
    lon: -74.0142,
  },
];

function predictions(from: Date) {
  const rows = [];
  for (let at = 0; at < 6; at += 1) {
    const when = new Date(from.getTime() + (at + 1) * 6 * 3_600_000);
    const stamp = when.toISOString().slice(0, 16).replace("T", " ");
    rows.push({
      t: stamp,
      v: at % 2 ? "0.31" : "2.47",
      type: at % 2 ? "L" : "H",
    });
  }
  return { predictions: rows };
}

async function routeData(page: Page) {
  await page.route("https://api.open-meteo.com/**", async (route) => {
    const url = route.request().url();
    // When each model last ran, which lives beside the data rather than in
    // the forecast reply. GEM answers with a run from months ago, which is
    // what the service actually says and what the panel has to be honest
    // about.
    if (url.includes("/static/meta.json")) {
      const stale = url.includes("cmc_gem");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          last_run_initialisation_time: Math.floor(
            (Date.now() - (stale ? 90 * 24 : 4) * 3_600_000) / 1000,
          ),
          last_run_availability_time: Math.floor(Date.now() / 1000),
          update_interval_seconds: 21600,
        }),
      });
      return;
    }
    // The forecast panel uses the same host, and this spec is not about it.
    if (!url.includes("models=")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(GUIDANCE),
    });
  });
  // The previous runs live on their own host, and answer with the current run
  // and the earlier one side by side on the same hours.
  await page.route(
    "https://previous-runs-api.open-meteo.com/**",
    async (route) => {
      const hourly: Record<string, unknown> = { ...GUIDANCE.hourly };
      for (const [name, values] of Object.entries(GUIDANCE.hourly)) {
        if (name === "time" || !Array.isArray(values)) continue;
        // A degree cooler yesterday, so the change has a direction to show.
        hourly[
          name.replace(
            /^([a-z0-9_]+?)_(gfs|ecmwf|icon|gem)/,
            "$1_previous_day1_$2",
          )
        ] = values.map((value) =>
          typeof value === "number" ? Number((value - 1).toFixed(2)) : value,
        );
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ...GUIDANCE, hourly }),
      });
    },
  );
  await page.route("**/tide-stations.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(STATIONS),
    });
  });
  await page.route(
    "https://api.tidesandcurrents.noaa.gov/**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(predictions(new Date())),
      });
    },
  );
  await page.route(
    "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/StormSurgeRisk/**",
    async (route) => {
      await route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    },
  );
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await routeData(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("puts three models beside each other for the same hours", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Guidance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Guidance" })).toBeVisible();

  // One block per variable, each naming every model that answered.
  const temperature = page.locator("[data-guidance='temperature_2m']");
  await expect(temperature).toBeVisible();
  await expect(temperature.getByRole("row")).toHaveCount(4);
  for (const model of ["GFS", "ECMWF", "ICON"]) {
    await expect(
      temperature.getByRole("rowheader", { name: model }),
    ).toBeVisible();
  }

  // The readings are each model's own, on the hour they belong to.
  const gfs = temperature.getByRole("row").filter({ hasText: "GFS" });
  await expect(gfs).toContainText("26");
  await expect(gfs).toContainText("29");

  // Two degrees apart on a three degree range is agreement worth saying.
  await expect(temperature).toHaveAttribute("data-spread", /0\.\d\d/);

  // And a model turned off leaves the panel, rather than sitting there empty.
  await page.getByRole("button", { name: "ICON", exact: true }).click();
  await expect(
    temperature.getByRole("rowheader", { name: "ICON" }),
  ).toHaveCount(0);
});

test("names the nearest tide station and what the water does next", async ({
  page,
}) => {
  // New Orleans, where Grand Isle is the station on that coast.
  await page.goto("/?testMode=1&lon=-90.07&lat=29.95&zoom=8&bearing=0&pitch=0");
  await page.getByRole("button", { name: "Tides", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tides" })).toBeVisible();

  const station = page.locator("[data-tide-station='8761724']");
  await expect(station).toBeVisible();
  await expect(station).toContainText("Grand Isle, LA");
  await expect(station).toContainText("miles from the map centre");
  // Rising or falling, said plainly, because that is the thing people want.
  await expect(station.locator("[data-tide-state]")).toBeVisible();

  // The turns of the tide, in order, with heights.
  const rows = page.locator(".route-row");
  await expect(rows.first()).toContainText(/High|Low/);
  await expect(rows.first()).toContainText("ft");
  // Tides with a station and its turns in it, rather than the "no station
  // near this view" line the gate scans.
  await expectClean(page, "the tides panel with a station in it");
});

test("draws the surge picture for the hurricane you pick", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).not.toHaveAttribute("data-layer-stack", /surge/);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Storm Surge Risk/ }).check();

  // The picture goes on under the radar rather than over it.
  await expect(pane).toHaveAttribute(
    "data-layer-stack",
    /openradar-surge-layer/,
  );
  const stack = (await pane.getAttribute("data-layer-stack"))!.split(" ");
  expect(stack.indexOf("openradar-surge-layer")).toBeLessThan(
    stack.findIndex((id) => id.startsWith("openradar-radar-layer")),
  );

  // Category three by default, and the picker changes what is asked for.
  const picker = page.locator("[data-surge-category]");
  await expect(picker).toHaveAttribute("data-surge-category", "3");
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("StormSurgeRisk")) asked.push(request.url());
  });
  await picker.getByRole("button", { name: "5", exact: true }).click();
  await expect(picker).toHaveAttribute("data-surge-category", "5");
  await expect
    .poll(() => asked.some((url) => url.includes("layers=show%3A21")))
    .toBe(true);
});

test("closing a panel cancels the request it left in flight", async ({
  page,
}) => {
  // A request nobody is waiting for still costs the service its answer, and
  // its result would race whatever the panel asks for next. Closing the panel
  // has to abort it.
  const held: string[] = [];
  const cancelled: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("models=")) cancelled.push(request.url());
  });

  // Answer nothing at all, so the request is still open when the panel closes.
  await page.route("https://api.open-meteo.com/**", async (route) => {
    const url = route.request().url();
    if (!url.includes("models=")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    held.push(url);
    await new Promise(() => {});
  });

  await page.getByRole("button", { name: "Guidance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Guidance" })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  // Still open, still waiting: nothing has been cancelled yet.
  expect(cancelled).toHaveLength(0);

  await page.getByRole("button", { name: "Close Guidance" }).click();
  await expect(page.getByRole("heading", { name: "Guidance" })).toHaveCount(0);

  await expect
    .poll(() => cancelled.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("switches the whole workspace to metric and to UTC", async ({ page }) => {
  await page.goto("/?testMode=1&lon=-90.07&lat=29.95&zoom=8&bearing=0&pitch=0");

  // Imperial to start, which is what a fresh install shows.
  await page.getByRole("button", { name: "Tides", exact: true }).click();
  await expect(page.getByText(/miles from the map centre/)).toBeVisible();
  await expect(page.locator(".route-row").first()).toContainText(" ft");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Metres and Celsius" }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();

  // The measurement and the word for it change together: a label reading
  // kilometres over a figure still counted in miles would be worse than either.
  await page.getByRole("button", { name: "Tides", exact: true }).click();
  await expect(page.getByText(/kilometres from the map centre/)).toBeVisible();
  await expect(page.locator(".route-row").first()).toContainText(" m");
});

test("a measurement already on the map follows the units", async ({ page }) => {
  // The map and the strip above it are mounted for the life of the window, so
  // a switch to metric has to reach them. And the readout is written when the
  // click happens, so a measurement taken in miles cannot become kilometres by
  // being re-rendered: it has to be composed again.
  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=7&bearing=0&pitch=0");

  await page.getByRole("button", { name: "Range", exact: true }).click();
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const box = (await pane.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);

  const hud = page.locator(".tool-hud");
  const result = hud.locator(".tool-hud__result");
  await expect(result).toHaveText(/^\d+ mi$/);
  const imperial = (await result.textContent()) ?? "";

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Metres and Celsius" }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();

  // Same measurement, said in the other units, without touching the map again.
  await expect(result).toHaveText(/^\d+ km$/);
  expect(await result.textContent()).not.toBe(imperial);
});

test("says when each model last ran and how far it has moved since", async ({
  page,
}) => {
  await routeData(page);
  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=6");
  await page.getByRole("button", { name: "Guidance", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Guidance" });
  await expect(panel).toBeVisible();

  // Two models disagreeing is one thing; one of them being months behind the
  // other is another, and the table alone cannot say which.
  await expect(panel.locator(".model-runs li").first()).toContainText(
    /last ran .* h ago/,
  );
  await expect(panel.locator('.model-runs li[data-stale="true"]')).toHaveCount(
    0,
  );

  // GEM's run is three months old in this fixture, and saying so is the point.
  await page.getByRole("button", { name: "GEM", exact: true }).click();
  await expect(
    panel.locator('.model-runs li[data-stale="true"]'),
  ).toContainText("older than its own schedule");

  // And the comparison, which is off until it is asked for.
  await expect(panel.locator(".guidance-change")).toHaveCount(0);
  await panel.getByRole("checkbox", { name: /Compare with yesterday/ }).check();
  await expect(panel.locator(".guidance-change").first()).toBeVisible();
  await expect(
    panel.locator('.guidance-change[data-direction="up"]').first(),
  ).toContainText("+1");
});

test("the run ages and the changes are readable in the light theme", async ({
  page,
}) => {
  // `--warning` was used and defined nowhere, so the line saying a model run
  // is out of date fell back to a dark-theme yellow at 1.67:1 on the light
  // panel. The two change colours beside a number were hardcoded pastels at
  // 1.99 and 1.83 on white.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({ schemaVersion: 3, theme: "light" }),
    );
  });
  await routeData(page);
  await page.goto("/?testMode=1&lon=-93.7&lat=41.7&zoom=6");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Guidance", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Guidance" });
  await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "GEM", exact: true }).click();
  await expect(
    panel.locator('.model-runs li[data-stale="true"]'),
  ).toBeVisible();
  await panel.getByRole("checkbox", { name: /Compare with yesterday/ }).check();
  await expect(panel.locator(".guidance-change").first()).toBeVisible();

  for (const selector of [".model-runs", ".guidance-change"]) {
    const results = await new AxeBuilder({ page })
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(`${selector}: ${serious.map((one) => one.id).join(", ")}`).toBe(
      `${selector}: `,
    );
  }
});

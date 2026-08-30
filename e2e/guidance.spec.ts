import { expect, test, type Page } from "@playwright/test";
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
  await expect(station).toContainText("miles from the middle of the map");
  // Rising or falling, said plainly, because that is the thing people want.
  await expect(station.locator("[data-tide-state]")).toBeVisible();

  // The turns of the tide, in order, with heights.
  const rows = page.locator(".route-row");
  await expect(rows.first()).toContainText(/High|Low/);
  await expect(rows.first()).toContainText("ft");
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

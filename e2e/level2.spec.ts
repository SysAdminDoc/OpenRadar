import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, transparentPng } from "./support/fixtures";

/**
 * Level II is decoded natively, so a browser has no site to show. Standing in
 * for the native side is the only way to exercise the handover, and what is
 * being tested here is the handover: which picture the map draws, what the
 * legend says, and what happens when the view zooms back out.
 */
async function fakeNativeSide(page: Page) {
  await page.addInitScript(
    ({ png }: { png: string }) => {
      const sweep = (
        station: string,
        product: string,
        tilt: number,
        dealias: boolean,
        motion: [number, number] | null,
      ) => {
        const products: Record<string, [string, string]> = {
          reflectivity: ["Reflectivity", "dBZ"],
          velocity: ["Velocity", "m/s"],
          "spectrum-width": ["Spectrum width", "m/s"],
          "differential-reflectivity": ["Differential reflectivity", "dB"],
          "correlation-coefficient": ["Correlation coefficient", ""],
          "storm-relative-velocity": ["Storm relative velocity", "m/s"],
        };
        const tilts = [0.48, 0.87, 1.31, 1.8];
        const [label, unit] = products[product] ?? ["Reflectivity", "dBZ"];
        return {
          station,
          siteName: "Des Moines, IA",
          productId: product,
          paletteApplied: false,
          highContrast: false,
          dealiased: dealias && product === "velocity",
          stormMotion:
            product === "storm-relative-velocity"
              ? // Either what the caller asked for, or what the sweep was read
                // to be moving in.
                {
                  speedMs: motion ? motion[0] : 18.4,
                  fromDegrees: motion ? motion[1] : 235,
                  manual: motion !== null,
                }
              : null,
          product: label,
          unit,
          elevationDegrees: tilts[Math.min(tilt, tilts.length - 1)],
          tilts,
          tiltIndex: tilt,
          collected: new Date().toISOString(),
          west: -96.5,
          south: 39.6,
          east: -91.0,
          north: 43.8,
          image: png,
          volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
          source: {
            kind: "recent",
            label: "NOAA NEXRAD Level II",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        };
      };

      const calls: Array<{ command: string; args: unknown }> = [];
      (window as unknown as { __sweepCalls: typeof calls }).__sweepCalls =
        calls;
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: (path: string, scheme: string) =>
          `http://${scheme}.localhost/${path}`,
        invoke: (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "level2_nearest_site") {
            // The real command answers nothing for a point no site can see,
            // which is what the frontend has to cope with.
            const longitude = Number(args.longitude);
            return Promise.resolve(longitude < -70 ? "KDMX" : null);
          }
          if (command === "probsevere_reading") {
            // One storm over Iowa the model is worried about, and one it is
            // not, so the floor that keeps the map readable is exercised too.
            return Promise.resolve({
              observed: new Date()
                .toISOString()
                .replace(/[-:]/g, "")
                .replace("T", "_")
                .slice(0, 15)
                .concat(" UTC"),
              storms: [
                {
                  id: "9001",
                  rings: [
                    [
                      [-94.0, 41.5],
                      [-93.4, 41.5],
                      [-93.4, 41.9],
                      [-94.0, 41.9],
                      [-94.0, 41.5],
                    ],
                  ],
                  severe: 88,
                  hail: 61,
                  wind: 44,
                  tornado: 12,
                  attributes: [
                    ["COMPREF", "62.5"],
                    ["MESH", "1.85"],
                  ],
                },
                {
                  id: "9002",
                  rings: [
                    [
                      [-95.0, 41.5],
                      [-94.8, 41.5],
                      [-94.8, 41.7],
                      [-95.0, 41.7],
                      [-95.0, 41.5],
                    ],
                  ],
                  severe: 2,
                  hail: 0,
                  wind: 1,
                  tornado: 0,
                  attributes: [],
                },
              ],
            });
          }
          if (command === "level3_cells") {
            // Two storms west of Des Moines: one heading straight at it, one
            // going the other way. Whether the panel picks the right one is
            // the whole point of the layer.
            return Promise.resolve({
              station: String(args.station),
              siteLatitude: 41.7,
              siteLongitude: -93.7,
              observed: new Date().toISOString(),
              cells: [
                {
                  id: "Y6",
                  latitude: 41.7,
                  longitude: -94.2,
                  rangeKm: 42,
                  azimuthDegrees: 270,
                  directionDegrees: 90,
                  speedMs: 15,
                  past: [{ latitude: 41.7, longitude: -94.4 }],
                  forecast: [
                    { latitude: 41.7, longitude: -94.0 },
                    { latitude: 41.7, longitude: -93.85 },
                  ],
                },
                {
                  id: "Z2",
                  latitude: 41.9,
                  longitude: -93.9,
                  rangeKm: 25,
                  azimuthDegrees: 315,
                  directionDegrees: 270,
                  speedMs: 12,
                  past: [],
                  forecast: [],
                },
              ],
              mesocyclones: [
                {
                  latitude: 41.7,
                  longitude: -94.2,
                  radiusKm: 5,
                  kind: "mesocyclone",
                },
              ],
            });
          }
          if (command === "level3_classification") {
            // One volume: rain over the middle of the view and a run of hail
            // to the south-west, with the legend the native side sends with
            // every answer.
            const legend = [
              ["iceCrystals", "#61b1d1"],
              ["drySnow", "#3085a6"],
              ["wetSnow", "#996bc7"],
              ["graupel", "#6b3b9b"],
              ["rain", "#61d186"],
              ["heavyRain", "#30a657"],
              ["bigDrops", "#1c5f32"],
              ["hail", "#e27250"],
              ["largeHail", "#b8421e"],
              ["giantHail", "#692611"],
              ["unknown", "#8f97a3"],
            ].map(([id, color]) => ({ class: id, id, color }));
            return Promise.resolve({
              station: String(args.station),
              observed: new Date().toISOString(),
              product: String(args.product),
              features: [
                {
                  class: "rain",
                  fromDegrees: 0,
                  toDegrees: 360,
                  nearKm: 0,
                  farKm: 60,
                  ring: [
                    [-95.0, 41.0],
                    [-92.5, 41.0],
                    [-92.5, 42.5],
                    [-95.0, 42.5],
                    [-95.0, 41.0],
                  ],
                },
                {
                  class: "hail",
                  fromDegrees: 200,
                  toDegrees: 210,
                  nearKm: 60,
                  farKm: 70,
                  ring: [
                    [-94.6, 40.8],
                    [-94.4, 40.8],
                    [-94.4, 40.95],
                    [-94.6, 40.95],
                    [-94.6, 40.8],
                  ],
                },
              ],
              legend,
            });
          }
          if (command === "level2_sweep" && String(args.station) === "FAIL") {
            return Promise.reject("the site did not answer");
          }
          if (command === "level2_sweep") {
            return Promise.resolve(
              sweep(
                String(args.station),
                String(args.product),
                Number(args.tilt),
                Boolean(args.dealias),
                (args.motion as [number, number] | null) ?? null,
              ),
            );
          }
          if (command === "plugin:dialog|open") {
            const selected = (window as unknown as { __archivePath?: string })
              .__archivePath;
            return Promise.resolve(
              selected ?? "C:\\radar\\KTLX20130520_205600_V06",
            );
          }
          if (command === "level2_local_sweep") {
            if (String(args.path).includes("malformed")) {
              return Promise.reject({
                code: "decode",
                args: ["the Archive II header is missing"],
                text: "the volume could not be decoded",
              });
            }
            return Promise.resolve({
              ...sweep(
                "KTLX",
                String(args.product),
                Number(args.tilt),
                Boolean(args.dealias),
                (args.motion as [number, number] | null) ?? null,
              ),
              collected: "2013-05-20T20:56:00.000Z",
              volume: "local:fixture",
              source: {
                kind: "local",
                label: "KTLX20130520_205600_V06",
                url: null,
              },
            });
          }
          if (command === "level2_archive_sweep") {
            return Promise.resolve({
              ...sweep(
                String(args.station).toUpperCase(),
                String(args.product),
                Number(args.tilt),
                Boolean(args.dealias),
                (args.motion as [number, number] | null) ?? null,
              ),
              collected: "2021-12-10T03:15:00.000Z",
              volume: "2021/12/10/KDMX/KDMX20211210_031500_V06",
              source: {
                kind: "archive",
                label: "NOAA NEXRAD Level II archive",
                url: "https://registry.opendata.aws/noaa-nexrad/",
              },
            });
          }
          if (command === "level2_cross_section") {
            const from = args.from as [number, number];
            const to = args.to as [number, number];
            // Far enough apart to be a line the radar cannot see the end of,
            // which is the refusal the panel has to be able to show.
            if (Math.abs(from[0] - to[0]) > 4) {
              return Promise.reject({
                code: "outOfRange",
                args: ["KDMX"],
                text: "both ends of a cross-section have to be within range of KDMX",
              });
            }
            return Promise.resolve({
              station: "KDMX",
              siteName: "Des Moines, IA",
              productId: String(args.product),
              product: "Reflectivity",
              unit: "dBZ",
              paletteApplied: false,
              highContrast: false,
              dealiased: false,
              from,
              to,
              distanceKm: 64,
              topKm: 18,
              lowestCut: 0.48,
              highestCut: 4.3,
              tilts: [0.48, 0.87, 1.31, 1.8, 4.3],
              collected: "2026-08-30T09:21:59.000Z",
              volume: "2026/08/30/KDMX/KDMX20260830_092159_V06",
              width: 720,
              height: 260,
              image: png,
              source: {
                kind: "recent",
                label: "NOAA NEXRAD Level II",
                url: "https://registry.opendata.aws/noaa-nexrad/",
              },
            });
          }
          // The settings store is not what this test is about, and a
          // rejection here would only raise a toast over the map.
          if (command.startsWith("plugin:store|")) return Promise.resolve(null);
          return Promise.reject(new Error(`${command} is not stubbed`));
        },
        transformCallback: (callback: unknown) => callback,
      };
    },
    {
      png: `data:image/png;base64,${transparentPng.toString("base64")}`,
    },
  );
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await fakeNativeSide(page);
});

async function open(page: Page, zoom: number) {
  await page.goto(
    `/?testMode=1&lon=-93.72&lat=41.73&zoom=${zoom}&bearing=0&pitch=0`,
  );
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
}

test("hands a close-in view over to the nearest site and back again", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await open(page, 9);
  // The site's own sweep is drawn, and the mosaic steps aside for it rather
  // than showing through from underneath.
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.00");
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();
  await expect(page.getByText("0.48° TILT")).toBeVisible();

  const asked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __sweepCalls: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__sweepCalls,
  );
  expect(asked.map((call) => call.command)).toContain("level2_nearest_site");
  const sweepCall = asked.find((call) => call.command === "level2_sweep");
  expect(sweepCall?.args).toMatchObject({
    station: "KDMX",
    product: "reflectivity",
    tilt: 0,
  });

  // Zooming back out is the mosaic's job again.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.70");
  await expect(page.getByText("Composite Radar")).toBeVisible();
});

test("switches product and tilt on the site already on screen", async ({
  page,
}) => {
  await open(page, 9);
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();

  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("velocity");
  await expect(page.getByText("KDMX Velocity")).toBeVisible();
  // The legend has to change scale with the product, not keep showing dBZ.
  // Unfolding is on, and it puts wind back past the limit the radar could
  // measure, so the bar has to reach as far as the picture does.
  await expect(page.getByLabel(/Velocity from -70 to 70 m\/s/)).toBeVisible();

  // Turned off, the picture is the radar's own reading and the bar says so.
  await page.getByRole("checkbox", { name: /Unfold velocity/ }).uncheck();
  await expect(page.getByLabel(/Velocity from -35 to 35 m\/s/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Unfold velocity/ }).check();

  await page.getByRole("combobox", { name: "Level II tilt" }).selectOption("2");
  await expect(page.getByText("1.31° TILT")).toBeVisible();

  const asked = await page.evaluate(
    () =>
      (
        window as unknown as {
          __sweepCalls: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__sweepCalls,
  );
  const sweeps = asked.filter((call) => call.command === "level2_sweep");
  expect(sweeps.at(-1)?.args).toMatchObject({ product: "velocity", tilt: 2 });
});

test("opens a local Archive II volume and removes current context", async ({
  page,
}) => {
  await open(page, 9);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  // Put two pieces of current context on first. Neither can stay over a volume
  // from 2013 and quietly look historical.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const reports = page.getByRole("checkbox", { name: /Storm Reports/ });
  if (!(await reports.isChecked())) await reports.check();
  await page.getByRole("button", { name: "Close Layers" }).click();
  await expect(pane).toHaveAttribute("data-layer-stack", /alerts-fill/);
  await expect(pane).toHaveAttribute("data-layer-stack", /stormReports-points/);

  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("button", { name: "Open local Archive II file" })
    .click();

  const history = page.locator("[data-historical-radar]");
  await expect(history).toContainText("Local Archive II");
  await expect(history).toContainText("KTLX20130520_205600_V06");
  await expect(page.getByText("KTLX Reflectivity")).toBeVisible();
  await expect(
    page.locator(".live-chip", { hasText: "historical volume" }),
  ).toBeVisible();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /alerts-fill/);
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /stormReports-points/,
  );

  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("velocity");
  await page.getByRole("combobox", { name: "Level II tilt" }).selectOption("2");
  await expect(page.getByText("KTLX Velocity")).toBeVisible();
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        __sweepCalls: Array<{ command: string; args: Record<string, unknown> }>;
      }
    ).__sweepCalls.filter((call) => call.command === "level2_local_sweep"),
  );
  expect(calls.at(-1)?.args).toMatchObject({ product: "velocity", tilt: 2 });

  await page.getByRole("button", { name: "Return to recent radar" }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByText("KDMX Velocity")).toBeVisible();
});

test("browses the public archive and refuses a malformed local file", async ({
  page,
}) => {
  await open(page, 9);
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();

  await page.getByRole("textbox", { name: "NEXRAD site" }).fill("KDMX");
  await page.getByLabel("UTC date and time").fill("2021-12-10T03:15");
  await page
    .getByRole("button", { name: "Load public archive volume" })
    .click();
  await expect(page.locator("[data-historical-radar]")).toContainText(
    "Public Archive II",
  );
  await expect(
    page.getByRole("link", { name: "NOAA NEXRAD Level II archive" }),
  ).toBeVisible();

  const archiveCall = await page.evaluate(() =>
    (
      window as unknown as {
        __sweepCalls: Array<{ command: string; args: Record<string, unknown> }>;
      }
    ).__sweepCalls.find((call) => call.command === "level2_archive_sweep"),
  );
  expect(archiveCall?.args).toMatchObject({
    station: "KDMX",
    at: "2021-12-10T03:15:00.000Z",
  });

  await page.getByRole("button", { name: "Return to recent radar" }).click();
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __archivePath: string }).__archivePath =
      "C:\\radar\\malformed";
  });
  await page
    .getByRole("button", { name: "Open local Archive II file" })
    .click();

  await expect(page.getByText(/Archive II header is missing/)).toBeVisible();
  await expect(page.locator("[data-historical-radar]")).toHaveCount(0);
  // The failed import did not replace the good sweep already on screen.
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();
});

test("hides the weak returns when the reader asks and puts them back", async ({
  page,
}) => {
  await open(page, 9);
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();

  const slider = page.getByRole("slider", {
    name: "Hide readings below this value",
  });
  // The mosaic has a threshold of its own and reads the same when it is off,
  // so this has to be the readout beside this slider rather than any.
  const readout = page
    .locator("label.range-row")
    .filter({ has: slider })
    .locator("output");
  // Nothing is hidden until somebody asks, so the sweep is read whole.
  await expect(readout).toHaveText("Everything");

  await slider.fill("35");
  await expect(readout).toHaveText("35 dBZ");

  const askedFor = async () => {
    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            __sweepCalls: Array<{
              command: string;
              args: Record<string, unknown>;
            }>;
          }
        ).__sweepCalls,
    );
    return calls.filter((call) => call.command === "level2_sweep").at(-1)?.args
      .threshold;
  };
  await expect.poll(askedFor).toBe(35);

  // The threshold belongs to the product it was set on. Velocity keeps its
  // own, which is none until it is given one.
  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("velocity");
  await expect(readout).toHaveText("Everything");
  await expect.poll(askedFor).toBe(null);

  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("reflectivity");
  await expect(readout).toHaveText("35 dBZ");
  await expect.poll(askedFor).toBe(35);

  // Back to the bottom of the slider is off rather than a threshold of zero,
  // which would redraw the sweep to hide nothing.
  await slider.fill("0");
  await expect(readout).toHaveText("Everything");
  await expect.poll(askedFor).toBe(null);

  // And the mosaic's own floor is a separate setting: putting one on it must
  // not put one on the tilt, which is a different product with a different
  // scale.
  await page
    .getByRole("slider", { name: "Hide below, on the mosaic" })
    .fill("40");
  await expect(readout).toHaveText("Everything");
  await expect.poll(askedFor).toBe(null);
});

test("turning single site off puts the mosaic back", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await open(page, 9);
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);

  await page.getByRole("button", { name: /KDMX/ }).first().click();
  await page.getByRole("checkbox", { name: /Single site up close/ }).uncheck();

  await expect(pane).not.toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.70");
});

test("gives the map back when the view leaves every site's coverage", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await open(page, 9);
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);
  await expect(pane).toHaveAttribute("data-mosaic-opacity", "0.00");

  // Bermuda, still zoomed in, but no NEXRAD site can see it. The last site's
  // sweep must not stay on screen under a label naming a site a thousand
  // miles away, and the mosaic has to come back.
  await page.goto("/?testMode=1&lon=-64.8&lat=32.3&zoom=9&bearing=0&pitch=0");
  await expect(pane).toBeVisible();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /sweep-layer/);
  // Nothing of the old site is left on screen or in the legend. Out here the
  // mosaics have nothing either, which is the honest answer for the middle of
  // the Atlantic.
  await expect(page.getByText(/KDMX/)).toBeHidden();
  await expect(page.getByText("Composite Radar")).toBeVisible();
});

test("unfolds velocity by default and says so, and can be turned off", async ({
  page,
}) => {
  await open(page, 9);
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("velocity");
  await expect(page.getByText("KDMX Velocity")).toBeVisible();

  // On by default: a folded sweep is wrong rather than a matter of taste.
  await expect(page.getByText("0.48° TILT · UNFOLDED")).toBeVisible();
  const asked = async () =>
    await page.evaluate(() =>
      (
        window as unknown as {
          __sweepCalls: Array<{
            command: string;
            args: Record<string, unknown>;
          }>;
        }
      ).__sweepCalls.filter((call) => call.command === "level2_sweep"),
    );
  expect((await asked()).at(-1)?.args).toMatchObject({ dealias: true });

  // Turning it off asks for the radar's own reading, and the legend stops
  // claiming the picture has been changed.
  await page.getByRole("checkbox", { name: /Unfold velocity/ }).uncheck();
  await expect(page.getByText("0.48° TILT", { exact: true })).toBeVisible();
  expect((await asked()).at(-1)?.args).toMatchObject({ dealias: false });
});

test("says how high the beam is over the point you click", async ({ page }) => {
  // The same picture at the same tilt means something else eighty miles
  // further out, because the beam has climbed. Reading rotation without
  // knowing the height is guesswork.
  await open(page, 9);
  await expect(page.getByText("KDMX Reflectivity")).toBeVisible();

  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await page
    .getByRole("application", { name: "Interactive weather map" })
    .click({
      position: { x: 500, y: 400 },
    });

  await expect(
    page.getByText(/beam [\d,]+ ft above the radar at 0\.48°/),
  ).toBeVisible();
  // The coordinates are still there beside it.
  await expect(page.getByText(/°, .*° · zoom 9/)).toBeVisible();
});

test("reads the storm motion off the sweep, and takes yours instead", async ({
  page,
}) => {
  // Velocity with the ambient wind still in it buries a couplet under sixty
  // knots of flow. What the sweep is moving in has to be visible, and
  // correctable, or the product is guesswork with extra steps.
  await open(page, 9);
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("combobox", { name: "Level II product" })
    .selectOption("storm-relative-velocity");

  await expect(page.getByText("KDMX Storm relative velocity")).toBeVisible();
  const motion = page.locator("[data-storm-motion]");
  await expect(motion).toContainText("Read from the sweep");
  await expect(motion).toContainText("41 mph");
  await expect(motion).toContainText("235");

  // Giving one replaces it, and the next sweep is asked for with it.
  await motion.getByRole("spinbutton", { name: "From" }).fill("270");
  // The speed it was read at is kept, and the direction is the one given.
  await expect(motion).toContainText("Yours: 41 mph from 270°");
  const asked = await page.evaluate(() =>
    (
      window as unknown as {
        __sweepCalls: Array<{ command: string; args: Record<string, unknown> }>;
      }
    ).__sweepCalls.filter((call) => call.command === "level2_sweep"),
  );
  expect(asked.at(-1)?.args.motion).toEqual([18.4, 270]);

  // And it can be handed back to the sweep to work out again.
  await motion.getByRole("button", { name: /Read it from the sweep/ }).click();
  await expect(motion).toContainText("Read from the sweep");
});

test("says which storm reaches the watched place and when", async ({
  page,
}) => {
  // The mosaic says where rain is. This says which of it is coming here, which
  // is the only thing somebody standing outside actually wants to know.
  await open(page, 9);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Storm Cells/ }).check();
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-layer-stack", /cell-points/);
  await expect(pane).toHaveAttribute("data-layer-stack", /cell-tracks/);
  await page.getByRole("button", { name: "Close Layers" }).click();

  // Without a watched place there is nothing to be early about, and the panel
  // says so rather than showing a number about nowhere.
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  const arrival = page.locator("[data-cell-arrival]");
  await expect(arrival).toHaveText(/Set a watched place/);

  await page.getByRole("button", { name: "Close Composite Radar" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /Tell me about warnings/ }).check();
  await page.getByRole("button", { name: "Watch the map centre" }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();

  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  // Y6 is the one heading this way. Z2 is nearer and going the other way, so
  // picking the nearest rather than the one actually coming would name it.
  await expect(arrival).toHaveText(/Y6 reaches the place you watch in \d+ min/);
  await expect(arrival).not.toHaveText(/Z2/);
  // And the rotation is named in words, not only drawn as a red ring.
  await expect(page.locator("[data-cell-rotating]")).toHaveText(/Y6/);
});

test("draws what the site's own algorithm says is falling, and says whose word it is", async ({
  page,
}) => {
  // The classification is the radar naming what its own moments look like,
  // which is not somebody on the ground seeing hail. The legend has to say
  // so, every class has to be named, and the inspector has to read the class
  // under the click rather than leaving the reader to match a colour.
  await open(page, 9);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Hydrometeor Classification/ })
    .check();
  await page.getByRole("button", { name: "Close Layers" }).click();

  await expect(pane).toHaveAttribute("data-layer-stack", /classification-fill/);
  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  const at = (id: string) => stack.indexOf(id);
  // Over the sweep it was read from, and under the warnings.
  expect(at("openradar-classification-fill")).toBeGreaterThan(
    at("openradar-sweep-layer"),
  );
  expect(at("openradar-classification-fill")).toBeLessThan(
    at("openradar-overlay-alerts-fill"),
  );

  const legend = page.locator("[data-classification-legend]");
  await expect(legend).toContainText("Hybrid scan (HHC)");
  for (const name of [
    "Ice crystals",
    "Dry snow",
    "Wet snow",
    "Graupel",
    "Rain",
    "Heavy rain",
    "Big drops",
    "Hail",
    "Large hail",
    "Giant hail",
    "Unknown",
  ]) {
    await expect(legend.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(legend).toContainText("not a report from the ground");

  // The inspector names the class under the click. Left of centre, because
  // the legends hang on the right edge and the click has to land on the map.
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await pane.click({ position: { x: 340, y: 330 } });
  await expect(
    page.getByText(/Rain by the radar's own classification/),
  ).toBeVisible();

  // The other product is asked for by name, and the legend says which.
  await page.getByRole("button", { name: /Composite Radar|KDMX/ }).click();
  await page
    .getByRole("combobox", { name: "Hydrometeor classification product" })
    .selectOption("N0H");
  await expect(legend).toContainText("Lowest tilt (N0H)");
  const asked = await page.evaluate(() =>
    (
      window as unknown as {
        __sweepCalls: Array<{ command: string; args: { product?: string } }>;
      }
    ).__sweepCalls.filter((call) => call.command === "level3_classification"),
  );
  expect(asked[0]?.args.product).toBe("HHC");
  expect(asked.at(-1)?.args.product).toBe("N0H");
  await page.getByRole("button", { name: "Close Composite Radar" }).click();

  // And off again takes the layer down with it.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Hydrometeor Classification/ })
    .uncheck();
  await expect(pane).not.toHaveAttribute(
    "data-layer-stack",
    /classification-fill/,
  );
});

test("draws severe probability over the pictures and under the warnings", async ({
  page,
}) => {
  // Guidance about what might happen belongs under a warning somebody has
  // taken responsibility for, and over the pictures it was worked out from.
  await open(page, 9);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Severe Probability/ })
    .check();
  // Storm cells too, so the order of the two new layers against each other is
  // a real comparison rather than one against something that is not there.
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Storm Cells/ })
    .check();
  await page.getByRole("button", { name: "Close Layers" }).click();

  await expect(pane).toHaveAttribute("data-layer-stack", /probsevere-fill/);
  await expect(pane).toHaveAttribute("data-layer-stack", /cell-points/);
  const stack = (await pane.getAttribute("data-layer-stack"))?.split(" ") ?? [];
  const at = (id: string) => stack.indexOf(id);

  expect(at("openradar-probsevere-fill")).toBeGreaterThan(
    at("openradar-sweep-layer"),
  );
  expect(at("openradar-probsevere-fill")).toBeLessThan(
    at("openradar-overlay-alerts-fill"),
  );
  // And under the storm cells, which are the radar's own reading rather than
  // a model's expectation of it.
  expect(at("openradar-probsevere-line")).toBeLessThan(
    at("openradar-cell-points"),
  );

  // Switching it off takes the layer away rather than leaving an empty one.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page
    .locator(".setting-list")
    .getByRole("checkbox", { name: /Severe Probability/ })
    .uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /probsevere/);
});

test("cuts the volume between two points and labels what it drew", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await open(page, 9);
  // The site has to be resolved before there is a volume to cut.
  await expect(pane).toHaveAttribute("data-layer-stack", /sweep-layer/);

  await page
    .getByRole("button", { name: "Cross-section", exact: true })
    .click();
  const hud = page.locator(".tool-hud__result");
  await expect(hud).toHaveText(/one end of the slice/);

  const box = (await pane.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.45);
  await expect(hud).toHaveText(/other end of the slice/);
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.55);

  const panel = page.getByRole("dialog", { name: "Cross-section" });
  await expect(panel).toBeVisible();
  // Height against distance, with the labels a reader cannot get off the map.
  await expect(panel.locator(".cross-section__plot img")).toHaveAttribute(
    "alt",
    /Reflectivity from KDMX/,
  );
  await expect(panel).toContainText("Reflectivity (dBZ)");
  await expect(panel).toContainText("cuts between 0.48° and 4.30°");
  await expect(panel).toContainText("Empty bands are heights no beam passed");
  // The axes are drawn over the picture rather than into it.
  await expect(panel.locator(".cross-section__height").first()).toBeVisible();
  await expect(
    panel.locator(".cross-section__axis span").first(),
  ).toBeVisible();

  const asked = await page.evaluate(() =>
    (
      window as unknown as {
        __sweepCalls: Array<{
          command: string;
          args: Record<string, unknown>;
        }>;
      }
    ).__sweepCalls.filter((call) => call.command === "level2_cross_section"),
  );
  // At least one, and every one asking the same question: StrictMode mounts
  // the panel twice in development, which is a repeated read and not a
  // different one.
  expect(asked.length).toBeGreaterThan(0);
  for (const call of asked) {
    expect(call.args.station).toBe("KDMX");
    // A chosen file's path never leaves the native side, and a live view has
    // none to send in the first place.
    expect(call.args.path).toBeNull();
    expect(call.args.at).toBeNull();
    const from = call.args.from as [number, number];
    const to = call.args.to as [number, number];
    expect(from[0]).not.toBe(to[0]);
  }
});

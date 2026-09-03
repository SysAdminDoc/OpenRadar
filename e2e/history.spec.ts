import { expect, test } from "@playwright/test";
import { expectClean } from "./support/axe";
import { routeWorkspace } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
});

async function findStorm(page: import("@playwright/test").Page, query: string) {
  await page.getByRole("searchbox", { name: /Search past storms/ }).fill(query);
}

test("draws a searched storm's track in its intensity colours", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();

  // The best track reaches the map as a line and one point per fix.
  await expect(pane).toHaveAttribute("data-layer-stack", /track-line/);
  await expect(pane).toHaveAttribute("data-layer-stack", /track-points/);
  // The published figure. Counting the off-hour landfall fixes as if they
  // were synoptic observations put this at 17.96.
  await expect(page.locator("[data-history-ace]")).toHaveAttribute(
    "data-history-ace",
    "17.47",
  );
  // Storm history with a storm in it: the track summary, the intensity
  // colours and the numbers beside them.
  await expectClean(page, "storm history with a track in it");
  await expect(page.getByText(/Category 5 · 140 kt peak/)).toBeVisible();

  // The category five fix is drawn in its own colour rather than one flat
  // track colour, which is what makes the intensity readable.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          if (!canvas) return 0;
          const target = document.createElement("canvas");
          target.width = canvas.width;
          target.height = canvas.height;
          const context = target.getContext("2d");
          if (!context) return 0;
          context.drawImage(canvas, 0, 0);
          const pixels = context.getImageData(
            0,
            0,
            target.width,
            target.height,
          ).data;
          let fuchsia = 0;
          for (let at = 0; at < pixels.length; at += 4) {
            if (
              pixels[at] > 150 &&
              pixels[at] < 235 &&
              pixels[at + 1] < 90 &&
              pixels[at + 2] > 160
            ) {
              fuchsia += 1;
            }
          }
          return fuchsia;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(10);
});

test("plays the archive radar around the peak and gives the map back", async ({
  page,
}) => {
  const tiles: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/tile.py/")) tiles.push(url);
  });

  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();

  // The replay is about the landfall, not the peak seven hours before it out
  // in the Gulf, and the toast says which.
  await expect(page.getByText(/Replaying IAN 2022/)).toBeVisible();
  await expect(page.getByText(/Archive radar around landfall/)).toBeVisible();
  await expect(
    page.getByText(/three hours either side of landfall on Sep 28, 2022/),
  ).toBeVisible();
  // Three hours either side of it, every quarter hour.
  await expect(page.getByText(/of 25 radar frames/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Iowa State radar archive" }),
  ).toBeVisible();

  // The frames asked for are the archive mosaic for the day of the peak, not
  // whatever the live feed happens to be serving.
  await expect
    .poll(() => tiles.filter((url) => url.includes("USCOMP-N0Q-2022")).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  // Centred on the 19:05Z landfall, so the window runs 16:00Z to 22:00Z. A
  // replay centred on the noon peak would run 09:00Z to 15:00Z and stop before
  // the storm ever reached Florida. Only the frames the playhead has reached
  // are fetched, so this checks where they fall rather than which ones came.
  const stamps = tiles
    .map((url) => url.match(/USCOMP-N0Q-(\d{12})/)?.[1])
    .filter((stamp): stamp is string => Boolean(stamp));
  expect(stamps.length).toBeGreaterThan(0);
  expect(stamps).toContain("202209281900");
  expect(
    stamps.every((stamp) => stamp >= "202209281600" && stamp <= "202209282200"),
  ).toBe(true);

  await page.getByRole("button", { name: /Live radar/ }).click();
  await expect(
    page.getByRole("link", { name: "Iowa State radar archive" }),
  ).toBeHidden();
  await expect(page.getByText(/of 25 radar frames/)).toBeHidden();
});

test("covers the Pacific and says when a storm predates the radar archive", async ({
  page,
}) => {
  await findStorm(page, "Hilary");
  await expect(page.getByText(/East Pacific · Category 4/)).toBeVisible();

  await findStorm(page, "Andrew 1992");
  await page.getByRole("button", { name: /ANDREW 1992/ }).click();
  await expect(page.getByText(/radar archive starts in 2003/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Replay radar/ })).toBeHidden();

  // Hilary is recent enough but never came within reach of the mosaic, so it
  // is offered no replay either, and for a different reason.
  await findStorm(page, "Hilary 2023");
  await page.getByRole("button", { name: /HILARY 2023/ }).click();
  await expect(
    page.getByText(/stayed outside the national radar mosaic/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Replay radar/ })).toBeHidden();
  // The track still draws; only the replay is unavailable.
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /track-line/);
});

test("searches before any track has been fetched", async ({ page }) => {
  // The whole record is nearly three megabytes of six-hourly positions, and a
  // search needs none of them. The index alone has to answer, or opening the
  // panel stalls on a download nobody asked for.
  const fetched: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/hurdat/")) fetched.push(url.split("/").pop()!);
  });
  // Reopened with the listener attached, since the panel already loaded once.
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();

  await findStorm(page, "Ian 2022");
  await expect(page.getByRole("button", { name: /IAN 2022/ })).toBeVisible();
  expect(fetched, "a search should read the index and nothing else").toEqual([
    "index.json",
  ]);

  // Picking one fetches its decade, and only its decade.
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /track-line/);
  await expect.poll(() => fetched).toEqual(["index.json", "2020.json"]);

  // A second storm from the same decade reuses what is already in hand.
  await findStorm(page, "Ian");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await expect.poll(() => fetched).toEqual(["index.json", "2020.json"]);
});

test("draws the warnings that were in force, not today's", async ({ page }) => {
  // The app replays radar back to 2003 and used to draw today's warnings over
  // it, or nothing. Both are a claim nobody made.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("sbw_interval") || url.includes("/geojson/sbw.py")) {
      asked.push(url);
    }
  });

  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();
  await expect(page.getByText(/Replaying IAN 2022/)).toBeVisible();

  // Four requests for the whole window and not one per frame: the polygons
  // for the short-fuse products, two more for the flood products that hold a
  // shape far longer, and the tag feed. Two rather than one because the
  // service filters on at most two phenomena at a time.
  await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(4);
  const intervals = asked.filter((url) => url.includes("sbw_interval"));
  expect(intervals).toHaveLength(3);
  for (const url of intervals) {
    expect(url).toContain("only_new=false");
    expect(url).toContain("endts=2022-09-28T22:00:00Z");
  }
  // Issuance is what the window filters on, so it opens before the replay to
  // catch a warning already in force when it starts: two hours for the
  // products that fit in that, ten days for the flood products that do not.
  const short = intervals.find((url) => !url.includes("ph="));
  const long = intervals.filter((url) => url.includes("ph="));
  expect(short).toContain("begints=2022-09-28T14:00:00Z");
  for (const url of long) {
    expect(url).toContain("begints=2022-09-18T16:00:00Z");
  }
  // River flood is the product a tornado outbreak cannot show you and most of
  // the map on a tropical one, which is what this replay is.
  const asking = long.join(" ");
  for (const phenomena of ["ph=FA", "ph=FF", "ph=FL"]) {
    expect(asking).toContain(phenomena);
  }

  // The polygons are on the map, drawn by the same layer the live ones use.
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);

  // The panel lists them, says they came out of the archive rather than
  // pretending to be checking NWS, and dates them with a year.
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  await expect(page.getByText(/from the Iowa State archive/)).toBeVisible();
  await expect(page.getByText(/2022/).first()).toBeVisible();
  await page.getByRole("button", { name: "Close Alerts" }).click();

  // Scrubbing to a later frame does not ask the archive again.
  const scrubber = page.getByRole("slider", { name: /radar frame/i });
  await scrubber.focus();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);
  expect(asked).toHaveLength(4);
});

test("keeps a replay's warnings behind the layer switch", async ({ page }) => {
  // Every other layer answers to this switch and the archived warnings did
  // not, so somebody who had turned warnings off got them back on a replay.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Weather Alerts/ }).uncheck();
  await page.getByRole("button", { name: "Close Layers" }).click();

  // The Layers panel took History's place, so it has to be reopened.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();
  await expect(page.getByText(/Replaying IAN 2022/)).toBeVisible();
  await expect(pane).toHaveAttribute("data-radar-frame", /\d+/);
  await expect(pane).not.toHaveAttribute("data-layer-stack", /overlay-alerts/);
});

test("takes a replay's warnings off when the switch goes off mid-replay", async ({
  page,
}) => {
  // The order that matters. Unchecking before the replay starts means nothing
  // was ever fetched, so the switch is honoured by accident; unchecking after
  // the archive has answered is the case where the polygons stayed on the map
  // while the Alerts panel said the layer was off.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);

  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("checkbox", { name: /Weather Alerts/ }).uncheck();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /overlay-alerts/);

  // And back on again, without asking the archive for a window it already has.
  await page.getByRole("checkbox", { name: /Weather Alerts/ }).check();
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);
});

test("tells a reader who cannot see the map what the replay is showing", async ({
  page,
}) => {
  // The readout reads the live warnings feed, which is switched off for the
  // whole replay. Reading only that left it saying there was nothing over the
  // place while the map drew that day's polygons.
  await findStorm(page, "Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toHaveAttribute("data-layer-stack", /overlay-alerts/);
  // Held still on a frame the fixture's warning actually stood for. Playback
  // would otherwise walk past it while the panel is being opened, and the
  // readout would be right to say there is nothing there.
  await page.getByRole("button", { name: "Pause radar animation" }).click();
  const scrubber = page.getByRole("slider", { name: /radar frame/i });
  await scrubber.focus();
  for (let step = 0; step < 2; step += 1) {
    await page.keyboard.press("ArrowRight");
  }

  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page
    .getByRole("searchbox", { name: /Search every layer/ })
    .fill("nearby");
  await page.locator('[data-command="surface:nearby"]').click();
  await expect(
    page.getByRole("heading", { name: "Nearby weather" }),
  ).toBeVisible();

  // The fixture's warning covers the default centre, so the readout has
  // something to say and must say the same thing the map is drawing.
  await expect(page.getByText("No warnings over this place.")).toHaveCount(0);
  await expect(page.locator(".nearby-list")).toContainText("Tornado Warning");
  // And the reader hears it, which is the whole point of the surface.
  await expect(page.locator('.live-region [aria-live="polite"]')).toContainText(
    "Tornado Warning",
  );
});

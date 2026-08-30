import { expect, test } from "@playwright/test";
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

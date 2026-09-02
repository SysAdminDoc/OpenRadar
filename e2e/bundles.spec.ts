import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

// Replay bundles: one file that keeps a replay's bytes. The native side
// fetches, hashes, writes and later serves them; here it is a fake that
// records what the page asked for and answers with a bundle it made up, so
// what is checked is the page's half: what goes into a bundle, what an
// opened one turns into on the map, and that a refused one changes nothing.

interface Call {
  command: string;
  args: Record<string, unknown>;
}

const IAN_PATH =
  "C:\\Users\\reader\\Downloads\\openradar-replay-ian-2022-abc12345.orb";
const WORKSPACE_PATH = "C:\\Users\\reader\\Downloads\\workspace.orb";
const NEWER_PATH = "C:\\Users\\reader\\Downloads\\newer.orb";
const UNUSABLE_PATH = "C:\\Users\\reader\\Downloads\\unusable.orb";

async function fakeNative(page: Page): Promise<void> {
  await routeWorkspace(page);
  await page.addInitScript(
    ({ ianPath }) => {
      const calls: Call[] = [];
      const w = window as unknown as {
        __bundleCalls: Call[];
        __bundlePath: string;
        __TAURI_INTERNALS__: Record<string, unknown>;
      };
      w.__bundleCalls = calls;
      w.__bundlePath = ianPath;
      // 13:00Z, 13:15Z and 13:30Z on 28 Sep 2022, given out of order so
      // the page has to put them right.
      const frame = (time: number, stamp: string) => ({
        providerId: "archive",
        time,
        tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${stamp}/{z}/{x}/{y}.png`,
        tileSize: 256,
        maxZoom: 9,
        attribution: "Iowa State radar archive",
      });
      const manifest = (
        workspace: unknown,
        missing: { url: string; reason: string }[],
      ) => ({
        type: "OpenRadarReplayBundle",
        bundleVersion: 1,
        app: "0.6.0",
        id: "abc12345def67890",
        label: "IAN 2022",
        createdAt: "2026-08-30T12:00:00+00:00",
        storm: {
          id: "AL092022",
          name: "IAN",
          year: 2022,
          focusTime: 1664370900,
        },
        window: { from: 1664370000, to: 1664371800 },
        frames: [
          frame(1664371800, "202209281330"),
          frame(1664370000, "202209281300"),
          frame(1664370900, "202209281315"),
        ],
        bounds: { west: -84, south: 25, east: -80, north: 28 },
        zooms: [6, 7, 8],
        camera: { center: [-82.2, 26.6], zoom: 7, bearing: 0, pitch: 0 },
        entries: [],
        missing,
        workspace,
      });
      w.__TAURI_INTERNALS__ = {
        convertFileSrc: (path: string, scheme: string) =>
          `http://${scheme}.localhost/${path}`,
        invoke: (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "plugin:dialog|open") {
            return Promise.resolve(w.__bundlePath);
          }
          if (command === "replay_bundle_capture") {
            return Promise.resolve({
              id: "abc12345def67890",
              path: w.__bundlePath,
              bytes: 5_452_595,
              entries: 42,
              missing: [],
              sha256: "ab".repeat(32),
            });
          }
          if (command === "replay_bundle_open") {
            const path = String(args.path);
            if (path.endsWith("newer.orb")) {
              return Promise.reject({
                code: "newer",
                args: ["3"],
                text: "bundle layout 3 is newer than this build reads",
              });
            }
            if (path.endsWith("unusable.orb")) {
              // Structurally fine, and every frame names a provider this
              // build does not draw.
              const held = manifest(null, []);
              return Promise.resolve({
                ...held,
                frames: held.frames.map((frame) => ({
                  ...frame,
                  providerId: "somebody-else",
                })),
              });
            }
            if (path.endsWith("workspace.orb")) {
              return Promise.resolve(
                manifest(
                  {
                    type: "OpenRadarWorkspace",
                    backupVersion: 2,
                    settings: { schemaVersion: 1, mapStyle: "pro-light" },
                    overlayFiles: [],
                  },
                  [],
                ),
              );
            }
            return Promise.resolve(
              manifest(null, [
                {
                  url: "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?begints=2022-09-28T13:00:00Z",
                  reason: "504",
                },
              ]),
            );
          }
          return Promise.resolve(null);
        },
      };
    },
    { ianPath: IAN_PATH },
  );
}

async function openHistory(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
}

async function captures(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() =>
    (window as unknown as { __bundleCalls: Call[] }).__bundleCalls
      .filter((call) => call.command === "replay_bundle_capture")
      .map((call) => call.args.request as Record<string, unknown>),
  );
}

async function commands(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __bundleCalls: Call[] }).__bundleCalls.map(
      (call) => call.command,
    ),
  );
}

test("keeps a replay as one file, with the reader's workspace only when asked", async ({
  page,
}) => {
  await fakeNative(page);
  await openHistory(page);
  await page
    .getByRole("searchbox", { name: /Search past storms/ })
    .fill("Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  // Nothing to bundle until there is a replay on the map.
  await expect(
    page.getByRole("button", { name: /Save replay bundle/ }),
  ).toBeHidden();
  await page.getByRole("button", { name: /Replay radar/ }).click();
  await expect(page.getByText(/Replaying IAN 2022/)).toBeVisible();

  await page.getByRole("button", { name: /Save replay bundle/ }).click();
  await expect(page.getByText(/Replay bundle saved/)).toBeVisible();
  await expect(page.getByText(/42 files, 5\.2 MB, at C:/)).toBeVisible();

  const [request] = await captures(page);
  expect(request.label).toBe("IAN 2022");
  expect((request.storm as { id: string }).id).toBe("AL092022");
  // Every frame of the replay, as templates the native side expands over
  // the view at the zoom it was at and one either side.
  const frames = request.frames as { tileUrl: string; time: number }[];
  expect(frames).toHaveLength(25);
  expect(frames[0].tileUrl).toContain("USCOMP-N0Q-2022");
  expect(frames[0].tileUrl).toContain("{z}/{x}/{y}");
  const window = request.window as { from: number; to: number };
  expect(window.from).toBe(frames[0].time);
  expect(window.to).toBe(frames[frames.length - 1].time);
  expect(request.minZoom).toBeLessThan(request.maxZoom as number);
  const bounds = request.bounds as { west: number; east: number };
  expect(bounds.west).toBeLessThan(bounds.east);
  // The three warnings interval feeds and the tag feed for the window.
  expect(request.extraUrls).toHaveLength(4);
  for (const url of request.extraUrls as string[]) {
    expect(url).toContain("2022-09-28T");
  }
  // Home, watched places and the rest stay out unless the box is ticked.
  expect(request.workspace).toBeNull();

  await page.getByRole("checkbox", { name: /Include my workspace/ }).check();
  await page.getByRole("button", { name: /Save replay bundle/ }).click();
  await expect.poll(async () => (await captures(page)).length).toBe(2);
  const [, withWorkspace] = await captures(page);
  const workspace = withWorkspace.workspace as {
    type: string;
    settings: Record<string, unknown>;
  };
  expect(workspace.type).toBe("OpenRadarWorkspace");
  expect(workspace.settings).toBeTruthy();
});

test("plays a bundle back as its own replay, on the storm's track and view", async ({
  page,
}) => {
  const tiles: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("tile.py")) tiles.push(request.url());
  });
  await fakeNative(page);
  await openHistory(page);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });

  await page.getByRole("button", { name: /Open a replay bundle/ }).click();
  await expect(
    page.getByText(/Replaying IAN 2022 from a bundle/),
  ).toBeVisible();
  await expect(page.getByText(/3 frames, kept 2026-08-30/)).toBeVisible();
  // What the bundle could not fetch when it was made is said, not hidden.
  await expect(
    page.getByText(/1 warnings feeds were not in the bundle/),
  ).toBeVisible();
  await expect(page.getByText(/of 3 radar frames/)).toBeVisible();

  // The frames on the timeline are the bundle's, in order, drawn from the
  // bundled addresses and nothing else.
  await expect
    .poll(
      () => tiles.filter((url) => url.includes("USCOMP-N0Q-2022092813")).length,
      {
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(0);
  expect(
    tiles.some(
      (url) =>
        url.includes("USCOMP-N0Q-20220928") &&
        !url.includes("USCOMP-N0Q-2022092813"),
    ),
  ).toBe(false);
  // The storm's track from the record, and the camera the bundle was made at.
  await expect(pane).toHaveAttribute("data-layer-stack", /track-line/);
  await expect
    .poll(async () => {
      const camera = await pane.getAttribute("data-camera");
      return camera ?? "";
    })
    .toMatch(/-82\.2/);
  // The picker asked for bundles and nothing else.
  const picker = await page.evaluate(
    () =>
      (window as unknown as { __bundleCalls: Call[] }).__bundleCalls.find(
        (call) => call.command === "plugin:dialog|open",
      )?.args,
  );
  expect(JSON.stringify(picker)).toContain('"orb"');

  // The readout names the bundle as the source, not the live feed, and does
  // not call three-year-old frames minutes old.
  await expect(page.getByText(/radar frames · Replay bundle/)).toBeVisible();
  await expect(page.getByText(/min old/)).toBeHidden();
  await expect(page.getByRole("link", { name: "Replay bundle" })).toBeVisible();

  // Going back to live radar lets go of the bundle as well. The live feed
  // in this harness also has three frames, so what changes is whose.
  await page.getByRole("button", { name: /Live radar/ }).click();
  await expect(page.getByText(/radar frames · NWS RIDGE II/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Replay bundle" })).toBeHidden();
  await expect.poll(() => commands(page)).toContain("replay_bundle_close");
});

test("applies a bundled workspace only on the reader's say-so", async ({
  page,
}) => {
  await fakeNative(page);
  await page.addInitScript((path) => {
    (window as unknown as { __bundlePath: string }).__bundlePath = path;
  }, WORKSPACE_PATH);
  await openHistory(page);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await expect(pane).toHaveAttribute("data-map-style", "pro-dark");

  await page.getByRole("button", { name: /Open a replay bundle/ }).click();
  await expect(
    page.getByText(/Replaying IAN 2022 from a bundle/),
  ).toBeVisible();
  // Opening changed the replay and the view, and not the workspace.
  await expect(pane).toHaveAttribute("data-map-style", "pro-dark");

  await page.getByRole("button", { name: /Apply its workspace/ }).click();
  await expect(page.getByText(/workspace is in force/)).toBeVisible();
  await expect(pane).toHaveAttribute("data-map-style", "pro-light");
});

test("refuses a bundle from a newer build without touching the map", async ({
  page,
}) => {
  await fakeNative(page);
  await page.addInitScript((path) => {
    (window as unknown as { __bundlePath: string }).__bundlePath = path;
  }, NEWER_PATH);
  await openHistory(page);
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const before = await pane.getAttribute("data-camera");

  await page.getByRole("button", { name: /Open a replay bundle/ }).click();
  await expect(page.getByText(/The replay bundle failed/)).toBeVisible();
  await expect(
    page.getByText(/made by a newer OpenRadar \(layout 3\)/),
  ).toBeVisible();
  await expect(page.getByText(/from a bundle/)).toBeHidden();
  // The timeline is still the live feed's: no bundle replay, no storm
  // track, and the camera where it was.
  await expect(page.getByRole("link", { name: "Replay bundle" })).toBeHidden();
  await expect(page.getByRole("button", { name: /Live radar/ })).toBeHidden();
  await expect(pane).not.toHaveAttribute("data-layer-stack", /track-line/);
  expect(await pane.getAttribute("data-camera")).toBe(before);
  expect(await commands(page)).not.toContain("replay_bundle_close");
});

test("lets go of the bundle whichever way the reader leaves it", async ({
  page,
}) => {
  await fakeNative(page);
  await openHistory(page);

  await page.getByRole("button", { name: /Open a replay bundle/ }).click();
  await expect(
    page.getByText(/Replaying IAN 2022 from a bundle/),
  ).toBeVisible();
  expect(await commands(page)).not.toContain("replay_bundle_close");

  // Not the button that stops the replay: picking a storm out of the list.
  // An open bundle answers for its own addresses ahead of the network, so one
  // left open would keep answering for a replay nobody is watching.
  await page
    .getByRole("searchbox", { name: /Search past storms/ })
    .fill("Ian 2022");
  await page.getByRole("button", { name: /IAN 2022/ }).click();
  await page.getByRole("button", { name: /Replay radar/ }).click();

  await expect.poll(() => commands(page)).toContain("replay_bundle_close");
});

test("says so when a bundle it cannot use replaces the one that was open", async ({
  page,
}) => {
  await fakeNative(page);
  await openHistory(page);

  await page.getByRole("button", { name: /Open a replay bundle/ }).click();
  await expect(
    page.getByText(/Replaying IAN 2022 from a bundle/),
  ).toBeVisible();

  // Opening has already replaced whatever was answering, so a second bundle
  // this build cannot draw takes the first one with it. The reader is told,
  // and the map goes back to live radar rather than running a replay whose
  // frames now quietly come off the network.
  await page.evaluate((path) => {
    (window as unknown as { __bundlePath: string }).__bundlePath = path;
  }, UNUSABLE_PATH);
  await page.getByRole("button", { name: /Open a replay bundle/ }).click();

  await expect(page.getByText(/The replay bundle failed/)).toBeVisible();
  await expect(
    page.getByText(/holds no frames this build can draw/),
  ).toBeVisible();
  await expect(page.getByText(/back on live radar/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Replay bundle" })).toBeHidden();
  await expect.poll(() => commands(page)).toContain("replay_bundle_close");
});

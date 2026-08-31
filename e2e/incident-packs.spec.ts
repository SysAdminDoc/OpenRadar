import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function fakeIncidentPacks(page: Page) {
  await page.addInitScript(() => {
    const id = "0123456789abcdef01234567";
    const state: {
      packs: Array<Record<string, unknown>>;
      limit: number;
      calls: string[];
      finish: () => void;
    } = {
      packs: [],
      limit: 4096 * 1024 * 1024,
      calls: [],
      finish: () => {
        const pack = state.packs[0];
        if (!pack) return;
        pack.status = "ready";
        pack.downloadedTiles = pack.tileCount;
        pack.downloadedBytes = 720_000;
        pack.archiveBytes = 704_000;
        pack.sha256 = "a".repeat(64);
        pack.error = null;
      },
    };
    (
      window as unknown as { __incidentPackTest: typeof state }
    ).__incidentPackTest = state;
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      transformCallback: (callback: unknown) => callback,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        state.calls.push(command);
        const library = () => ({
          packs: state.packs.map((pack) => ({ ...pack })),
          usedBytes: state.packs.reduce(
            (sum, pack) =>
              sum + Number(pack.archiveBytes || pack.downloadedBytes),
            0,
          ),
          diskLimitBytes: state.limit,
        });
        if (command === "incident_pack_list") return library();
        if (command === "incident_pack_set_limit") {
          state.limit = Number(args.diskLimitMb) * 1024 * 1024;
          return library();
        }
        if (command === "incident_pack_estimate") {
          return {
            tileCount: 20,
            estimatedBytes: 720_000,
            temporaryBytes: 1_440_000,
            usedBytes: 0,
            diskLimitBytes: state.limit,
            fits: true,
          };
        }
        if (command === "incident_pack_create") {
          const request = args.request as Record<string, unknown>;
          const timestamp = new Date().toISOString();
          const pack = {
            id,
            name: request.name,
            bounds: request.bounds,
            minZoom: request.minZoom,
            maxZoom: request.maxZoom,
            status: "downloading",
            tileCount: 20,
            downloadedTiles: 4,
            downloadedBytes: 120_000,
            estimatedBytes: 720_000,
            archiveBytes: 0,
            sha256: null,
            source: "USGS The National Map Topo",
            attribution: "USGS The National Map",
            error: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          state.packs = [pack];
          return { ...pack };
        }
        if (command === "incident_pack_pause") {
          state.packs[0].status = "paused";
          return null;
        }
        if (command === "incident_pack_resume") {
          state.packs[0].status = "downloading";
          return null;
        }
        if (
          command === "incident_pack_cancel" ||
          command === "incident_pack_delete"
        ) {
          state.packs = [];
          return null;
        }
        if (command === "mrms_products") return [];
        throw new Error(`${command} is not stubbed`);
      },
    };
  });
}

test.beforeEach(async ({ page }) => {
  await fakeIncidentPacks(page);
  await page.route("http://incident.localhost/**", async (route) => {
    await route.fulfill({ contentType: "image/png", body: transparentPng });
  });
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("prepares, resumes, renders, and removes a checked offline pack", async ({
  page,
  context,
}) => {
  const remoteBasemapRequests: string[] = [];
  const incidentRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("tiles.openfreemap.org") ||
      url.includes("basemap.nationalmap.gov") ||
      url.includes("tile.opentopomap.org")
    ) {
      remoteBasemapRequests.push(url);
    }
    if (url.startsWith("http://incident.localhost/")) {
      incidentRequests.push(url);
    }
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/20 tiles/)).toBeVisible();
  await page
    .getByRole("button", { name: "Download current map region" })
    .click();
  await expect(page.getByText("Downloading", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("Downloading", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as { __incidentPackTest: { finish: () => void } }
    ).__incidentPackTest.finish();
  });
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible({
    timeout: 3000,
  });
  await page.getByRole("button", { name: "Use offline" }).click();
  await expect(
    page.locator(
      '.map-viewport[data-incident-pack="0123456789abcdef01234567"]',
    ),
  ).toBeVisible();
  await expect.poll(() => incidentRequests.length).toBeGreaterThan(0);
  expect(remoteBasemapRequests).toEqual([]);

  // Rebuild the selected style while Chromium has no network. The only map
  // images requested are still from the local incident protocol.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Use online basemap" }).click();
  await page.getByRole("button", { name: "Use offline" }).click();
  await expect(
    page.locator(
      '.map-viewport[data-incident-pack="0123456789abcdef01234567"]',
    ),
  ).toBeVisible();
  expect(remoteBasemapRequests).toEqual([]);
  await context.setOffline(false);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("No incident packs have been prepared yet."),
  ).toBeVisible();
  await expect(
    page.locator('.map-viewport[data-incident-pack=""]'),
  ).toBeVisible();

  // Cancellation follows the same exact-directory cleanup path as deletion.
  await page
    .getByRole("button", { name: "Download current map region" })
    .click();
  await expect(page.getByText("Downloading", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("No incident packs have been prepared yet."),
  ).toBeVisible();
  const packs = await page.evaluate(
    () =>
      (
        window as unknown as {
          __incidentPackTest: { packs: unknown[] };
        }
      ).__incidentPackTest.packs,
  );
  expect(packs).toEqual([]);
});

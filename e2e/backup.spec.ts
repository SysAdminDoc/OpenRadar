import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * Putting a saved workspace back.
 *
 * Saving one had a button. Restoring one worked, and only by knowing to drop
 * the file on the Upload panel, which nothing beside the Save button said. It
 * goes through the same reader either way, so the partial-restore note and
 * the undo are the same note and the same undo.
 */

const IMPORT = '.settings-import input[type="file"]';

async function openBackupSettings(page: Page) {
  // The rail button toggles, so opening an already-open panel closes it.
  if ((await page.getByRole("heading", { name: "Settings" }).count()) === 0) {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const control = page.locator(".settings-import");
  await control.scrollIntoViewIfNeeded();
  return control;
}

function backup(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 3,
    seenWelcome: true,
    textScale: 130,
    projection: "globe",
    watch: {
      enabled: true,
      sound: false,
      name: "Casa",
      center: [-96.8, 32.78],
      radiusMiles: 30,
      minSeverity: "severe",
    },
    ...over,
  });
}

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("restores a saved workspace, and takes it back again", async ({
  page,
}) => {
  await openBackupSettings(page);
  await page.setInputFiles(IMPORT, {
    name: "openradar-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup()),
  });

  await expect(page.locator(".toast-host")).toContainText(
    /Settings restored|restored/i,
  );
  const stored = async () =>
    JSON.parse(
      (await page.evaluate(() =>
        window.localStorage.getItem("openradar.settings"),
      )) ?? "{}",
    ) as Record<string, unknown>;
  await expect.poll(async () => (await stored()).textScale).toBe(130);
  expect(((await stored()).watch as { name?: string }).name).toBe("Casa");

  // The same undo the Upload path offers, because it is the same undo.
  await page
    .locator(".toast-host")
    .getByRole("button", { name: /Undo/i })
    .click();
  await expect.poll(async () => (await stored()).textScale).toBe(100);
});

test("says what a partial restore left out", async ({ page }) => {
  // A file from a build that knew about something this one does not. The note
  // is what stops a partial restore reading as a complete one.
  await openBackupSettings(page);
  await page.setInputFiles(IMPORT, {
    name: "openradar-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      backup({ schemaVersion: 99, aSettingFromTheFuture: true }),
    ),
  });

  const toast = page.locator(".toast-host");
  await expect(toast).toContainText(/newer|not everything|left out/i);
});

test("refuses a file that is not a backup, and changes nothing", async ({
  page,
}) => {
  const stored = async () =>
    JSON.parse(
      (await page.evaluate(() =>
        window.localStorage.getItem("openradar.settings"),
      )) ?? "{}",
    ) as Record<string, unknown>;
  // Read after the workspace has written its own file rather than before:
  // it normalises and rewrites on the way up, so a snapshot taken too early
  // differs from the later one for a reason that has nothing to do with the
  // import.
  await expect.poll(async () => (await stored()).textScale).toBe(100);

  await openBackupSettings(page);
  await page.setInputFiles(IMPORT, {
    name: "not-a-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ this is not json at all"),
  });

  const toast = page.locator(".toast-host");
  await expect(toast).toContainText(/could not|not a|broken/i);
  // Nothing moved. A refusal that half-applied a file would be worse than one
  // that did nothing at all. Checked field by field, because the file that
  // was refused would have changed exactly these.
  const after = await stored();
  expect(after.textScale).toBe(100);
  expect(after.projection).toBe("mercator");
  expect((after.watch as { name?: string }).name).toBeUndefined();
});

test("refuses every file that is not a backup, whatever else it is", async ({
  page,
}) => {
  // The control says Restore from a file. Wired straight to the panel that
  // works out what it has been given, a GeoJSON inside its own `.json`
  // filter quietly added a map overlay, turned the custom overlay layer on
  // and closed Settings — with a toast that read like a success, because it
  // was one, for a thing nobody asked for.
  const stored = async () =>
    JSON.parse(
      (await page.evaluate(() =>
        window.localStorage.getItem("openradar.settings"),
      )) ?? "{}",
    ) as Record<string, unknown>;
  await expect.poll(async () => (await stored()).textScale).toBe(100);

  const files = [
    {
      name: "shapes.json",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "a shape" },
            geometry: { type: "Point", coordinates: [-93.6, 41.6] },
          },
        ],
      }),
    },
    {
      name: "outline.geojson",
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [-94, 41],
                [-93, 42],
              ],
            },
          },
        ],
      }),
    },
    {
      name: "a-placefile.txt",
      body: [
        "Title: A placefile",
        "RefreshSeconds: 60",
        "Color: 255 255 255",
        "Line: 2, 0",
        " -93.6, 41.6",
        " -93.5, 41.7",
        "End:",
      ].join("\n"),
    },
    {
      name: "colours.pal",
      body: ["Product: BR", "Color: 5 0 0 0", "Color: 75 255 255 255"].join(
        "\n",
      ),
    },
  ];

  for (const file of files) {
    await openBackupSettings(page);
    await page.setInputFiles(IMPORT, {
      name: file.name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(file.body),
    });

    const toast = page.locator(".toast-host");
    await expect(toast, file.name).toContainText("not a saved workspace");
    // And the panel is still open, which is the visible half of "nothing
    // changed": every path that accepted a file closed it.
    await expect(
      page.getByRole("heading", { name: "Settings" }),
      file.name,
    ).toBeVisible();
  }

  // Nothing a file could have changed did.
  const after = await stored();
  expect(after.textScale).toBe(100);
  expect((after.layers as { customOverlay?: boolean }).customOverlay).toBe(
    false,
  );
  expect(after.palettes).toEqual([]);
});

test("the picker is reachable from the keyboard", async ({ page }) => {
  // It is an input wearing a button. Hiding one with `display: none` takes it
  // out of the tab order and off a screen reader, and a control nobody can
  // reach is not a control.
  const control = await openBackupSettings(page);
  const input = control.locator('input[type="file"]');
  await input.focus();
  await expect(input).toBeFocused();
  const box = await input.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
});

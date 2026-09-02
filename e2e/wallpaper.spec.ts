import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * The current view on the desktop.
 *
 * The half worth holding out here rather than in a unit test is what happens
 * to somebody's own wallpaper: it is recorded before the first write and put
 * back the moment this is switched off. A feature that takes something of the
 * reader's away has to give it back through the real settings panel, not
 * through a function somebody remembered to call.
 */

async function start(page: Page, options: { windows?: boolean } = {}) {
  await page.addInitScript((windows: boolean) => {
    const calls: string[] = [];
    (window as unknown as { __wallpaper: string[] }).__wallpaper = calls;
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      transformCallback: (callback: unknown) => callback,
      invoke: async (command: string) => {
        if (command.startsWith("wallpaper_")) calls.push(command);
        if (command === "wallpaper_available") return windows;
        if (command === "journal_rows") return [];
        if (
          command === "incident_pack_list" ||
          command === "incident_pack_set_limit"
        ) {
          return { packs: [], usedBytes: 0, diskLimitBytes: 0 };
        }
        if (command === "plugin:store|load") return 1;
        if (command === "plugin:store|get") {
          return [null, false];
        }
        return null;
      },
    };
  }, options.windows ?? true);
  await routeWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

function chosen(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __wallpaper: string[] }).__wallpaper,
  );
}

test("gives the reader their own wallpaper back when it is switched off", async ({
  page,
}) => {
  await start(page);
  const control = page.locator("[data-wallpaper-setting] select");
  await expect(control).toBeEnabled();
  await control.selectOption("60");
  // Nothing is put back while it is on: that would undo the picture it just
  // wrote.
  expect(await chosen(page)).not.toContain("wallpaper_restore");
  await control.selectOption("0");
  await expect
    .poll(async () => await chosen(page))
    .toContain("wallpaper_restore");
});

test("offers no gap that would ask a public service for a frame a minute", async ({
  page,
}) => {
  await start(page);
  await expect(page.locator("[data-wallpaper-setting] select")).toBeEnabled();
  const gaps = await page
    .locator("[data-wallpaper-setting] select option")
    .evaluateAll((options) =>
      options.map((option) => Number((option as HTMLOptionElement).value)),
    );
  expect(gaps).toContain(0);
  for (const gap of gaps) {
    if (gap === 0) continue;
    expect(gap, String(gap)).toBeGreaterThanOrEqual(15);
  }
});

test("says so on a machine that cannot do it", async ({ page }) => {
  await start(page, { windows: false });
  const setting = page.locator("[data-wallpaper-setting]");
  await expect(setting).toContainText("Windows thing");
  await expect(setting.locator("select")).toBeDisabled();
});

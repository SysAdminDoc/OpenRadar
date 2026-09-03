import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { fakeDesktop, routeWorkspace } from "./support/fixtures";

/**
 * What the app is holding on disk, and giving it back.
 *
 * The cache fills as somebody uses the map and evicts on its own budget,
 * which is right and invisible. What was missing is a remedy: the size was in
 * Diagnostics, where nobody goes looking for it, and emptying it meant
 * finding the directory by hand.
 */

/**
 * The cache, as the native side would answer for it.
 *
 * The first clear leaves something behind, which is what an entry whose file
 * could not be removed looks like from here. It is the case that separates a
 * row that reads the size back from one that assumes emptying worked: with a
 * fake that always ends at zero, both are green.
 */
async function fakeCache(page: Page, bytes: number, residue = 0) {
  await page.addInitScript(
    (held: { bytes: number; residue: number }) => {
      const state = { bytes: held.bytes, residue: held.residue, cleared: 0 };
      (window as unknown as { __cacheTest: typeof state }).__cacheTest = state;
      (
        window as unknown as {
          __answer: (command: string) => [unknown] | undefined;
        }
      ).__answer = (command: string) => {
        if (command === "cache_size") {
          return [{ entries: state.bytes > 0 ? 412 : 0, bytes: state.bytes }];
        }
        if (command === "cache_clear") {
          const left = state.cleared === 0 ? state.residue : 0;
          const freed = state.bytes - left;
          state.bytes = left;
          state.cleared += 1;
          return [{ entries: 412, bytes: freed }];
        }
        return undefined;
      };
    },
    { bytes, residue },
  );
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const row = page.locator("[data-storage]");
  await row.scrollIntoViewIfNeeded();
  return row;
}

test("says how much is kept and gives it back", async ({ page }) => {
  await fakeCache(page, 148 * 1024 * 1024, 3 * 1024 * 1024);
  await fakeDesktop(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const row = await openSettings(page);
  // The number before, in the same words the pack ceiling uses.
  await expect(row.locator("[data-storage-size]")).toHaveText("148 MB");

  await row.getByRole("button", { name: "Clear" }).click();

  // What came back, said out loud rather than left to be inferred from a
  // number that changed while nobody was looking. Three megabytes would not
  // go, so 145 came back rather than 148.
  await expect(page.locator(".toast-host")).toContainText("145 MB");
  // And the row is READ AGAIN rather than assumed to be empty. An entry whose
  // file could not be removed is still there and still taking the space, and
  // a row that wrote zero over it would be telling a reader the disk is free
  // when it is not.
  await expect(row.locator("[data-storage-size]")).toHaveText("3.0 MB");
  await expect(row.getByRole("button", { name: "Clear" })).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __cacheTest: { cleared: number } }).__cacheTest
          .cleared,
    ),
  ).toBe(1);

  // Pressed again, it takes the rest, and then there is nothing to press.
  await row.getByRole("button", { name: "Clear" }).click();
  await expect(row.locator("[data-storage-size]")).toHaveText("0 MB");
  await expect(row.getByRole("button", { name: "Clear" })).toBeDisabled();
});

test("is clean in both themes with a size in it", async ({ page }) => {
  await fakeCache(page, 148 * 1024 * 1024);
  await fakeDesktop(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await openSettings(page);
  await expectClean(page, "storage in dark");

  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectClean(page, "storage in light");
});

test("says there is nothing on disk in a browser", async ({ page }) => {
  // No desktop stub at all: this is the browser preview, where the cache is
  // the webview's own and the app has nothing to offer.
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const row = await openSettings(page);
  await expect(row).toContainText("Nothing is kept on disk in a browser");
  await expect(row.getByRole("button", { name: "Clear" })).toHaveCount(0);
});

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
          // `removed` and `freed`, not `entries` and `bytes`: what came back
          // is a different thing from what was held, and the native side
          // says so with a type of its own.
          return [{ removed: 412, freed }];
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
  // And ON SCREEN, which `toHaveText` cannot see: it reads `textContent`,
  // which is there whatever the geometry. The button is `.secondary-button`,
  // which is `width: 100%`, and at equal specificity that won the cascade:
  // the button took the whole row and the number was painted at zero width
  // underneath it, with three tests looking straight at it and none able to
  // tell.
  const drawn = async (selector: string) => {
    const box = await row.locator(selector).boundingBox();
    return {
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    };
  };
  expect((await drawn("[data-storage-size]")).width).toBeGreaterThan(20);
  expect((await drawn("strong")).width).toBeGreaterThan(20);
  const clear = await drawn(".storage-row__clear");
  const whole = await drawn(":scope");
  expect(clear.width).toBeLessThan(whole.width * 0.75);
  // And the row does not overflow itself, which is the other way a squeezed
  // column shows up.
  expect(
    await row.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);

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

test("says what clearing costs when there is no network", async ({ page }) => {
  // The last view IS this cache. Offline, emptying it is the difference
  // between opening on what you saw and opening on nothing, and the ordinary
  // line — "the map will fetch what it needs again" — is not true there.
  await fakeCache(page, 148 * 1024 * 1024);
  await fakeDesktop(page);
  await routeWorkspace(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
  });
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const row = await openSettings(page);
  await row.getByRole("button", { name: "Clear" }).click();

  const toast = page.locator(".toast-host");
  await expect(toast).toContainText("offline");
  await expect(toast).toContainText("last view has gone");
  await expect(toast).not.toContainText("will fetch what it needs again");
});

test("does not offer a size it has not read yet", async ({ page }) => {
  // "Not readable" and "not read yet" are different things, and folding them
  // together said the first for the fraction of a second before every read
  // while leaving Clear pressable over a number nobody had.
  await page.addInitScript(() => {
    const state = { release: () => {} };
    (window as unknown as { __cacheGate: typeof state }).__cacheGate = state;
    const waited = new Promise<void>((done) => {
      state.release = done;
    });
    (
      window as unknown as {
        __answer: (command: string) => [unknown] | undefined;
      }
    ).__answer = (command: string) => {
      if (command === "cache_size") {
        return [waited.then(() => ({ entries: 1, bytes: 1024 * 1024 }))];
      }
      return undefined;
    };
  });
  await fakeDesktop(page);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  const row = await openSettings(page);
  await expect(row.locator("[data-storage-size]")).toHaveText("Reading");
  await expect(row.getByRole("button", { name: "Clear" })).toBeDisabled();

  await page.evaluate(() =>
    (
      window as unknown as { __cacheGate: { release: () => void } }
    ).__cacheGate.release(),
  );
  await expect(row.locator("[data-storage-size]")).toHaveText("1.0 MB");
  await expect(row.getByRole("button", { name: "Clear" })).toBeEnabled();
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

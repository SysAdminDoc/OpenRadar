import { expect, test } from "@playwright/test";

/**
 * The small window that answers "is it about to rain" without the workspace.
 *
 * Its own page, and that is the thing worth holding: a second live map would
 * be a second WebGL context and a few hundred megabytes for a window whose
 * whole job is one glance.
 */

async function open(
  page: import("@playwright/test").Page,
  glance: Record<string, unknown> | null,
) {
  await page.addInitScript((value: Record<string, unknown> | null) => {
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string) => path,
      transformCallback: (callback: unknown) => callback,
      invoke: async (command: string) => {
        if (command === "glance_read") return value;
        if (command === "plugin:store|load") return 1;
        if (command === "plugin:store|get") return [null, false];
        return null;
      },
    };
  }, glance);
  await page.goto("/glance.html");
}

test("says the place, the state and how old the picture is", async ({
  page,
}) => {
  await open(page, {
    place: "Casa",
    warning: true,
    headline: "Tornado Warning",
    picture: "",
    observed: Date.now() - 4 * 60_000,
    source: "MRMS",
    at: Date.now(),
  });
  const glance = page.locator(".glance");
  await expect(glance).toBeVisible();
  await expect(glance).toContainText("Casa");
  await expect(glance).toContainText("Tornado Warning");
  await expect(glance).toContainText("MRMS");
  await expect(glance).toHaveAttribute("data-warning", "1");
});

test("says plainly when nothing is standing", async ({ page }) => {
  await open(page, {
    place: "Casa",
    warning: false,
    headline: "",
    picture: "",
    observed: Date.now(),
    source: "MRMS",
    at: Date.now(),
  });
  const glance = page.locator(".glance");
  await expect(glance).toContainText("Nothing standing");
  await expect(glance).not.toHaveAttribute("data-warning", "1");
});

test("draws no map of its own", async ({ page }) => {
  await open(page, null);
  // The whole reason it is a second page. A canvas here would mean a second
  // WebGL context beside a workspace that already has one.
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".glance")).toContainText("Waiting");
});

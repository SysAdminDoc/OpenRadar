import { expect, test } from "@playwright/test";

/**
 * The small window that answers "is it about to rain" without the workspace.
 *
 * Its own page, and that is the thing worth holding: a second live map would
 * be a second WebGL context and a few hundred megabytes for a window whose
 * whole job is one glance.
 */

/** One transparent pixel, so the drawing branch has something to draw. */
const transparentPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function open(
  page: import("@playwright/test").Page,
  glance: Record<string, unknown> | null,
  settings: Record<string, unknown> | null = null,
) {
  await page.addInitScript(
    (value: {
      glance: Record<string, unknown> | null;
      settings: Record<string, unknown> | null;
    }) => {
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: (path: string) => path,
        transformCallback: (callback: unknown) => callback,
        invoke: async (command: string) => {
          if (command === "glance_read") return value.glance;
          // The store answers only because this window has a capability
          // granting it. It did not for a version, and Tauri rejected the
          // load: `loadSettings` caught that and answered with the defaults,
          // so the window came up in English beside a French workspace.
          if (command === "plugin:store|load") return 1;
          if (command === "plugin:store|get")
            return value.settings ? [value.settings, true] : [null, false];
          // Anything else is a command this window has no business calling,
          // and answering null would hide it inside whatever asked.
          throw new Error(`the glance window invoked ${command}`);
        },
      };
    },
    { glance, settings },
  );
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
    observedMs: Date.now() - 4 * 60_000,
    source: "MRMS",
    at: Date.now(),
  });
  const glance = page.locator(".glance");
  await expect(glance).toBeVisible();
  await expect(glance).toContainText("Casa");
  await expect(glance).toContainText("Tornado Warning");
  await expect(glance).toContainText("MRMS");
  // The number, not just that a number is there. It went unasserted, and the
  // workspace was handing over a frame time in seconds against a window
  // subtracting it from milliseconds: a four minute old picture read as
  // twenty-nine million minutes old, for every reader, on every open.
  await expect(glance).toContainText(/\b4 minutes old/);
  await expect(glance).toHaveAttribute("data-warning", "1");
});

test("says plainly when nothing is standing", async ({ page }) => {
  await open(page, {
    place: "Casa",
    warning: false,
    headline: "",
    picture: "",
    observedMs: Date.now(),
    source: "MRMS",
    at: Date.now(),
  });
  const glance = page.locator(".glance");
  await expect(glance).toContainText("Nothing standing");
  await expect(glance).not.toHaveAttribute("data-warning", "1");
});

test("draws no map of its own", async ({ page }) => {
  // With something to show, not with nothing: the empty branch is one
  // paragraph, so counting canvases there proves nothing about the branch
  // that actually draws.
  await open(page, {
    place: "Casa",
    warning: false,
    headline: "",
    picture: transparentPng,
    observedMs: Date.now() - 60_000,
    source: "MRMS",
    at: Date.now(),
  });
  await expect(page.locator(".glance img")).toBeVisible();
  // The whole reason it is a second page. A canvas here would mean a second
  // WebGL context beside a workspace that already has one.
  await expect(page.locator("canvas")).toHaveCount(0);

  await open(page, null);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".glance")).toContainText("Waiting");
});

test("speaks the language the workspace is in", async ({ page }) => {
  // The window reads the settings through the store plugin, which Tauri gates
  // per window. With only the main window named in the capability files, the
  // read was rejected, the catch answered with the defaults, and this window
  // was the one English surface in a French app.
  await open(
    page,
    {
      place: "Chez moi",
      warning: false,
      headline: "",
      picture: "",
      observedMs: null,
      source: "MRMS",
      at: Date.UTC(2026, 8, 2, 12, 0),
    },
    { language: "fr" },
  );
  const glance = page.locator(".glance");
  await expect(glance).toContainText("Rien en cours là où vous surveillez");
});

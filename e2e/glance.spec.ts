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

/** What a colour actually paints as, composited, in this page. */
async function painted(
  page: import("@playwright/test").Page,
  selector: string,
) {
  return page.evaluate((css: string) => {
    const node = document.querySelector(css)!;
    const seen = getComputedStyle(node);
    // Through a canvas, because a computed colour can come back as `oklch(...)`
    // or a `color-mix`, and reading the numbers out of those as if they were
    // sRGB reports contrasts that are not there.
    const read = (value: string) => {
      const paint = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true })!;
      paint.canvas.width = 1;
      paint.canvas.height = 1;
      paint.fillStyle = "#ffffff";
      paint.fillRect(0, 0, 1, 1);
      paint.fillStyle = value;
      paint.fillRect(0, 0, 1, 1);
      const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
      return [red, green, blue] as [number, number, number];
    };
    return {
      ink: read(seen.color),
      ground: read(getComputedStyle(document.body).backgroundColor),
    };
  }, selector);
}

/** WCAG contrast of two painted colours. */
function contrast(
  one: [number, number, number],
  two: [number, number, number],
) {
  const light = ([red, green, blue]: [number, number, number]) => {
    const channel = (value: number) => {
      const part = value / 255;
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    );
  };
  const [high, low] = [light(one), light(two)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test("comes up in the theme the workspace is in", async ({ page }) => {
  // It was dark whatever the reader had chosen: a small dark window beside a
  // light workspace, with nothing anywhere saying it was meant to be. The
  // stylesheet said dark-only was deliberate; the reader was never told.
  await open(
    page,
    {
      place: "Home",
      warning: true,
      headline: "Tornado Warning",
      picture: "",
      observedMs: Date.now() - 60_000,
      source: "MRMS",
      at: Date.now(),
    },
    { theme: "light" },
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // A light surface, not a dark one with a light attribute on it.
  const words = await painted(page, ".glance__words span");
  expect(words.ground[0]).toBeGreaterThan(200);
  // And the warning line, which is the one thing this window raises its voice
  // about, still carries on it.
  expect(contrast(words.ink, words.ground)).toBeGreaterThan(4.5);

  const aside = await painted(page, ".glance__words small");
  expect(contrast(aside.ink, aside.ground)).toBeGreaterThan(4.5);
});

test("stays dark when the workspace is", async ({ page }) => {
  await open(
    page,
    {
      place: "Home",
      warning: false,
      headline: "",
      picture: "",
      observedMs: null,
      source: "MRMS",
      at: Date.now(),
    },
    { theme: "dark" },
  );
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  const words = await painted(page, ".glance__words span");
  expect(words.ground[0]).toBeLessThan(60);
  expect(contrast(words.ink, words.ground)).toBeGreaterThan(4.5);
});

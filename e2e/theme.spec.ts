import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * A theme restyles the workspace around the map and nothing on it.
 *
 * The unit tests hold the boundary in the source: the token list, the parser,
 * and the fact that no module drawing a reading reads a custom property. This
 * holds it where a reader would notice, in a running window with a colour
 * somebody picked: the accent moves, the reflectivity bar beside the map does
 * not, and more contrast still wins.
 */
const ACCENT = "#ff8a3d";

async function startWith(page: Page, theme: unknown, look = "dark") {
  await page.addInitScript(
    (value) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({
          schemaVersion: 3,
          theme: (value as { look: string }).look,
          workspaceTheme: (value as { theme: unknown }).theme,
        }),
      );
    },
    { theme, look },
  );
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

function token(page: Page, name: string) {
  return page.evaluate(
    (property) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(property)
        .trim(),
    name,
  );
}

/** What the reflectivity bar is actually painted with, resolved by the browser. */
function rampPaint(page: Page) {
  return page
    .locator(".legend-ramp")
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundImage);
}

test("a personal accent moves the chrome and leaves the scale alone", async ({
  page,
}) => {
  await startWith(page, null);
  const plainAccent = await token(page, "--accent");
  const plainRamp = await rampPaint(page);
  expect(plainAccent).not.toBe("");
  expect(plainRamp).toContain("gradient");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Accent colour").fill(ACCENT);

  await expect.poll(() => token(page, "--accent")).toBe(ACCENT);
  // The bar the radar is read against is drawn from its own colours, so a
  // colour somebody picked for the workspace cannot reach it.
  expect(await rampPaint(page)).toBe(plainRamp);

  // And one action puts it back.
  await page.getByRole("button", { name: "Back to the built-in look" }).click();
  await expect.poll(() => token(page, "--accent")).toBe(plainAccent);
  await expect(page.locator("#workspace-theme")).toHaveCount(0);
});

test("more contrast outranks a theme", async ({ page }) => {
  await startWith(page, {
    name: "Loud",
    base: "dark",
    tokens: { Border: "rgba(255, 0, 0, 0.2)", Accent: ACCENT },
  });
  await expect.poll(() => token(page, "--border")).toBe("rgba(255, 0, 0, 0.2)");

  // A reader who has asked the system for more contrast gets the border the
  // stylesheet reserves for it, whatever a theme file said.
  await page.emulateMedia({ contrast: "more" });
  await expect
    .poll(() => token(page, "--border"))
    .toBe("rgba(200, 214, 235, 0.42)");
  // The accent is not one of the tokens more contrast redefines, so the
  // reader's own colour survives.
  expect(await token(page, "--accent")).toBe(ACCENT);

  await page.emulateMedia({ contrast: "no-preference" });
  await expect.poll(() => token(page, "--border")).toBe("rgba(255, 0, 0, 0.2)");
});

test("a stored theme that was hand-edited only brings what the parser allows", async ({
  page,
}) => {
  await startWith(page, {
    name: "Edited",
    base: "dark",
    tokens: {
      Accent: ACCENT,
      // Neither of these is a token a theme can set, and the second one is
      // trying to reach a hazard colour rather than a chrome one.
      Danger: "#00ff00",
      Text: "#00ff00",
    },
  });
  await expect.poll(() => token(page, "--accent")).toBe(ACCENT);
  expect(await token(page, "--danger")).not.toBe("#00ff00");
  expect(await token(page, "--text")).not.toBe("#00ff00");
  expect(await page.locator("#workspace-theme").textContent()).not.toContain(
    "--danger",
  );
});

// Both built-in looks, because a theme that applies in one and not the other
// is the failure this ran into: the light look is a more specific selector
// than a plain `:root`, so a theme written as one silently did nothing for
// every reader who prefers light.
for (const look of ["dark", "light"] as const) {
  test(`a theme reaches the tokens in the ${look} look`, async ({ page }) => {
    await startWith(page, null, look);
    const plain = await token(page, "--accent");
    const plainSurface = await token(page, "--surface");

    await startWith(
      page,
      {
        name: "Loud",
        base: look,
        tokens: { Accent: ACCENT, Surface: "rgba(255, 0, 0, 0.9)" },
      },
      look,
    );
    await expect.poll(() => token(page, "--accent")).toBe(ACCENT);
    await expect
      .poll(() => token(page, "--surface"))
      .toBe("rgba(255, 0, 0, 0.9)");
    expect(plain).not.toBe(ACCENT);
    expect(plainSurface).not.toBe("rgba(255, 0, 0, 0.9)");
  });
}

// The browser draws parts of the page itself: a select's dropdown list, a
// number spinner, a date picker's popup, a scrollbar. Which palette it uses
// is `color-scheme`, and nothing set it, so all of them were the light
// default inside a dark workspace and the quiet-hours time fields had a black
// clock face on white.
for (const look of ["dark", "light"] as const) {
  test(`tells the browser to draw its own parts in the ${look} look`, async ({
    page,
  }) => {
    await startWith(page, null, look);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
    ).toBe(look);
  });
}

test("paints every control a panel puts on screen", async ({ page }) => {
  // Anything not explicitly painted takes the browser's own box, which
  // without `color-scheme` is white with black text inside a dark panel.
  // `color-scheme` alone makes it a grey that is merely not the panel's, so
  // this asks for the panel's own surface rather than for "not white".
  await startWith(page, null, "dark");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();

  // Through a probe rather than the token's text: a token is written as hex
  // or as rgba and a computed style always comes back as rgb.
  const panel = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--surface)";
    probe.style.color = "var(--text)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const read = { background: style.backgroundColor, colour: style.color };
    probe.remove();
    return read;
  });
  const controls = page.locator(
    ".settings-field input, .settings-field select",
  );
  const count = await controls.count();
  expect(count, "no controls were found to check").toBeGreaterThan(1);
  for (let at = 0; at < count; at += 1) {
    const painted = await controls.nth(at).evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });
    expect(painted.background, `control ${at} background`).toBe(
      panel.background,
    );
    expect(painted.colour, `control ${at} colour`).toBe(panel.colour);
  }
});

test("the reader's own accent reaches the command rail", async ({ page }) => {
  // The rail is a fixed dark surface, so it cannot take the workspace accent
  // straight: in the light theme that is 3.65:1 on an 8px label and under the
  // calmer look 2.90. The first fix replaced it with a fixed blue, which
  // fixed the contrast and quietly threw away the colour the reader chose,
  // while the setting for it still says it reaches the focus ring.
  await startWith(page, {
    name: "Warm",
    base: "dark",
    tokens: { Accent: ACCENT },
  });
  await expect.poll(() => token(page, "--accent")).toBe(ACCENT);

  const rail = await page.evaluate(() => {
    // Through a canvas, because a colour built from `oklch(from ...)` is
    // still an oklch string when it comes back out of a computed style and
    // nothing downstream can read its channels.
    const paint = document.createElement("canvas").getContext("2d")!;
    const toRgb = (colour: string) => {
      paint.fillStyle = "#000";
      paint.fillStyle = colour;
      paint.clearRect(0, 0, 1, 1);
      paint.fillRect(0, 0, 1, 1);
      const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
      return `rgb(${red}, ${green}, ${blue})`;
    };
    const bar = document.querySelector(".command-bar")!;
    const probe = document.createElement("div");
    probe.style.color = "var(--command-accent)";
    bar.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return {
      ink: toRgb(ink),
      said: ink,
      ground: toRgb(getComputedStyle(bar).backgroundColor),
    };
  });

  // The relative colour really resolved, rather than the fallback standing.
  expect(rail.said).not.toBe("rgb(75, 192, 255)");

  const channels = (colour: string) =>
    (colour.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (colour: string) => {
    const [red, green, blue] = channels(colour);
    const part = (value: number) => {
      const ratio = value / 255;
      return ratio <= 0.03928
        ? ratio / 12.92
        : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * part(red) + 0.7152 * part(green) + 0.0722 * part(blue);
  };
  const [red, green, blue] = channels(rail.ink);

  // Their hue, not ours: the app's own accent is a blue, and this one is not.
  expect(red, `${rail.ink} should be warm`).toBeGreaterThan(blue);
  expect(green).toBeGreaterThan(blue);

  // And still legible on the bar, which is what the fixed colour bought.
  const light = Math.max(luminance(rail.ink), luminance(rail.ground));
  const dark = Math.min(luminance(rail.ink), luminance(rail.ground));
  expect(
    (light + 0.05) / (dark + 0.05),
    `${rail.ink} on ${rail.ground}`,
  ).toBeGreaterThanOrEqual(4.5);
});

test("the map credits are readable over the light basemap", async ({
  page,
}) => {
  // The basemap follows the theme, so in light these three links sit on a
  // light map. They were near-white with nothing behind them, at about
  // 1.03:1. The readout beside them got a light counterpart when the theme
  // was added and this did not.
  await startWith(page, null, "light");
  const credits = page.locator(".source-attribution");
  await expect(credits).toBeVisible();

  const paint = await credits.evaluate((node) => {
    const style = getComputedStyle(node);
    return { ink: style.color, ground: style.backgroundColor };
  });
  const channels = (colour: string) =>
    (colour.match(/[\d.]+/g) ?? []).map(Number);
  const luminance = (colour: string) => {
    const [red, green, blue] = channels(colour);
    const part = (value: number) => {
      const ratio = value / 255;
      return ratio <= 0.03928
        ? ratio / 12.92
        : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * part(red) + 0.7152 * part(green) + 0.0722 * part(blue);
  };

  // Dark ink, and something behind it: over a map the ground is the only
  // thing that makes the contrast a promise rather than a hope.
  expect(luminance(paint.ink)).toBeLessThan(0.2);
  expect(channels(paint.ground)[3] ?? 1).toBeGreaterThan(0.5);
  const light = Math.max(luminance(paint.ink), luminance(paint.ground));
  const dark = Math.min(luminance(paint.ink), luminance(paint.ground));
  expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
});

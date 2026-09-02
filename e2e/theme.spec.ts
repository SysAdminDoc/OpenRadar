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

/**
 * The composited contrast of one element against everything behind it.
 *
 * axe cannot answer this: the tint is translucent over a translucent panel,
 * and it returns "incomplete" rather than "fails" for a stack like that, so
 * a run comes back clean with the colour still wrong.
 */
async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((wanted) => {
    const node = document.querySelector(wanted);
    if (!node) throw new Error(`${wanted} is not on the page`);
    // Through a canvas, painted and sampled rather than read back as a
    // string. A colour built with `oklch(from ...)` or `color-mix` comes out
    // of a computed style still written that way, and out of `fillStyle`
    // written that way too, so reading either as red, green and blue gives a
    // figure that means nothing: a first version measured `0.87 0.16 90` as a
    // colour and reported 1.02:1 for a pale yellow on near-black.
    const paint = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    })!;
    const channels = (colour: string) => {
      paint.fillStyle = "#000";
      paint.fillStyle = colour;
      paint.clearRect(0, 0, 1, 1);
      paint.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = paint.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha / 255];
    };
    const luminance = ([red, green, blue]: number[]) => {
      const part = (value: number) => {
        const ratio = value / 255;
        return ratio <= 0.03928
          ? ratio / 12.92
          : ((ratio + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * part(red) + 0.7152 * part(green) + 0.0722 * part(blue);
    };
    const layers: number[][] = [];
    for (
      let element: Element | null = node;
      element;
      element = element.parentElement
    ) {
      const [red, green, blue, alpha = 1] = channels(
        getComputedStyle(element).backgroundColor,
      );
      if (alpha > 0) layers.push([red, green, blue, alpha]);
      if (alpha === 1) break;
    }
    let ground = [255, 255, 255];
    for (const [red, green, blue, alpha] of layers.reverse()) {
      ground = [
        alpha * red + (1 - alpha) * ground[0],
        alpha * green + (1 - alpha) * ground[1],
        alpha * blue + (1 - alpha) * ground[2],
      ];
    }
    const ink = channels(getComputedStyle(node).color);
    const light = Math.max(luminance(ink), luminance(ground));
    const dark = Math.min(luminance(ink), luminance(ground));
    return (light + 0.05) / (dark + 0.05);
  }, selector);
}

// Undo is the only way back from something the reader did not mean to do.
// The plain accent on its own tint is 3.91:1 on a light ground; the strong
// one is 4.18 in the dark calmer look. Neither colour is right for both.
//
// Four page loads rather than four attribute writes. Setting `data-theme`
// and `data-calm` by hand and measuring in the same breath gave the same
// number for calm as for plain: the root's own custom properties change, and
// a descendant's inherited copy does not catch up until the page has settled.
// The workspace owns those attributes, so it is asked to set them.
for (const look of ["dark", "light"] as const) {
  for (const calm of [false, true] as const) {
    const name = `${look}${calm ? " in the calmer look" : ""}`;
    test(`the way back from a toast is readable in ${name}`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value: { look: string; calm: boolean }) => {
          window.localStorage.setItem(
            "openradar.settings",
            JSON.stringify({
              schemaVersion: 3,
              theme: value.look,
              calm: value.calm,
            }),
          );
        },
        { look, calm },
      );
      await routeWorkspace(page);
      await page.goto("/?testMode=1");
      await expect(page.getByRole("application")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", look);
      if (calm) {
        await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
      }

      // The app's own markup in the app's own host, so the ground under the
      // action is the ground a real toast gives it.
      await page.evaluate(() => {
        const host = document.querySelector(".toast-host")!;
        const toast = document.createElement("div");
        toast.className = "toast";
        const action = document.createElement("button");
        action.type = "button";
        action.className = "toast__action";
        action.textContent = "Undo";
        toast.append(action);
        host.append(toast);
      });

      expect(await contrastOf(page, ".toast__action")).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
}

// A pale accent is one click away: the colour well in Settings takes any
// colour at all. Choosing the ink per theme fixed the built-in palettes and
// handed a reader who picked a pale yellow white text on it, at 1.44:1. The
// fill is what moves now, so the fixed ink clears whatever they choose.
for (const look of ["dark", "light"] as const) {
  test(`a pale accent of the reader's own stays readable in ${look}`, async ({
    page,
  }) => {
    await startWith(
      page,
      { name: "Pale", base: look, tokens: { Accent: "#ffd166" } },
      look,
    );
    await expect.poll(() => token(page, "--accent")).toBe("#ffd166");
    // A probe carrying the two tokens, because the pair is what is under
    // test: every filled accent in the app is `--accent-ink` on
    // `--accent-fill`, and the Live button in a workspace with no frames yet
    // is the disabled one, which is deliberately not filled at all.
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "accent-fill-probe";
      probe.style.background = "var(--accent-fill)";
      probe.style.color = "var(--accent-ink)";
      probe.textContent = "Live";
      document.body.append(probe);
    });
    expect(await contrastOf(page, "#accent-fill-probe")).toBeGreaterThanOrEqual(
      4.5,
    );

    // And it is still their colour. Readable is easy if the fill quietly
    // falls back to the app's own blue and ignores what they picked.
    const fill = await page.locator("#accent-fill-probe").evaluate((node) => {
      const paint = document.createElement("canvas").getContext("2d")!;
      paint.fillStyle = getComputedStyle(node).backgroundColor;
      paint.fillRect(0, 0, 1, 1);
      const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
      return { red, green, blue };
    });
    expect(fill.red, JSON.stringify(fill)).toBeGreaterThan(fill.blue);
    expect(fill.green, JSON.stringify(fill)).toBeGreaterThan(fill.blue);
  });
}

test("the button that is already live does not look like the one you press", async ({
  page,
}) => {
  // Both were filled, a colour apart, and under the spring pack the accent
  // IS a green: 1.13:1 between them, with `opacity: 1` taking away the only
  // other cue. The one you cannot press is not filled at all now.
  await startWith(page, null, "light");
  const button = page.locator(".timeline-live-button");
  await expect(button).toBeVisible();

  const seen = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    const probe = document.createElement("div");
    probe.style.background = "var(--accent-fill)";
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.style.background = "var(--surface-raised)";
    const raised = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      background: style.backgroundColor,
      disabled: (node as HTMLButtonElement).disabled,
      fill,
      raised,
    };
  });

  if (seen.disabled) {
    expect(seen.background).toBe(seen.raised);
    expect(seen.background).not.toBe(seen.fill);
  } else {
    expect(seen.background).toBe(seen.fill);
  }
});

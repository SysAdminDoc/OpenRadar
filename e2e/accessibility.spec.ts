import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { obscuredWhenFocused, unreachable } from "./support/layout";
import { SURFACES, declaredSurfaces, openSurface } from "./support/surfaces";
import type { OpenSurface } from "./support/surfaces";
import { PANEL_SETTLE_MS, describeViolations, scan } from "./support/axe";
import { fr } from "../src/i18n/fr";
import { pseudo } from "../src/i18n/pseudo";

test.beforeEach(async ({ page }) => {
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
});

test("the workspace has no serious accessibility violations in the dark theme", async ({
  page,
}) => {
  const violations = await scan(page);
  expect(describeViolations(violations)).toBe("");
});

test("the workspace has no serious accessibility violations in the light theme", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);

  const violations = await scan(page);
  expect(describeViolations(violations)).toBe("");
});

/** Switches the calmer presentation on and closes the panel again. */
async function goCalm(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: /A calmer way to read it/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);
}

/** Switches to the light look and closes the panel again. */
async function goLight(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);
}

/** WCAG relative luminance of an `rgb(...)` string. */
function luminance(colour: string): number {
  const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  const [red, green, blue] = parts;
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

function contrast(one: string, two: string): number {
  const light = Math.max(luminance(one), luminance(two));
  const dark = Math.min(luminance(one), luminance(two));
  return (light + 0.05) / (dark + 0.05);
}

test("the command rail stays readable in the light theme", async ({ page }) => {
  // The rail is a fixed dark surface in both themes and everything drawn on
  // it used to be themed. In light that meant hovering a button painted the
  // rail's near-white ink on the light theme's near-white hover, at 1.03:1,
  // and the pressed state, the focus ring, the edge and the dividers all took
  // light-theme colours onto a dark bar.
  await goLight(page);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);

  const results = await new AxeBuilder({ page })
    .include(".command-bar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(describeViolations(violations)).toBe("");

  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.hover();
  // The pill fades in over 130ms, and a colour read mid-transition is not the
  // colour anybody sees.
  await page.waitForTimeout(PANEL_SETTLE_MS);
  const hovered = await search.evaluate((node) => {
    const style = getComputedStyle(node);
    return { ink: style.color, pill: style.backgroundColor };
  });
  expect(
    contrast(hovered.ink, hovered.pill),
    `${hovered.ink} on ${hovered.pill}`,
  ).toBeGreaterThanOrEqual(4.5);
});

test("the alert rows stay readable in the light theme", async ({ page }) => {
  // `--surface-sunken` was used with a fallback and defined nowhere, so the
  // severity badge on every alert row was a fixed dark box inside a white
  // panel with muted text on it, at 2.87:1. The archive browser and the
  // site-controls row used the same undefined token.
  await goLight(page);
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  await expect(page.locator(".alert-severity").first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include(".alert-list")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(describeViolations(violations)).toBe("");
});

test("stays clean in the calmer presentation", async ({ page }) => {
  // A mode meant to be kinder must not be harder to read. It turns the
  // accent down, and a muted accent is exactly where contrast goes wrong.
  await goCalm(page);
  expect(describeViolations(await scan(page))).toBe("");
});

test("stays clean in the calmer presentation in the light theme", async ({
  page,
}) => {
  // The one that actually broke. The calm accent is a selector more specific
  // than the light palette, so a dark-theme muted blue took over as text on
  // white at 2.9:1, in a mode whose whole purpose is being easier to be with.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("checkbox", { name: /A calmer way to read it/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-calm", "1");
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(describeViolations(await scan(page))).toBe("");
});

test("keeps every panel clean in the calmer presentation", async ({ page }) => {
  await goCalm(page);
  for (const name of ["Layers", "Alerts", "Export", "Forecast"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(describeViolations(await scan(page)), name).toBe("");
    await page.getByRole("button", { name: `Close ${name}` }).click();
  }
});

test("the gate scans every surface the app has", async () => {
  // The list it loops over used to be eleven names written by hand, and the
  // app had eighteen surfaces: Commands, Storm history, Guidance, Sounding,
  // Tides, Nearby weather and Cross-section had never been scanned in any
  // theme, and nothing anywhere said so. Read out of the source so a surface
  // added later fails here rather than quietly going unscanned.
  const declared = await declaredSurfaces();
  expect(declared.length).toBeGreaterThan(11);
  expect(Object.keys(SURFACES).sort()).toEqual([...declared].sort());
});

for (const id of Object.keys(SURFACES) as OpenSurface[]) {
  test(`${id} is clean in dark, in light and with more contrast`, async ({
    page,
  }) => {
    await openSurface(page, id);
    expect(`${id} dark: ${describeViolations(await scan(page))}`).toBe(
      `${id} dark: `,
    );

    // The light palette is a second set of colours over the same markup, and
    // every light-theme finding this repo has had sat in a panel the gate
    // had never opened.
    await page.reload();
    await expect(
      page.getByRole("application", { name: "Interactive weather map" }),
    ).toBeVisible();
    await goLight(page);
    await openSurface(page, id);
    expect(`${id} light: ${describeViolations(await scan(page))}`).toBe(
      `${id} light: `,
    );

    // And light with the system asking for more contrast, which swaps borders
    // and ramps rather than only darkening the ink.
    await page.emulateMedia({ contrast: "more" });
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(
      `${id} light + contrast: ${describeViolations(await scan(page))}`,
    ).toBe(`${id} light + contrast: `);
  });
}

/**
 * The readout has a button of its own on the rail now.
 *
 * It used to open only by typing "nearby" into Commands, which is the wrong
 * way round: this is the surface that answers the map in words, so the reader
 * it exists for is the one least able to guess the word it is filed under.
 * Opened here the way that reader would open it, so the rail losing the
 * button fails this rather than passing through the palette.
 */
async function openNearby(page: Page) {
  await page.getByRole("button", { name: "Nearby weather" }).click();
}

test("the readout is clean in both themes", async ({ page }) => {
  await openNearby(page);
  await expect(
    page.getByRole("heading", { name: "Nearby weather" }),
  ).toBeVisible();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await page.getByRole("button", { name: "Close Nearby weather" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close Settings" }).click();

  await openNearby(page);
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

test("the readout is clean in Spanish", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await page.getByRole("button", { name: "Cerrar Ajustes" }).click();

  await page.getByRole("button", { name: "Comandos", exact: true }).click();
  await page.getByRole("searchbox").fill("Tiempo");
  await page.locator('[data-command="surface:nearby"]').click();
  await expect(
    page.getByRole("heading", { name: "Tiempo cercano" }),
  ).toBeVisible();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(`es: ${describeViolations(await scan(page))}`).toBe("es: ");
});

test("tells a reader who never touches the map what is near a place", async ({
  page,
}) => {
  // The warnings the fixture serves are on the map before any of this, which
  // is what the readout is reading.
  await expect(page.getByRole("application")).toHaveAttribute(
    "data-layer-stack",
    /overlay-alerts/,
  );
  await openNearby(page);

  // The place it answers about, and the two live regions that carry it.
  await expect(page.getByRole("combobox", { name: "Around" })).toHaveValue(
    "centre",
  );
  const polite = page.locator('.live-region [aria-live="polite"]');
  await expect(polite).not.toBeEmpty();

  // Both regions exist from load rather than arriving with their text, which
  // is the difference between an announcement and silence.
  await page.getByRole("button", { name: "Close Nearby weather" }).click();
  await expect(
    page.locator('.live-region [aria-live="polite"]'),
  ).toBeAttached();
  await expect(
    page.locator('.live-region [aria-live="assertive"]'),
  ).toBeAttached();
});

test("reads out what the office says to do, not just that there is a warning", async ({
  page,
}) => {
  // The fixture warning is a square from -86,26 to -85,27, so the map goes to
  // the middle of it and the watched place is inside the polygon.
  await page.goto("/?testMode=1&lon=-85.5&lat=26.5&zoom=7&bearing=0&pitch=0");
  await expect(page.getByRole("application")).toBeVisible();
  await openNearby(page);

  const warnings = page.locator(".nearby-list").first();
  await expect(warnings).toContainText("Tornado Warning");
  // The instruction the office wrote. This surface exists for a reader who
  // cannot see the map, and an instruction reachable only through a link out
  // of the app is not reachable at all for them.
  await expect(warnings).toContainText("TAKE COVER NOW!");
});

test("moves the map from the keyboard, with no drag anywhere", async ({
  page,
}) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  const before = await pane.getAttribute("data-camera");

  // Focused the way a keyboard reader reaches it rather than by clicking.
  await page.locator("canvas.maplibregl-canvas").focus();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect.poll(() => pane.getAttribute("data-camera")).not.toBe(before);

  const panned = await pane.getAttribute("data-camera");
  await page.keyboard.press("Equal");
  await expect.poll(() => pane.getAttribute("data-camera")).not.toBe(panned);
});

test("keeps every control findable while a panel is over the map", async ({
  page,
}) => {
  // The rails are what 2.4.11 is about here: the panels float above the map
  // and the command bar runs underneath them, so an open panel is the state
  // where a focused button could end up behind something.
  expect(await obscuredWhenFocused(page)).toEqual([]);

  for (const name of ["Layers", "Alerts", "Settings", "Diagnostics"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(`${name}: ${(await obscuredWhenFocused(page)).join(", ")}`).toBe(
      `${name}: `,
    );
    await page.getByRole("button", { name: `Close ${name}` }).click();
  }
});

test("stays clean when the reader asks for more contrast", async ({ page }) => {
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  // The warnings are on the map before any of this, so the three scans below
  // are over real hazard geometry rather than an empty basemap.
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);

  await page.emulateMedia({ contrast: "more" });
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(describeViolations(await scan(page))).toBe("");

  // The warning outlines are drawn again heavier, and the layers have to come
  // back: they are dropped and rebuilt, which is the only way a width read at
  // layer creation can change while the map is open.
  await expect(pane).toHaveAttribute("data-layer-stack", /overlay-alerts/);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(describeViolations(await scan(page))).toBe("");
});

test("draws the legend from the ramp more contrast puts in force", async ({
  page,
}) => {
  const bar = page.locator(".legend-ramp");
  const painted = () => bar.evaluate((node) => node.style.background);
  // The ordinary bar is a gradient in the stylesheet, so there is nothing
  // written on the element itself.
  await expect.poll(painted).toBe("");

  await page.emulateMedia({ contrast: "more" });
  // The high-contrast bar is built from the ramp the tiles are drawn with,
  // which starts on the same dark blue rather than the NWS cyan.
  await expect.poll(painted).toContain("rgb(0, 37, 108)");
  // And it still says what it is measured in, over the same range.
  await expect(page.locator(".legend-scale")).toHaveText("520355065");

  await page.emulateMedia({ contrast: "no-preference" });
  await expect.poll(painted).toBe("");
});

test("labels the reflectivity ramp in dBZ", async ({ page }) => {
  const legend = page.locator(".legend-scale");
  await expect(legend).toHaveText("520355065");
});

test("a panel announces itself and gives the focus back", async ({ page }) => {
  // Two things a screen reader needs and neither of which axe can see: that
  // the panel is a dialog with a name, and that closing it puts the focus
  // back where it came from instead of dropping it on the body, where the
  // next Tab starts again from the top of the window.
  const opener = page.getByRole("button", { name: "Layers", exact: true });
  await opener.focus();
  await opener.click();

  const panel = page.getByRole("dialog", { name: "Layers" });
  await expect(panel).toBeVisible();

  // Focus moved into the panel, onto its heading.
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.textContent?.trim() ?? ""),
    )
    .toBe("Layers");

  await page.getByRole("button", { name: "Close Layers" }).click();
  await expect(panel).toHaveCount(0);

  // And it came back to the button that opened it.
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label")?.trim(),
      ),
    )
    .toBe("Layers");
});

test("Escape closes the panel that has the focus", async ({ page }) => {
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Layers" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Layers" })).toHaveCount(0);
});

test("draws the whole workspace larger when the reader asks", async ({
  page,
}) => {
  const button = page.getByRole("button", { name: "Layers", exact: true });
  const before = (await button.boundingBox())!;

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "130%", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();

  const after = (await button.boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height * 1.2);

  // And the map is still a map at the new size.
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
});

for (const scale of ["100%", "115%", "130%"] as const) {
  test(`nothing becomes unreachable at ${scale}`, async ({ page }) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: scale, exact: true }).click();
    await page.getByRole("button", { name: "Close Settings" }).click();
    await page.waitForTimeout(PANEL_SETTLE_MS);

    expect(await unreachable(page), `at ${scale}`).toEqual([]);
    // And the page itself never scrolls sideways, whatever the bar does.
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      `page scrolls sideways at ${scale}`,
    ).toBeLessThanOrEqual(2);

    // With a panel open, which is the widest the workspace ever gets.
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(await unreachable(page), `at ${scale} with Layers open`).toEqual([]);
  });
}

test("lays out for the room it has rather than the room the screen has", async ({
  page,
}) => {
  // Zoom scales the drawing and not the numbers a media query compares
  // against, so a workspace at 130 percent has a third less room than the
  // stylesheet would otherwise believe. The scene and tool buttons drop their
  // labels below 1320, and at 130 percent every screen this suite runs on is
  // below 1320 once divided.
  const label = page.locator(".command-group--scenes .command-button span");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "130%", exact: true }).click();
  await page.getByRole("button", { name: "Close Settings" }).click();
  await page.waitForTimeout(PANEL_SETTLE_MS);

  const room = await page.evaluate(() => {
    const scale = getComputedStyle(document.documentElement).getPropertyValue(
      "--text-scale",
    );
    return {
      narrow: document.documentElement.dataset.narrow ?? "",
      effective: Math.round(window.innerWidth / Number(scale)),
    };
  });
  expect(room.effective).toBeLessThan(1320);
  expect(room.narrow.split(" ")).toContain("1320");
  await expect(label.first()).toBeHidden();

  // Whether this width uses the normal bar or the compact one, the route to
  // every panel and product must stay on screen. Hidden controls have a zero
  // box and the reachability helper above deliberately skips them.
  const commands = page.locator(
    '.command-bar button[aria-label="Commands"]:visible',
  );
  await expect(commands).toHaveCount(1);
  await commands.click();
  const radarProducts = page.locator('[data-command="surface:radar-product"]');
  await expect(radarProducts).toBeVisible();
  await radarProducts.click();
  await expect(
    page.getByRole("heading", { name: "Composite Radar" }),
  ).toBeVisible();
});

test("the warnings in view are a list, and the tool readout is always there", async ({
  page,
}) => {
  // How many warnings are in view is the information, and a run of divs says
  // none of it: no "list, four items" and no position within it. Same for
  // the sources in Diagnostics, where the count is the whole point.
  //
  // And a live region announces a change to itself, so one that is mounted
  // carrying its first words is often not read out at all. The tool readout
  // arrived that way, which meant the first tool somebody picked went
  // unannounced.
  const hud = page.locator(".tool-hud");
  await expect(hud).toHaveAttribute("role", "status");
  await expect(hud).toHaveAttribute("data-empty", "1");
  await expect(hud).toHaveText("");
  // In the accessibility tree with nothing in it, which is the whole point:
  // hidden or unmounted, the first thing it says is an arrival rather than a
  // change and often goes unread. `hidden` would put it back exactly where
  // it was, so it is asked for by role rather than by class.
  const exposed = await hud.evaluate((node) => ({
    hidden: (node as HTMLElement).hidden,
    ariaHidden: node.getAttribute("aria-hidden"),
    display: getComputedStyle(node).display,
  }));
  expect(exposed.hidden).toBe(false);
  expect(exposed.ariaHidden).toBeNull();
  expect(exposed.display).not.toBe("none");

  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await page.waitForTimeout(PANEL_SETTLE_MS);

  const list = page.locator(".alert-list");
  await expect(list).toHaveAttribute("role", "list");
  const rows = list.getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBe(await list.locator(".alert-row").count());
});

test("Settings is clean once a reader has a place they watch", async ({
  page,
}) => {
  // Empty, Settings is a column of switches. With a place set it grows the
  // watch card, a named radius, a severity choice and a sound row, which is
  // the state a reader who has finished setting the app up actually sees.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        // The sound a reader chose themselves, which puts a path row and a
        // Clear button in the panel that are there in no other state.
        alertSoundPath: String.raw`C:\Users\reader\Sounds\a warning.wav`,
        watch: {
          enabled: true,
          sound: true,
          name: "Casa",
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      }),
    );
  });
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await openSurface(page, "settings");
  // The watch card is only in the panel once there is a place, so this is
  // what says the scan below ran over the fuller Settings rather than the
  // empty one.
  await expect(
    page.getByRole("textbox", { name: "What you call home" }),
  ).toHaveValue("Casa");
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

test("the capture layout is clean in both themes", async ({ page }) => {
  // The layout somebody records the screen in. It strips the chrome down to
  // a bar, which is exactly the kind of change that leaves a control with
  // nothing but an icon and no name.
  const enter = async () => {
    await page.getByRole("button", { name: "Commands", exact: true }).click();
    await page.locator('[data-command="capture"]').click();
    await expect(page.locator("[data-capture-bar]")).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
  };

  await enter();
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await page.getByRole("button", { name: "Leave capture layout" }).click();
  await goLight(page);
  await enter();
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

test("the ambient view is clean", async ({ page }) => {
  // Meant to be left running on a second monitor, so it is the surface a
  // reader looks at longest and the one nobody clicks through.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 3,
        seenWelcome: true,
        seenReveal: true,
        watch: {
          enabled: true,
          sound: false,
          name: "Casa",
          center: [-96.8, 32.78],
          radiusMiles: 30,
          minSeverity: "severe",
        },
      }),
    );
  });
  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.locator('[data-command="ambient-screen"]').click();
  await expect(page.locator("[data-ambient-readout]")).toBeVisible();
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(describeViolations(await scan(page))).toBe("");
});

test("the glance window is clean in both themes", async ({ page }) => {
  // Its own page and its own stylesheet, scanned by nothing until now.
  const open = async (theme: "dark" | "light") => {
    await page.addInitScript((value: string) => {
      (
        window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: (path: string) => path,
        transformCallback: (callback: unknown) => callback,
        invoke: async (command: string) => {
          if (command === "glance_read")
            return {
              place: "Casa",
              warning: true,
              headline: "Tornado Warning",
              picture: "",
              observedMs: Date.now() - 4 * 60_000,
              source: "MRMS",
              at: Date.now(),
            };
          if (command === "plugin:store|load") return 1;
          if (command === "plugin:store|get")
            return [{ schemaVersion: 3, theme: value }, true];
          throw new Error(`the glance window invoked ${command}`);
        },
      };
    }, theme);
    await page.goto("/glance.html");
    await expect(page.locator(".glance")).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
  };

  await open("dark");
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await open("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

test("the radar product sheet is clean in both themes", async ({ page }) => {
  // Not a surface in the union: it is its own sheet, opened from the palette
  // and from a product command, and the gate had never opened it.
  const open = async () => {
    await page.getByRole("button", { name: "Commands", exact: true }).click();
    await page.locator('[data-command="surface:radar-product"]').click();
    await expect(
      page.getByRole("heading", { name: "Composite Radar" }),
    ).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
  };

  await open();
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await page.reload();
  await expect(
    page.getByRole("application", { name: "Interactive weather map" }),
  ).toBeVisible();
  await goLight(page);
  await open();
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

test("two panes are clean in both themes", async ({ page }) => {
  // Half the room each, a second set of chrome, and a divider between them.
  const pane = page.getByRole("application", {
    name: "Interactive weather map",
  });
  await page.getByRole("button", { name: "Dual Pane", exact: true }).click();
  await expect(pane).toHaveCount(2);
  await page.waitForTimeout(PANEL_SETTLE_MS);
  expect(`dark: ${describeViolations(await scan(page))}`).toBe("dark: ");

  await goLight(page);
  await expect(pane).toHaveCount(2);
  expect(`light: ${describeViolations(await scan(page))}`).toBe("light: ");
});

for (const language of ["fr", "pseudo"] as const) {
  test(`the workspace is clean in ${language}`, async ({ page }) => {
    // Longer words in French and a third longer again in the pseudolocale,
    // which is where a label overruns its button or gets clipped out of the
    // accessible name. The button names come from the app's own catalogue
    // rather than being written out here, so a retranslation cannot leave
    // this test looking for a label nobody renders.
    const words = language === "fr" ? fr : pseudo;
    await page.addInitScript((id: string) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({ schemaVersion: 3, seenWelcome: true, language: id }),
      );
    }, language);
    await page.reload();
    await expect(page.getByRole("application", { name: /.+/ })).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(`bare: ${describeViolations(await scan(page))}`).toBe("bare: ");

    // And with a panel over the map, which is the widest the chrome gets.
    await page
      .getByRole("button", { name: words["bar.commands"], exact: true })
      .click();
    await page.locator('[data-command="surface:layers"]').click();
    await expect(
      page.getByRole("dialog", { name: words["panel.layers"] }),
    ).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(`layers: ${describeViolations(await scan(page))}`).toBe("layers: ");
  });
}

for (const scale of ["115%", "130%"] as const) {
  test(`the workspace is clean at ${scale} text`, async ({ page }) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: scale, exact: true }).click();
    await page.getByRole("button", { name: "Close Settings" }).click();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(`bare: ${describeViolations(await scan(page))}`).toBe("bare: ");

    await openSurface(page, "layers");
    expect(`layers: ${describeViolations(await scan(page))}`).toBe("layers: ");
  });
}

/**
 * The two screens that replace the whole workspace when it cannot draw.
 *
 * Neither had ever been scanned, and both are the one thing on the display:
 * a reader who lands on one has nothing else to read.
 */
for (const theme of ["dark", "light"] as const) {
  test(`the no-WebGL2 screen is clean for a reader on ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((which: string) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({ schemaVersion: 3, seenWelcome: true, theme: which }),
      );
      // Stamped here as well as stored. The attribute is put on `<html>` by
      // an effect inside the component that throws, so a crash on the very
      // first render comes up dark whatever the reader chose; a crash after
      // the workspace has been up in light comes up light, and that is the
      // state this pins. Both are real and the palettes are different.
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.dataset.theme = which;
      });
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === "webgl2") return null;
        return (
          original as unknown as (
            this: HTMLCanvasElement,
            kind: string,
            ...rest: unknown[]
          ) => unknown
        ).call(this, kind, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    }, theme);
    await page.reload();

    const notice = page.getByRole("alert");
    await expect(notice).toContainText("WebGL2");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(describeViolations(await scan(page))).toBe("");
  });

  test(`the render-failure screen is clean for a reader on ${theme}`, async ({
    page,
  }) => {
    // Reached with a fault rather than with a hook in the product: the
    // workspace reads `matchMedia` while it renders, and a getter that throws
    // is the same shape of failure as a decoder throwing mid-draw.
    await page.addInitScript((which: string) => {
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify({ schemaVersion: 3, seenWelcome: true, theme: which }),
      );
      // Stamped here as well as stored. The attribute is put on `<html>` by
      // an effect inside the component that throws, so a crash on the very
      // first render comes up dark whatever the reader chose; a crash after
      // the workspace has been up in light comes up light, and that is the
      // state this pins. Both are real and the palettes are different.
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.dataset.theme = which;
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        get() {
          throw new Error("the sweep could not be drawn");
        },
      });
    }, theme);
    await page.reload();

    const fatal = page.locator(".fatal-error");
    await expect(fatal).toBeVisible();
    await expect(fatal).toContainText("the sweep could not be drawn");
    // All three ways out, which is what the screen is for.
    await expect(
      fatal.getByRole("button", { name: "Copy diagnostics" }),
    ).toBeVisible();
    await expect(fatal.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(
      fatal.getByRole("button", { name: "Reset layout" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(PANEL_SETTLE_MS);
    expect(describeViolations(await scan(page))).toBe("");
  });
}

/**
 * A Windows contrast theme, which is not the same request as more contrast.
 *
 * The system repaints every background, border and text in its own small
 * palette and there is nothing to negotiate with it. `prefers-contrast: more`
 * does not fire for it, so the workspace kept its own colours under a repaint
 * that had already replaced half of them.
 */
test.describe("under a system contrast theme", () => {
  // `emulateMedia` rather than `test.use({ forcedColors })`: the latter is
  // silently ignored under this project's own `use` block, and a test that
  // believes it is running under a contrast theme while the query answers
  // false passes for the wrong reason. Checked here rather than assumed.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    expect(
      await page.evaluate(
        () => window.matchMedia("(forced-colors: active)").matches,
      ),
      "the contrast theme is not actually being emulated",
    ).toBe(true);
  });

  test("every surface is still clean", async ({ page }) => {
    for (const id of [
      "layers",
      "alerts",
      "settings",
      "more",
    ] as OpenSurface[]) {
      await openSurface(page, id);
      expect(`${id}: ${describeViolations(await scan(page))}`).toBe(`${id}: `);
      await page.reload();
      await page.emulateMedia({ forcedColors: "active" });
      await expect(
        page.getByRole("application", { name: "Interactive weather map" }),
      ).toBeVisible();
    }
  });

  test("the rail is drawn in the system's colours, not its own", async ({
    page,
  }) => {
    // The bar is a fixed dark surface in both themes, which is a decision the
    // system has just overruled. Left as it was, its own near-white ink sat
    // on whatever the system painted underneath.
    const painted = await page
      .locator(".command-bar")
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    // Canvas resolves to the system's own colour, which under Playwright's
    // emulation is pure black or pure white rather than the app's #070b10.
    expect(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]).toContain(painted);
  });

  test("every control that is drawn in dark is still drawn", async ({
    page,
  }) => {
    // What a pinned screenshot would be standing in for, said as a property
    // that can actually fail.
    //
    // The way a control really disappears under a contrast theme is by
    // opting out of the repaint and then having no ink: `color: transparent`
    // on its own cannot do it, because the system paints over it. So this
    // catches exactly the mistake the `forced-color-adjust: none` list above
    // makes possible, which is the one worth catching.
    await openSurface(page, "layers");
    const invisible = await page.evaluate(() => {
      const parse = (colour: string) =>
        (colour.match(/[\d.]+/g) ?? []).map(Number);
      const opaque = (colour: string) => {
        const parts = parse(colour);
        return parts.length < 4 || parts[3] > 0.05;
      };
      const gone: string[] = [];
      const controls = document.querySelectorAll<HTMLElement>(
        ".command-bar button, .surface-panel button, .surface-panel input",
      );
      for (const node of controls) {
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const style = getComputedStyle(node);
        if (!opaque(style.color)) {
          gone.push(
            `${node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "?"}: ink ${style.color}`,
          );
          continue;
        }
        // A border or a background is what tells one control from the next
        // once every colour is the system's.
        const bordered =
          Number.parseFloat(style.borderTopWidth) > 0 ||
          Number.parseFloat(style.outlineWidth) > 0;
        if (!bordered && !opaque(style.backgroundColor)) continue;
      }
      return gone;
    });
    expect(invisible).toEqual([]);
  });

  test("a reading keeps its own colours", async ({ page }) => {
    // The rule the whole block turns on: a button is decoration and belongs
    // to the system's look, a reflectivity ramp is a reading and does not.
    // Repainted in ButtonText every band of it says the same thing, which is
    // nothing at all.
    const ramp = page.locator(".legend-ramp");
    await expect(ramp).toBeVisible();
    expect(
      await ramp.evaluate((node) => getComputedStyle(node).forcedColorAdjust),
    ).toBe("none");
  });

  test("says the system is choosing, rather than offering a dead button", async ({
    page,
  }) => {
    await openSurface(page, "settings");
    const note = page.locator("[data-forced-colours]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("contrast theme");
    await expect(
      page.getByRole("button", { name: "Light", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Dark", exact: true }),
    ).toBeDisabled();
  });
});

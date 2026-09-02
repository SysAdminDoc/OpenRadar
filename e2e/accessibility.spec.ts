import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { obscuredWhenFocused, unreachable } from "./support/layout";

/**
 * The map canvas is a WebGL surface with no accessible content of its own, and
 * MapLibre's own attribution control is outside our markup.
 */
const EXCLUDED = [".maplibregl-canvas-container", ".maplibregl-ctrl-attrib"];

/** Panels animate in, and axe reads a mid-animation colour as a failure. */
const PANEL_SETTLE_MS = 300;

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(EXCLUDED)
    .analyze();

  return results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

function describeViolations(
  violations: Awaited<ReturnType<typeof scan>>,
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    )
    .join("\n");
}

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

test("every panel the command bar opens is clean too", async ({ page }) => {
  for (const name of [
    "Layers",
    "Map Type",
    "Alerts",
    "Tropical",
    "Route",
    "Search",
    "Export",
    "Forecast",
    "Settings",
    "Upload",
    "Diagnostics",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.waitForTimeout(PANEL_SETTLE_MS);
    const violations = await scan(page);
    expect(`${name}: ${describeViolations(violations)}`).toBe(`${name}: `);
    await page.getByRole("button", { name: `Close ${name}` }).click();
  }
});

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

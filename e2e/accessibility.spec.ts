import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { unreachable } from "./support/layout";

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

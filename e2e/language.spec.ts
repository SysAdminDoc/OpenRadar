import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";
import { clipped } from "./support/layout";
import { pseudoize } from "../src/i18n/pseudo";
import { en, type StringKey } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { es } from "../src/i18n/es";

/**
 * The panels that hold copy, named by the catalogue key that labels each
 * button rather than by its English words, because the same list has to find
 * those buttons in a language that does not use them.
 */
const PANELS: StringKey[] = [
  "panel.layers",
  "panel.mapType",
  "panel.settings",
  "panel.alerts",
  "layer.tropical",
  "panel.route",
  "panel.export",
  "panel.upload",
  "panel.forecast",
  "panel.search",
  "panel.more",
];

/**
 * Open every panel in turn and report the text that does not fit its box.
 *
 * The buttons are labelled in whatever language is on, so the selector has to
 * be too, or this loop would quietly open nothing and pass without looking at
 * a single panel. That is what the count is for.
 */
async function clippedAcrossPanels(
  page: Page,
  label: (key: StringKey) => string,
  // The rail may shorten a caption in the generated language, whose words are
  // a third longer than anybody's, and may not in one somebody reads.
  railMayShorten = false,
): Promise<string[]> {
  const offenders: string[] = [];
  let opened = 0;
  for (const key of PANELS) {
    const button = page.locator(
      `.command-bar button[aria-label="${label(key)}"]`,
    );
    if (!(await button.count())) continue;
    await button.first().click();
    await expect(page.locator(".surface-panel")).toBeVisible();
    opened += 1;
    offenders.push(
      ...(await clipped(page, railMayShorten)).map((text) => `${key}: ${text}`),
    );
    await button.first().click();
  }
  expect(opened, "no panel was opened, so nothing was measured").toBe(
    PANELS.length,
  );
  return offenders;
}

/** The page itself does not scroll sideways to make room for a long label. */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function startIn(page: Page, language: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem(
      "openradar.settings",
      JSON.stringify({
        schemaVersion: 2,
        language: value,
        // The convective outlook, so the key for its bands is on the map
        // while the sweep below measures. That surface is in the scope
        // `clipped` walks and it is empty on a map with no banded layer on,
        // so without this the key would be measured in no language at all.
        layers: { spcOutlooks: true },
      }),
    );
  }, language);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  // Named in whatever language is on, so the wait does not depend on which.
  await expect(page.getByRole("application")).toBeVisible();
}

/**
 * Text that does not fit the box it was given.
 *
 * Wider than "the box clips it", deliberately. An earlier version only looked
 * at elements with `overflow-x: hidden`, which meant the way to make it pass
 * was to remove the overflow rule rather than to make the label fit. This
 * counts any text wider or taller than its own box, and skips only the
 * elements that are meant to scroll.
 */

test.describe("a workspace in another language", () => {
  test.use({ viewport: { width: 1024, height: 720 } });

  test("shows Spanish copy the moment the language is switched", async ({
    page,
  }) => {
    await startIn(page, "en");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Nothing is reloaded: the panel that made the change is the first thing
    // to change.
    await page.getByRole("button", { name: "Español", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Capas", exact: true }),
    ).toBeVisible();

    // And it holds across the panels, not just the one that was open.
    await page.getByRole("button", { name: "Capas", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Capas" })).toBeVisible();
    // Scoped to the switch list. The layer name also appears in the opacity
    // sliders below it now, so a bare lookup matches two things.
    await expect(
      page.locator(".setting-list").getByText("Alertas meteorológicas"),
    ).toBeVisible();

    // Back to English, in place, with no restart.
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("fits its labels in the pseudolocale at 1024 by 720", async ({
    page,
  }) => {
    await startIn(page, "pseudo");

    // The bracket is the marker the generated language wraps every string in,
    // so seeing one means the screen really is drawn in it.
    await expect(page.locator(".command-bar")).toContainText("⟦");

    const offenders = await clippedAcrossPanels(
      page,
      (key) => pseudoize(en[key]),
      true,
    );
    expect(offenders).toEqual([]);

    // And the window itself does not scroll sideways to make room.
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("fits its labels in French at 1024 by 720", async ({ page }) => {
    // The pseudolocale is longer than any real translation, so this cannot
    // find a box French overflows and it does not. It is here because French
    // is copy somebody wrote rather than copy a function generated, and a
    // sentence that runs long in one panel is exactly the kind of thing the
    // padding rule cannot predict.
    await startIn(page, "fr");
    await expect(page.locator(".command-bar")).toContainText("Couches");

    const offenders = await clippedAcrossPanels(page, (key) => fr[key]);
    expect(offenders).toEqual([]);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("fits its labels in Spanish at 1024 by 720", async ({ page }) => {
    // For the same reason French is here: it is copy somebody wrote rather
    // than copy a function generated, and Spanish runs long in different
    // places than French does. A translation that is correct and too long for
    // its control is invisible to every other gate.
    await startIn(page, "es");
    await expect(page.locator(".command-bar")).toContainText("Capas");

    const offenders = await clippedAcrossPanels(page, (key) => es[key]);
    expect(offenders).toEqual([]);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("shows French copy the moment the language is switched", async ({
    page,
  }) => {
    await startIn(page, "en");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Français", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Réglages" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Couches", exact: true }),
    ).toBeVisible();

    // Back to English, in place, with no restart. The panel that made the
    // change is still open, so the way back is the button beside the one just
    // pressed rather than a second trip through the command bar.
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

test.describe("the Start with Windows row in a long language", () => {
  test.use({ viewport: { width: 1024, height: 720 } });

  test("keeps its label and its reason readable at their full width", async ({
    page,
  }) => {
    // The clipping sweep above cannot see this row: it skips everything inside
    // a scroller and the settings panel scrolls. A row whose whole job is to
    // explain why a switch cannot be moved is worth measuring directly, so
    // this reads the boxes rather than the text.
    await startIn(page, "pseudo");
    await page
      .locator(
        `.command-bar button[aria-label="${pseudoize(en["panel.settings"])}"]`,
      )
      .first()
      .click();
    const row = page.locator("[data-autostart-setting]");
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();

    const measured = await row.evaluate((element) => {
      // Both directions. Sideways is what a squeezed control does; downwards
      // is what long copy does, and a row whose text wraps has no sideways
      // overflow to find however badly it spills, so a check that only looked
      // at the width could not fail on the thing most likely to go wrong.
      const box = (found: Element | null) =>
        found
          ? {
              width: found.getBoundingClientRect().width,
              clipped:
                found.scrollWidth - found.clientWidth > 1 ||
                found.scrollHeight - found.clientHeight > 1,
            }
          : { width: 0, clipped: true };
      return {
        label: box(element.querySelector("strong")),
        detail: box(element.querySelector("small")),
        row: {
          sideways: element.scrollWidth - element.clientWidth,
          down: element.scrollHeight - element.clientHeight,
        },
      };
    });
    expect(measured.label.width).toBeGreaterThan(20);
    expect(measured.detail.width).toBeGreaterThan(20);
    expect(measured.label.clipped, "the label is cut off").toBe(false);
    expect(measured.detail.clipped, "the reason is cut off").toBe(false);
    expect(measured.row.sideways).toBeLessThanOrEqual(1);
    expect(measured.row.down).toBeLessThanOrEqual(1);

    // And with the icon off it says why rather than going quiet.
    await page
      .getByRole("checkbox", { name: pseudoize(en["tray.setting"]) })
      .setChecked(false);
    await expect(row.locator("small")).toHaveText(
      pseudoize(en["autostart.needsTray"]),
    );
    await expect(row.locator("input[type=checkbox]")).toBeDisabled();
  });
});

test("says a service failure in the reader's own language", async ({
  page,
}) => {
  // A failure sentence is the one a reader meets when something is wrong,
  // which is when the words matter most. Twelve of them were English-only
  // template literals that the copy gate could not see.
  await startIn(page, "fr");
  // After the workspace fixture, whose own handler for this host would win:
  // the last route registered is the one Playwright uses.
  await page.route("https://services3.arcgis.com/**", async (route) => {
    await route.fulfill({ status: 503, body: "maintenance" });
  });
  await page.reload();
  await expect(page.getByRole("application")).toBeVisible();

  await page.getByRole("button", { name: /Couches/ }).click();
  const row = page.locator(".toggle-row").filter({ hasText: /Feux de forêt/ });
  await row.getByRole("checkbox").check();
  await expect(row).toContainText("Le service des incendies du NIFC");
  await expect(row).not.toContainText("503");
});

test.describe("the rail's own words, in every language it ships", () => {
  // The clipping sweep skips anything inside a scroller, and the rail
  // scrolls, so it can never see these. The direct measurement in
  // `workspace.spec.ts` runs in English at one width. Two captions were cut
  // off in English at 1920 for as long as the rail has existed, which is the
  // width the bug was reported at and the one the README screenshot uses, so
  // the widths and the languages are both walked here.
  //
  // The generated language is deliberately left out: its words are padded
  // beyond anything a translator would write, and the rail is allowed to
  // shorten a caption there.
  for (const language of ["en", "es", "fr"]) {
    for (const width of [1920, 1440, 1024]) {
      test(`fits in ${language} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await startIn(page, language);
        const measured = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".command-button span"))
            // A caption the layout hides at this width has no size at all,
            // and a zero inside a zero is not a fit. Only what a reader can
            // actually see is measured.
            .filter((span) => span.clientWidth > 0)
            .map((span) => ({
              text: span.textContent ?? "",
              wants: span.scrollWidth,
              has: span.clientWidth,
            })),
        );
        // Without this the whole test passes by measuring nothing, which is
        // exactly what the compact run was doing.
        expect(measured.length).toBeGreaterThan(3);
        const cut = measured
          .filter((span) => span.wants > span.has + 1)
          .map((span) => `${span.text}: ${span.wants} in ${span.has}`);
        expect(cut).toEqual([]);
      });
    }
  }
});

test("a first run reads a language in the units that language uses", async ({
  page,
}) => {
  // Nothing seeded: this is the path a real first launch takes, and it is
  // the one the unit tests could not reach. `readSettings` handed
  // `normalizeSettings` an undefined when localStorage was empty, which took
  // the older-file branch and marked a brand-new install as having already
  // picked units, so this never worked for anybody.
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const imperial = page.getByRole("button", {
    name: en["settings.unitsImperial"],
  });
  await expect(imperial).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Français", exact: true }).click();
  const metric = page.getByRole("button", { name: fr["settings.unitsMetric"] });
  await expect(metric).toHaveAttribute("aria-pressed", "true");

  // And once the reader says what they want, a later language change leaves
  // it alone.
  await page
    .getByRole("button", { name: fr["settings.unitsImperial"] })
    .click();
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await expect(
    page.getByRole("button", { name: es["settings.unitsImperial"] }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the map's own controls are in the reader's language too", async ({
  page,
}) => {
  // MapLibre ships its own English for the few strings it writes into the
  // DOM itself, so the canvas was announced as "Map" and the popup close
  // button as "Close popup" inside a workspace that is otherwise entirely
  // translated.
  await startIn(page, "fr");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toHaveAttribute("aria-label", fr["map.label"]);

  // The attribution toggle is the other one a reader can reach.
  const toggle = page.locator(".maplibregl-ctrl-attrib-button");
  await expect(toggle).toHaveAttribute(
    "aria-label",
    fr["map.toggleAttribution"],
  );
});

test("the map's own controls follow a language change, not only a launch", async ({
  page,
}) => {
  // MapLibre copies its locale table once, when the map is built, and writes
  // the canvas name into the DOM at that moment. The map is never rebuilt on
  // a language change, so these stayed in whatever language the app booted in
  // while every other word on screen changed. The settings panel says the
  // choice applies immediately.
  await startIn(page, "en");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toHaveAttribute("aria-label", en["map.label"]);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Français", exact: true }).click();

  await expect(canvas).toHaveAttribute("aria-label", fr["map.label"]);
  await expect(page.locator(".maplibregl-ctrl-attrib-button")).toHaveAttribute(
    "aria-label",
    fr["map.toggleAttribution"],
  );
});

test.describe("the workspace at the size the screenshots are taken at", () => {
  test.use({ viewport: { width: 1487, height: 1058 } });

  // A wider window is not automatically a safer one: the panels keep their
  // width and the rail grows, so a label that fits at 1024 can still be cut
  // here, and this is the size a first reader sees in the README.
  for (const [language, catalogue, word] of [
    ["es", es, "Capas"],
    ["fr", fr, "Couches"],
  ] as const) {
    test(`fits its labels in ${language} at 1487 by 1058`, async ({ page }) => {
      await startIn(page, language);
      await expect(page.locator(".command-bar")).toContainText(word);

      const offenders = await clippedAcrossPanels(
        page,
        (key) => catalogue[key],
      );
      expect(offenders).toEqual([]);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

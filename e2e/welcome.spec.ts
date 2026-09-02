import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace, stubHost } from "./support/fixtures";

/**
 * A first launch, which is the one chance to be worth opening again.
 *
 * Two things are held here. The disc drawing itself has to greet rather than
 * gate: over a map that already works, gone the moment anybody does anything,
 * and not drawn at all for a reader who has asked for less movement. And the
 * line above the signpost has to be a real observation with a source and a
 * time, or say plainly that it has nothing.
 */
const CENTER: [number, number] = [-96.8, 32.78];

function station(raw: string, minutesAgo: number) {
  return [
    {
      icaoId: "KDAL",
      obsTime: Math.floor(Date.now() / 1000) - minutesAgo * 60,
      temp: 12,
      dewp: 11,
      wdir: 180,
      wspd: 8,
      wgst: null,
      rawOb: raw,
      lat: CENTER[1],
      lon: CENTER[0],
      name: "Dallas Love Field, TX, US",
      cover: "OVC",
      fltCat: "MVFR",
    },
  ];
}

async function firstRun(page: Page, rows?: unknown) {
  await routeWorkspace(page);
  if (rows) {
    await stubHost(page, "https://aviationweather.gov/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    });
  }
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

test("opens with what a station is actually reporting", async ({ page }) => {
  await firstRun(
    page,
    station("KDAL 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989", 6),
  );
  // The source and the reading. The time is beside them, in the reader's own
  // clock, which is why it is not asserted to the minute here.
  await expect(page.getByText(/KDAL is reporting rain/)).toBeVisible();
  // And the signpost is still there underneath, because somebody who has just
  // installed this still needs to know where everything is.
  await expect(page.getByText("Commands searches every product")).toBeVisible();
});

test("says plainly when there is nothing to report", async ({ page }) => {
  await firstRun(
    page,
    station("KDAL 021253Z 18008KT 10SM FEW040 21/09 A3001", 6),
  );
  const line = page.getByText(/KDAL is reporting nothing falling/);
  await expect(line).toBeVisible();
  // It reaches for nothing to make the line more interesting, and it never
  // mentions a hazard: a warning belongs in the warning surfaces. Read off
  // the toast itself rather than the page, which has a warnings layer on it.
  const said = await line.textContent();
  expect(said).not.toMatch(/warning|severe|tornado|storm/i);
});

test("draws the disc once, and stops the moment anybody does anything", async ({
  page,
}) => {
  await firstRun(page);
  const disc = page.locator(".first-run-reveal");
  await expect(disc).toBeVisible();
  // The map is usable straight through it: it takes no pointer events at all.
  await expect(disc).toHaveCSS("pointer-events", "none");

  await page
    .getByRole("application")
    .first()
    .click({ position: { x: 40, y: 40 } });
  await expect(disc).toHaveCount(0);

  // And never again, once the flag has been written. It is written when the
  // sweep would have ended rather than when the reader skipped it, so that a
  // settings save never lands between a pointer going down and the click
  // that follows it.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.localStorage.getItem("openradar.settings") ?? "",
      ),
    )
    .toMatch(/"seenReveal":\s*true/);
  await page.reload();
  await expect(page.getByRole("application")).toBeVisible();
  await expect(page.locator(".first-run-reveal")).toHaveCount(0);
});

test("does not draw it at all for a reader who asked for less movement", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await firstRun(page);
  // The whole of it is the motion, so there is nothing left to keep. The line
  // and the signpost still arrive.
  await expect(page.locator(".first-run-reveal")).toHaveCount(0);
  await expect(page.getByText("Commands searches every product")).toBeVisible();
});

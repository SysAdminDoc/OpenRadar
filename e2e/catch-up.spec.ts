import { expect, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import {
  fakeDesktop,
  routeWorkspace,
  stubHost,
  test,
  unhandledRejections,
} from "./support/fixtures";

/**
 * What the weather did at your places while the app was closed.
 *
 * Worth holding here rather than in a unit test: that it is read out of the
 * record on the disk rather than fetched, that it reads in the past tense with
 * a time on every line, and that it stands down while a warning is in force.
 */

const HOME: [number, number] = [-96.8, 32.78];
const DAYS_AGO = 3;

function journalRow(hoursAgo: number, place: string, text: string) {
  const observed = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return {
    id: `row-${hoursAgo}`,
    at: observed,
    place,
    kind: "alert",
    source: "NWS",
    observed,
    obtained: "a warning that reached a place you watch",
    text,
    note: "",
    thumb: "",
  };
}

/** A live warning sitting over the watched point, for the suppression case. */
function warningOver(point: [number, number]) {
  const [lon, lat] = point;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon - 0.2, lat - 0.2],
          [lon + 0.2, lat - 0.2],
          [lon + 0.2, lat + 0.2],
          [lon - 0.2, lat + 0.2],
          [lon - 0.2, lat - 0.2],
        ],
      ],
    },
    // The shape the office's own service publishes, which is what the alerts
    // overlay reads. A hand-made normalised feature would be testing the
    // fixture rather than the app.
    properties: {
      prod_type: "Tornado Warning",
      sig: "W",
      wfo: "FWD",
      issuance: new Date(Date.now() - 60_000).toISOString(),
      expiration: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}

async function start(
  page: Page,
  options: {
    rows: unknown[];
    catchUp?: boolean;
    away?: number;
    warning?: boolean;
  },
) {
  const away = options.away ?? DAYS_AGO * 86_400_000;
  await page.addInitScript(
    (value: { rows: unknown[]; catchUp: boolean; away: number }) => {
      const settings = {
        schemaVersion: 3,
        catchUp: value.catchUp,
        lastSeen: Date.now() - value.away,
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
      };
      window.localStorage.setItem(
        "openradar.settings",
        JSON.stringify(settings),
      );
      // The stored settings carry a clock, so they are built here rather than
      // handed in from the test, and the shared stub reads them from here.
      (window as unknown as { __settings: unknown }).__settings = settings;
      // Only the record is faked. Nothing here answers a question about what
      // the weather was doing: the summary is the rows or it is nothing.
      (
        window as unknown as {
          __answer: (command: string) => [unknown] | undefined;
        }
      ).__answer = (command: string) => {
        if (command === "journal_rows") return [value.rows];
        return undefined;
      };
    },
    { rows: options.rows, catchUp: options.catchUp ?? true, away },
  );
  await fakeDesktop(page, { settingsFromPage: true });
  await routeWorkspace(page);
  // The alerts the workspace draws come from the office's own map service,
  // and `routeWorkspace` already answers it with a warning over Florida. This
  // puts one over the watched point instead, or nothing at all.
  await stubHost(
    page,
    "https://mapservices.weather.noaa.gov/**",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "FeatureCollection",
          features: options.warning ? [warningOver(HOME)] : [],
        }),
      });
    },
  );
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
}

test("says what the record holds from the time the app was closed", async ({
  page,
}) => {
  await start(page, {
    rows: [
      journalRow(30, "Casa", "Severe Thunderstorm Warning"),
      journalRow(6, "Casa", "Tornado Warning"),
    ],
  });

  const card = page.locator(".catch-up");
  await expect(card).toBeVisible();
  // Newest first, and both lines are there.
  const lines = card.locator("[data-catch-up-line]");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("Tornado Warning");
  // Every line carries its own time. A warning that reached somewhere on
  // Tuesday is not a warning now, and a line with no time reads like one.
  await expect(lines.first().locator("small")).not.toBeEmpty();
  await expect(lines.first().locator("small")).toContainText("Casa");
  // The card with rows in it. The accessibility gate has no way to build a
  // journal, so it is scanned here where one exists.
  await expectClean(page, "catch-up card");

  await card.getByRole("button", { name: /thanks|gracias|merci/i }).click();
  await expect(card).toBeHidden();
});

test("says so in one line when nothing happened", async ({ page }) => {
  await start(page, { rows: [] });
  const card = page.locator(".catch-up");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-catch-up-line]")).toHaveCount(0);
  await expect(card).toContainText(/nothing happened|no pasó|rien ne/i);
});

test("stays away after a restart rather than an absence", async ({ page }) => {
  // Ten minutes is somebody changing a setting, not a night's sleep.
  await start(page, {
    rows: [journalRow(1, "Casa", "Tornado Warning")],
    away: 10 * 60_000,
  });
  // The positive control: the workspace really did open. Without it this
  // passes just as well against a build that fails to render at all, which
  // is the failure mode of every "nothing appeared" assertion.
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".catch-up")).toHaveCount(0);
});

test("stays away when the reader has switched it off", async ({ page }) => {
  await start(page, {
    rows: [journalRow(6, "Casa", "Tornado Warning")],
    catchUp: false,
  });
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  // The same rows with the setting on do produce a card, which the first
  // test in this file holds, so the difference here is the setting.
  await expect(page.locator(".catch-up")).toHaveCount(0);
});

test("names the place the reader named, and not its coordinates", async ({
  page,
}) => {
  // Every row in the record is a place the reader named. The card says that
  // word and never the numbers behind it, which is the difference between a
  // record of the weather and a record of where somebody lives.
  await start(page, {
    rows: [journalRow(6, "Casa", "Tornado Warning")],
  });
  const card = page.locator(".catch-up");
  await expect(card).toContainText("Casa");
  await expect(card).not.toContainText(String(HOME[0]));
  await expect(card).not.toContainText(String(HOME[1]));
});

test("stands down while a warning is in force where you watch", async ({
  page,
}) => {
  await start(page, {
    rows: [journalRow(6, "Casa", "Severe Thunderstorm Warning")],
    warning: true,
  });
  // The positive control first. Without it this test passes just as well
  // against a stub that served no warning at all, which is the failure mode
  // of every "nothing appeared" assertion.
  await expect(page.getByText("Tornado Warning").first()).toBeVisible();
  // A map with a warning on it is a serious instrument, and this is a card
  // about last Tuesday. It waits.
  await expect(page.locator(".catch-up")).toHaveCount(0);
});

test("drops nothing on the floor when letting a listener go fails", async ({
  page,
}) => {
  // The glance window's listener is torn down through Tauri's own `unlisten`,
  // which reaches into `window.__TAURI_EVENT_PLUGIN_INTERNALS__` and reports
  // failure by rejecting rather than by throwing where the caller stands.
  // Called as a bare statement, as this app did until 2026-09-07, that
  // rejection lands nowhere: fifty of them in a green run. The fixture stubs
  // that global because a packaged build has it, which means the app's own
  // handling goes untested unless something breaks it on purpose. This does.
  await page.addInitScript(() => {
    (
      window as unknown as {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>;
      }
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {
        throw new Error("the bridge went away");
      },
    };
  });
  await start(page, { rows: [journalRow(5, "Dallas", "Hail to 1 inch")] });
  await expect(page.locator(".map-stage")).toBeVisible();
  await page.waitForTimeout(250);

  // What this reaches, said plainly because an earlier version of it claimed
  // more. It dispatched `beforeunload` under a comment about running every
  // teardown at once, and that event runs none: React does not unmount on it
  // and nothing in this app listens for it. What does run is the development
  // double-mount, which tears the first effect down before `listen` has
  // resolved and so takes the "let it go at once" branch. The cleanup branch
  // beside it, and the two in `useWorkspaceActions`, are the same three lines
  // and are not covered here.
  //
  // That branch is genuinely covered, which is worth writing down because it
  // is not obvious from the stub: `unregisterListener` throws where it stands,
  // but Tauri's `_unlisten` is `async`, so the throw comes back as a rejected
  // promise. Put the bare `void unlisten()` back at `App.tsx:794` and this
  // fails, checked on 2026-09-07. `void` discards that promise instead of
  // returning it, so the chain's own `.catch` never sees it.
  expect(await unhandledRejections(page)).toEqual([]);
});

test("a tool's instructions sit under the card, not on it", async ({
  page,
}) => {
  // Both live at the top centre of the map and the tool hint sits
  // twenty-seven z-levels above, so picking up Draw, Range, Inspector or
  // Cross-section used to put an instruction card over this one's title.
  // Both are the app's own words and both are meant to be read, and this is
  // reachable every morning: the card is there on launch and a tool is the
  // first thing a reader reaches for.
  await start(page, {
    rows: [
      journalRow(30, "Casa", "Severe Thunderstorm Warning"),
      journalRow(6, "Casa", "Tornado Warning"),
    ],
  });
  const card = page.locator(".catch-up");
  await expect(card).toBeVisible();
  const hint = page.locator(".tool-hud");

  for (const tool of ["Draw", "Range", "Inspector", "Cross-section"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await expect(hint).toBeVisible();
    const boxes = await page.evaluate(() => {
      const one = document.querySelector(".catch-up")?.getBoundingClientRect();
      const two = document.querySelector(".tool-hud")?.getBoundingClientRect();
      if (!one || !two) return null;
      return {
        cardBottom: Math.round(one.bottom),
        hintTop: Math.round(two.top),
        overlaps:
          one.left < two.right &&
          two.left < one.right &&
          one.top < two.bottom &&
          two.top < one.bottom,
      };
    });
    expect(
      boxes,
      `${tool}: one of the two cards is not on the page`,
    ).not.toBeNull();
    expect(boxes!.overlaps, `${tool} draws over the catch-up card`).toBe(false);
    expect(
      boxes!.hintTop,
      `${tool} is above the card rather than under it`,
    ).toBeGreaterThanOrEqual(boxes!.cardBottom);
  }

  // And with the card sent away, the hint goes back where it has always been.
  const before = await hint.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await card.getByRole("button", { name: /thanks|gracias|merci/i }).click();
  await expect(card).toBeHidden();
  await expect
    .poll(() =>
      hint.evaluate((node) => Math.round(node.getBoundingClientRect().top)),
    )
    .toBe(76);
  expect(before).toBeGreaterThan(76);
});

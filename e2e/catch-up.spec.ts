import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./support/axe";
import { fakeDesktop, routeWorkspace, stubHost } from "./support/fixtures";

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

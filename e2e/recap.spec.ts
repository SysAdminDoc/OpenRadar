import { expect, test, type Page } from "@playwright/test";
import { routeWorkspace } from "./support/fixtures";

/**
 * A year at your own places, from your own record.
 *
 * The two things worth holding in the real workspace: that a record which
 * covers three months says so rather than letting it read as a year, and that
 * the reader's own word for where they live goes on the picture only when
 * they put it there.
 */

const DAY = 86_400_000;

function journalRow(daysAgo: number, place: string, kind: string) {
  const observed = new Date(Date.now() - daysAgo * DAY).toISOString();
  return {
    id: `row-${daysAgo}-${place}`,
    at: observed,
    place,
    kind,
    source: "KFWS",
    observed,
    obtained: "a warning that reached a place you watch",
    text: kind === "alert" ? "Tornado Warning" : "rain",
    note: "",
    thumb: "",
  };
}

async function start(page: Page, rows: unknown[]) {
  await page.addInitScript((value: unknown[]) => {
    const settings = {
      schemaVersion: 3,
      seenWelcome: true,
      seenReveal: true,
      catchUp: false,
      watch: {
        enabled: true,
        sound: false,
        name: "Casa",
        center: [-96.8, 32.78],
        radiusMiles: 30,
        minSeverity: "severe",
      },
    };
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
      transformCallback: (callback: unknown) => callback,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === "journal_rows") return value;
        if (command === "journal_path") return "C:/test/journal.jsonl";
        // Opening Settings brings the incident-pack library with it, and a
        // fake that answers nothing crashes the panel before the recap is
        // ever drawn.
        if (
          command === "incident_pack_list" ||
          command === "incident_pack_set_limit"
        ) {
          return { packs: [], usedBytes: 0, diskLimitBytes: 4_294_967_296 };
        }
        if (command === "plugin:event|listen") return 1;
        if (command === "plugin:store|load") return 1;
        if (command === "plugin:store|get") {
          return args.key === "settings" ? [settings, true] : [null, false];
        }
        return null;
      },
    };
  }, rows);
  await routeWorkspace(page);
  await page.goto("/?testMode=1");
  await expect(page.getByRole("application")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

test("says how much of the year the record can speak for", async ({ page }) => {
  // Ninety days of record is not a year, and a recap that counts it as one is
  // a lie told with true numbers.
  await start(page, [
    journalRow(90, "Casa", "observation"),
    journalRow(40, "Casa", "alert"),
    journalRow(2, "Casa", "observation"),
  ]);
  const recap = page.locator("[data-recap]");
  await recap.scrollIntoViewIfNeeded();
  await expect(recap).toContainText("90");
  await expect(recap).toContainText("365");
  await expect(recap).toContainText("1 warnings and 2 observations");
});

test("keeps the place name off it until the reader puts it on", async ({
  page,
}) => {
  await start(page, [
    journalRow(10, "Casa", "alert"),
    journalRow(4, "The cabin", "observation"),
  ]);
  const recap = page.locator("[data-recap]");
  await recap.scrollIntoViewIfNeeded();
  await expect(recap).not.toContainText("Casa");
  await expect(recap).toContainText("2 places");

  await recap.getByRole("checkbox").check();
  await expect(recap).toContainText("Casa");
  await expect(recap).toContainText("The cabin");
});

test("has nothing to show rather than a card of noughts", async ({ page }) => {
  // An absence of records is not an absence of weather.
  await start(page, []);
  const recap = page.locator("[data-recap]");
  await recap.scrollIntoViewIfNeeded();
  await expect(recap).toContainText("nothing in your record");
});

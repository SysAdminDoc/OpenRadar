import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { ensureLanguage, setLanguage } from "../i18n";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { fr } from "../i18n/fr";

afterEach(() => {
  cleanup();
  setLanguage("en");
});

/**
 * What a reader scanning the panel sees, in the order they see it.
 *
 * "Appearance, applies immediately" headed fourteen rows of which four were
 * about looks: Start with Windows, the tray, close-to-tray and the glance
 * window are desktop integration, and calm mode, curiosities, catch-up and
 * on-this-date are the character set. Language, units and the clock, the three
 * a new reader wants first, came after the record, the packs and the storage
 * row. Somebody looking for "start with Windows" had no heading to find it
 * under.
 */
function panel() {
  return (
    <SettingsPanel
      settings={DEFAULT_SETTINGS}
      onSettings={vi.fn()}
      onRemoved={vi.fn()}
      autostart={false}
      onAutostart={vi.fn()}
      onWatchHere={vi.fn()}
      onAddWatchPlace={vi.fn()}
      onSendWatchTest={vi.fn()}
      ambient={{ seen: null, dropped: false }}
      onJournalSaved={vi.fn()}
      onJournalFailed={vi.fn()}
      onImportSettings={vi.fn()}
      onStorageCleared={vi.fn()}
      onStorageFailed={vi.fn()}
      onJournalCleared={vi.fn()}
      onJournalRemoved={vi.fn()}
      onChooseSound={vi.fn()}
      clock={0}
      onReset={vi.fn()}
      onExportSettings={vi.fn()}
      placeLightning={[]}
      onClose={vi.fn()}
    />
  );
}

function headings(): string[] {
  const { container } = render(panel());
  return [...container.querySelectorAll(".settings-section__title span")].map(
    (one) => one.textContent ?? "",
  );
}

/**
 * The whole sequence, including the sections their own components draw.
 *
 * The watch, the record, the curiosities, the packs and the storage row each
 * head themselves, so a list of only the ones this file writes would be a
 * list of most of the panel.
 */
const ORDER = [
  "settings.reading",
  "settings.appearance",
  "settings.desktop",
  "settings.character",
  "settings.radar",
  "settings.watchedArea",
  "settings.camera",
  "journal.title",
  "curiosity.found",
  "packs.title",
  "storage.title",
  "settings.backup",
] as const;

describe("the order Settings is read in", () => {
  it("puts what a new reader wants first and groups the rest by what it is", () => {
    // The panel's own words rather than the ones in this file, so a heading
    // renamed in the catalogue moves this test with it rather than breaking
    // it, and the sequence is what is being held.
    expect(headings()).toEqual(ORDER.map((key) => en[key]));
  });

  for (const [copy, language] of [
    [es, "es"],
    [fr, "fr"],
  ] as const) {
    it(`reads in the same order in ${language}`, async () => {
      // A translation that leaves a heading out is a panel with a different
      // shape in that language, which is exactly what the type gate cannot
      // see: every key is present and one section could still be missing.
      await ensureLanguage(language);
      setLanguage(language);
      expect(headings()).toEqual(ORDER.map((key) => copy[key]));
    });
  }

  it("shows what the Character switches come set to", () => {
    // The heading over them said "all off unless you turn it on". Three of the
    // four ship on, so the sentence was the opposite of the section. A line of
    // prose cannot be held to a default by a test, which is why the sentence
    // no longer makes a claim about one, but the defaults a reader meets under
    // that heading can be, and are: change one of these and the description
    // above them is the next thing to read.
    const { container } = render(panel());
    const section = [...container.querySelectorAll(".settings-section")].find(
      (one) =>
        one.querySelector(".settings-section__title span")?.textContent ===
        en["settings.character"],
    );
    const rows = [
      ...(section?.querySelectorAll<HTMLInputElement>(
        '.toggle-row input[type="checkbox"]',
      ) ?? []),
    ];
    expect(
      rows.map((one) => one.checked),
      "calm, curiosities, catch-up, on this date",
    ).toEqual([
      DEFAULT_SETTINGS.calm,
      DEFAULT_SETTINGS.curiosities,
      DEFAULT_SETTINGS.catchUp,
      DEFAULT_SETTINGS.almanac,
    ]);
    expect(rows.filter((one) => one.checked)).toHaveLength(3);
  });

  it("keeps every control that had a heading of its own", () => {
    // Language, units, the clock and the text size were four sections with
    // four headings and are one section with four labelled rows, so their
    // names have to survive the move: a bare run of segmented controls
    // reading Imperial/Metric, Local/UTC and 100/115/130 says nothing about
    // which is which.
    headings();
    const labels = [
      ...document.querySelectorAll(".settings-field > span strong"),
    ]
      .map((one) => one.textContent ?? "")
      .filter(Boolean);
    for (const key of [
      "settings.language",
      "settings.units",
      "settings.clock",
      "settings.textSize",
    ] as const) {
      expect(labels, key).toContain(en[key]);
    }
  });
});

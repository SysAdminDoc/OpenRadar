import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JournalSection } from "./JournalSection";
import { RecapSection } from "./RecapSection";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS } from "../lib/settings";
import * as journal from "../lib/journal";
import { en } from "../i18n/en";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROW: journal.JournalRow = {
  id: "row-1",
  at: "2026-09-04T12:05:00Z",
  place: "Polk County",
  kind: "alert",
  source: "Des Moines",
  observed: "2026-09-04T12:00:00Z",
  obtained: "From the warning feed",
  text: "Severe thunderstorm warning",
  note: "",
  thumb: "",
};

/** The list, handed whatever the panel has read so far. */
function list(read: journal.JournalRow[] | undefined) {
  return (
    <JournalSection
      clock={0}
      read={read}
      onReload={vi.fn()}
      writing={true}
      onWriting={vi.fn()}
      onSaved={vi.fn()}
      onFailed={vi.fn()}
      onCleared={vi.fn()}
      onRemoved={vi.fn()}
    />
  );
}

/** The year card, the same way. */
function card(read: journal.JournalRow[] | undefined) {
  return (
    <RecapSection
      clock={Date.parse("2026-09-04T12:00:00Z")}
      read={read}
      onSaved={vi.fn()}
      onFailed={vi.fn()}
    />
  );
}

describe("a record that has not been read yet", () => {
  beforeEach(() => {
    vi.spyOn(journal, "journalAvailable").mockReturnValue(true);
    vi.spyOn(journal, "journalPath").mockResolvedValue("C:/journal.jsonl");
  });

  it("says nothing rather than saying the journal is empty", () => {
    // "Nothing recorded yet." is the one sentence that must not be shown to
    // somebody whose record is full, and starting the rows at an empty array
    // showed it for a frame on every single open. Undefined is what says the
    // read has not landed; the panel above owns the read itself.
    const { rerender } = render(list(undefined));
    expect(screen.queryByText(en["journal.empty"])).toBeNull();

    rerender(list([ROW]));
    // And still nothing, because the record was never empty.
    expect(screen.queryByText(en["journal.empty"])).toBeNull();
  });

  it("says the journal is empty once it knows that it is", () => {
    const { rerender } = render(list(undefined));
    expect(screen.queryByText(en["journal.empty"])).toBeNull();

    rerender(list([]));
    expect(screen.getAllByText(en["journal.empty"]).length).toBeGreaterThan(0);
  });

  it("holds the year card back until the record has been read", () => {
    const { rerender } = render(card(undefined));
    expect(screen.queryByText(en["recap.empty"])).toBeNull();

    rerender(card([]));
    expect(screen.getByText(en["recap.empty"])).toBeTruthy();
  });
});

describe("a record the panel cannot read", () => {
  beforeEach(() => {
    vi.spyOn(journal, "journalAvailable").mockReturnValue(true);
    vi.spyOn(journal, "journalPath").mockResolvedValue("C:/journal.jsonl");
  });

  /**
   * The read is the panel's, so the panel is where the rejection has to land.
   *
   * Holding the empty sentence back until the read arrives is right, and it
   * has to end. An uncaught rejection left the rows undefined for good, so
   * both sections drew no rows, no sentence and no error: a silent blank card,
   * which is worse than the one frame of wrong copy it replaced.
   */
  function openPanel() {
    function Harness() {
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      return (
        <SettingsPanel
          settings={settings}
          onSettings={setSettings}
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
    render(<Harness />);
  }

  it("tells both sections the record is empty rather than leaving them blank", async () => {
    const read = vi
      .spyOn(journal, "journalRows")
      .mockRejectedValue(new Error("the bridge is not there"));
    openPanel();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText(en["journal.empty"]).length).toBeGreaterThan(0);
    expect(screen.getByText(en["recap.empty"])).toBeTruthy();
    // Once for the two of them, which is the point of the panel owning it.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads the record once a minute rather than twice", async () => {
    // Both sections are keyed on the same clock and both used to read the
    // whole file for themselves: two passes over a four megabyte JSONL every
    // minute the panel was open, for a file that had not changed between them.
    const read = vi.spyOn(journal, "journalRows").mockResolvedValue([ROW]);
    function Harness({ clock }: { clock: number }) {
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      return (
        <SettingsPanel
          settings={settings}
          onSettings={setSettings}
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
          clock={clock}
          onReset={vi.fn()}
          onExportSettings={vi.fn()}
          placeLightning={[]}
          onClose={vi.fn()}
        />
      );
    }
    const { rerender } = render(<Harness clock={0} />);
    await act(async () => {
      await Promise.resolve();
    });
    for (const minute of [1, 2]) {
      rerender(<Harness clock={minute * 60_000} />);
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(read).toHaveBeenCalledTimes(3);
  });
});

/**
 * Every panel that waits on something, and whether it says so.
 *
 * Read as text rather than rendered: several of these need a Tauri bridge, a
 * map or a network to reach the state worth checking, and the question here is
 * whether the code has a branch for it at all.
 */
describe("panels that wait", () => {
  it("holds a waiting state rather than an empty one", () => {
    const source = readFileSync(
      join(import.meta.dirname, "JournalSection.tsx"),
      "utf8",
    );
    // Undefined is the unread state and the empty array is the read one, and
    // the difference between them is the whole of this file's subject.
    expect(source).toContain("read === undefined");
  });
});

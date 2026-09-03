import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";
import type { UndoableRemoval } from "../components/ToastHost";

afterEach(cleanup);

/**
 * The panel with a parent that applies what it is told.
 *
 * Every undo here is a change made against the settings as they stand when it
 * is pressed rather than a snapshot taken when the thing went, so a spy that
 * never applies the removal cannot tell whether the undo works or whether
 * pressing it twice does something twice.
 */
function Harness({
  start,
  onRemoved,
}: {
  start: AppSettings;
  onRemoved: (removal: UndoableRemoval) => void;
}) {
  const [settings, setSettings] = useState(start);
  return (
    <SettingsPanel
      settings={settings}
      onSettings={setSettings}
      onRemoved={onRemoved}
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
      onClose={vi.fn()}
    />
  );
}

function held(start: AppSettings, label: string) {
  let removal: UndoableRemoval | null = null;
  render(
    <Harness
      start={start}
      onRemoved={(next) => {
        removal = next;
      }}
    />,
  );
  // The theme and sound buttons carry their words; the place button is an X
  // with a label.
  fireEvent.click(screen.queryByText(label) ?? screen.getByLabelText(label));
  if (!removal) throw new Error("no undo was offered");
  return {
    undo: () => act(() => (removal as UndoableRemoval).undo()),
    title: (removal as UndoableRemoval).title,
  };
}

function place(id: string, name: string): AppSettings["watchPlaces"][number] {
  return {
    id,
    name,
    enabled: true,
    center: [-93.6, 41.6],
    radiusMiles: 25,
    minSeverity: "severe",
    sound: false,
    quietHours: DEFAULT_SETTINGS.watch.quietHours,
  };
}

describe("removing a workspace theme", () => {
  const themed: AppSettings = {
    ...DEFAULT_SETTINGS,
    workspaceTheme: {
      name: "Dust",
      base: "dark",
      // Keyed by directive name, not by the custom property: only `theme.ts`
      // may name one of those, and a test that does fails its own gate.
      tokens: { Accent: "#7cc4ff" },
    },
  };

  it("offers an undo that puts the theme back", () => {
    // A theme is a file the reader found and loaded. Clearing it was one press
    // with nothing to say so and no way back to the file.
    const removal = held(themed, en["settings.themeClear"]);
    expect(removal.title).toContain("Dust");
    expect(screen.queryByText(en["settings.themeClear"])).toBeNull();

    removal.undo();
    expect(screen.getByText(en["settings.themeClear"])).toBeTruthy();
    expect(
      screen.getByText(en["settings.themeInForce"].replace("{name}", "Dust")),
    ).toBeTruthy();
  });

  it("puts the same theme back a second time rather than a different one", () => {
    // The undo restores one field over the settings as they stand, so pressing
    // it again after the theme is already back is the same theme, not a stale
    // snapshot of everything else.
    const removal = held(themed, en["settings.themeClear"]);
    removal.undo();
    removal.undo();
    expect(
      screen.getByText(en["settings.themeInForce"].replace("{name}", "Dust")),
    ).toBeTruthy();
  });
});

describe("removing a watched place", () => {
  const watching: AppSettings = {
    ...DEFAULT_SETTINGS,
    watchPlaces: [place("a", "School"), place("b", "Cabin")],
  };

  function names(): string[] {
    return Array.from(screen.queryAllByLabelText(en["settings.placeName"])).map(
      (field) => (field as HTMLInputElement).value,
    );
  }

  it("offers an undo that puts it back where it was in the list", () => {
    const removal = held(
      watching,
      en["settings.removePlace"].replace("{place}", "School"),
    );
    expect(removal.title).toContain("School");
    expect(names()).toEqual(["Cabin"]);

    removal.undo();
    expect(names()).toEqual(["School", "Cabin"]);
  });

  it("does nothing when the undo is used a second time", () => {
    const removal = held(
      watching,
      en["settings.removePlace"].replace("{place}", "School"),
    );
    removal.undo();
    removal.undo();
    expect(names()).toEqual(["School", "Cabin"]);
  });
});

describe("removing a chosen alert sound", () => {
  const withSound: AppSettings = {
    ...DEFAULT_SETTINGS,
    watch: { ...DEFAULT_SETTINGS.watch, enabled: true, sound: true },
    alertSoundPath: "C:/sounds/siren.wav",
  };

  it("offers an undo that goes back to the file the reader chose", () => {
    const removal = held(withSound, en["alerts.soundFileClear"]);
    expect(removal.title).toBe(en["alerts.soundFileRemoved"]);
    expect(screen.queryByText(en["alerts.soundFileClear"])).toBeNull();

    removal.undo();
    expect(screen.getByText(en["alerts.soundFileClear"])).toBeTruthy();
  });
});

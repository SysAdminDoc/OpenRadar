import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";

afterEach(cleanup);

/** The panel with a parent that applies what it is told, and reports back. */
function open(start: AppSettings, onSeen: (settings: AppSettings) => void) {
  function Harness() {
    const [settings, setSettings] = useState(start);
    onSeen(settings);
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
        onClose={vi.fn()}
      />
    );
  }
  render(<Harness />);
}

/** A language button, by the name the picker gives it. */
function pick(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("choosing a language on a workspace nobody has set units on", () => {
  it("reads that language in the units it is normally read in", () => {
    // Somebody who picks Français and is then shown Fahrenheit and miles has
    // to go and find the Units row to finish the job, and the row is a long
    // way down. The two settings were entirely independent.
    let latest = DEFAULT_SETTINGS;
    open(DEFAULT_SETTINGS, (settings) => {
      latest = settings;
    });
    expect(latest.units).toBe("imperial");

    pick("Français");
    expect(latest.language).toBe("fr");
    expect(latest.units).toBe("metric");

    pick("Español");
    expect(latest.units).toBe("metric");

    // And back again, because English here means the United States.
    pick("English");
    expect(latest.units).toBe("imperial");
  });

  it("leaves the units alone once the reader has picked them", () => {
    let latest = DEFAULT_SETTINGS;
    open(DEFAULT_SETTINGS, (settings) => {
      latest = settings;
    });

    // Pressing the Units row is the reader saying what they want, even when
    // they press the one that was already on.
    fireEvent.click(
      screen.getByRole("button", { name: en["settings.unitsImperial"] }),
    );
    expect(latest.unitsChosen).toBe(true);

    pick("Français");
    expect(latest.language).toBe("fr");
    expect(latest.units).toBe("imperial");
  });

  it("leaves a workspace from an older build alone", () => {
    // No flag on disk means no way to know, so it is read as chosen.
    const older = { ...DEFAULT_SETTINGS, unitsChosen: true };
    let latest = older;
    open(older, (settings) => {
      latest = settings;
    });
    pick("Español");
    expect(latest.units).toBe("imperial");
  });
});

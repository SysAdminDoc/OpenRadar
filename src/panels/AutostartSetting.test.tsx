import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";

afterEach(cleanup);

/**
 * The Start with Windows switch.
 *
 * The entry it writes opens the app to the tray, so with no tray icon it
 * would start a process a reader cannot reach. The switch says that rather
 * than being quietly ignored, which is the whole difference between a control
 * that is off and a control that does nothing.
 */
function panel(
  settings: AppSettings,
  autostart: boolean | null,
  onAutostart = vi.fn(),
) {
  return {
    onAutostart,
    ui: (
      <SettingsPanel
        settings={settings}
        onSettings={vi.fn()}
        onRemoved={vi.fn()}
        autostart={autostart}
        onAutostart={onAutostart}
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
    ),
  };
}

function box(): HTMLInputElement {
  const row = document.querySelector("[data-autostart-setting]");
  if (!row) throw new Error("the switch is not on the panel");
  const found = row.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (!found) throw new Error("the switch has no box");
  return found;
}

describe("with the tray icon on", () => {
  const trayOn: AppSettings = { ...DEFAULT_SETTINGS, tray: true };

  it("reads the machine rather than a setting", () => {
    render(panel(trayOn, true).ui);
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
    cleanup();

    render(panel(trayOn, false).ui);
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
  });

  it("hands a press straight over", () => {
    const { onAutostart } = panel(trayOn, false);
    render(panel(trayOn, false, onAutostart).ui);
    fireEvent.click(box());
    expect(onAutostart).toHaveBeenCalledWith(true);
  });

  it("is disabled while nobody can say, and says so", () => {
    // A browser preview, or a machine that would not answer. Drawn as off
    // rather than as a guess.
    render(panel(trayOn, null).ui);
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(screen.getByText(en["autostart.unavailable"])).toBeTruthy();
  });
});

describe("with the tray icon off", () => {
  const trayOff: AppSettings = { ...DEFAULT_SETTINGS, tray: false };

  it("is disabled and names the reason", () => {
    render(panel(trayOff, false).ui);
    expect(box().disabled).toBe(true);
    expect(screen.getByText(en["autostart.needsTray"])).toBeTruthy();
    expect(screen.queryByText(en["autostart.settingDetail"])).toBeNull();
  });

  it("still shows an entry that is registered, rather than denying it", () => {
    // The workspace takes the entry away when the icon goes, so this state is
    // momentary. While it lasts the switch says what is true: the app will
    // start with the machine. Drawing it as off would be the panel denying
    // something that is about to happen, from a control that cannot be moved.
    render(panel(trayOff, true).ui);
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(screen.getByText(en["autostart.needsTray"])).toBeTruthy();
  });
});

describe("the entry and the icon", () => {
  it("is disabled in every state where the icon is off", () => {
    // The trap this guards: with the icon off the switch cannot be moved, so
    // an entry that outlived the icon could not be cleared from here. The
    // workspace clears it instead (see App.tsx), and this holds the half the
    // panel owns: whatever the machine says, the control stays put and names
    // the reason.
    const trayOff: AppSettings = { ...DEFAULT_SETTINGS, tray: false };
    for (const state of [true, false, null]) {
      render(panel(trayOff, state).ui);
      expect(box().disabled, `autostart ${state}`).toBe(true);
      expect(screen.getByText(en["autostart.needsTray"])).toBeTruthy();
      cleanup();
    }
  });
});

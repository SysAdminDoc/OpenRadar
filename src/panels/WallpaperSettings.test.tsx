import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { en } from "../i18n/en";
import { WALLPAPER_FLOOR_MINUTES } from "../lib/wallpaper";

/**
 * The control that puts the map on somebody's desktop.
 *
 * Two things are worth holding here rather than in the schedule's own tests:
 * that a machine which cannot do this says so instead of offering a switch
 * that would quietly do nothing, and that no gap under the floor can be
 * chosen from the panel at all.
 */

const available = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../lib/wallpaper", async () => {
  const real =
    await vi.importActual<typeof import("../lib/wallpaper")>(
      "./../lib/wallpaper",
    );
  return { ...real, wallpaperAvailable: available };
});

afterEach(() => {
  cleanup();
  available.mockReset();
  available.mockResolvedValue(true);
});

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
      onClose={vi.fn()}
    />
  );
}

function gaps(): number[] {
  const select = screen
    .getByText(en["wallpaper.every"])
    .closest("label")
    ?.querySelector("select");
  if (!select) throw new Error("no wallpaper control");
  return [...select.options].map((option) => Number(option.value));
}

describe("choosing how often the desktop gets a picture", () => {
  it("offers nothing under the floor", async () => {
    render(panel());
    await waitFor(() => expect(available).toHaveBeenCalled());
    const offered = gaps();
    expect(offered).toContain(0);
    for (const gap of offered) {
      if (gap === 0) continue;
      expect(gap, String(gap)).toBeGreaterThanOrEqual(WALLPAPER_FLOOR_MINUTES);
    }
  });

  it("says so on a machine that cannot do it, instead of offering the switch", async () => {
    available.mockResolvedValue(false);
    render(panel());
    await waitFor(() =>
      expect(screen.getByText(en["wallpaper.unavailable"])).toBeTruthy(),
    );
    const select = screen
      .getByText(en["wallpaper.every"])
      .closest("label")
      ?.querySelector("select");
    expect(select?.disabled).toBe(true);
  });

  it("is off until it is asked for", () => {
    // It takes something of the reader's away for as long as it is on.
    expect(DEFAULT_SETTINGS.wallpaperMinutes).toBe(0);
  });
});

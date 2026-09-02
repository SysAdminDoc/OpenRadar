import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";

afterEach(cleanup);

function panel(
  overrides: Partial<AppSettings["watch"]> = {},
  onSettings = vi.fn(),
  onSendWatchTest = vi.fn(),
) {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    watch: { ...DEFAULT_SETTINGS.watch, ...overrides },
  };
  return {
    onSettings,
    onSendWatchTest,
    ui: (
      <SettingsPanel
        settings={settings}
        onSettings={onSettings}
        onWatchHere={vi.fn()}
        onAddWatchPlace={vi.fn()}
        onSendWatchTest={onSendWatchTest}
        ambient={{ seen: null, dropped: false }}
        onJournalSaved={vi.fn()}
        onJournalFailed={vi.fn()}
        onJournalCleared={vi.fn()}
        onJournalRemoved={vi.fn()}
        clock={0}
        onReset={vi.fn()}
        onExportSettings={vi.fn()}
        onClose={vi.fn()}
      />
    ),
  };
}

describe("the quiet hours controls", () => {
  it("keeps the times out of the way until they are switched on", () => {
    const off = panel();
    render(off.ui);
    expect(screen.getByText(en["watch.quiet"])).toBeTruthy();
    expect(screen.queryByText(en["watch.quietFrom"])).toBeNull();
    cleanup();

    const on = panel({
      quietHours: { ...DEFAULT_SETTINGS.watch.quietHours, enabled: true },
    });
    render(on.ui);
    expect(screen.getByText(en["watch.quietFrom"])).toBeTruthy();
    expect(screen.getByText(en["watch.quietUntil"])).toBeTruthy();
  });

  it("shows the stored window as a time somebody reads", () => {
    const { ui } = panel({
      quietHours: {
        enabled: true,
        startMinute: 22 * 60 + 30,
        endMinute: 7 * 60,
        overrideSeverity: "extreme",
      },
    });
    const { container } = render(ui);
    const times =
      container.querySelectorAll<HTMLInputElement>("input[type='time']");
    expect(times).toHaveLength(2);
    expect(times[0].value).toBe("22:30");
    expect(times[1].value).toBe("07:00");
  });

  it("stores a changed time as minutes past midnight", () => {
    const onSettings = vi.fn();
    const { ui } = panel(
      { quietHours: { ...DEFAULT_SETTINGS.watch.quietHours, enabled: true } },
      onSettings,
    );
    const { container } = render(ui);
    const start =
      container.querySelector<HTMLInputElement>("input[type='time']")!;
    fireEvent.change(start, { target: { value: "23:15" } });
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onSettings.mock.calls[0][0].watch.quietHours.startMinute).toBe(
      23 * 60 + 15,
    );
  });

  // A cleared time field reads as an empty string. Taking that at face value
  // would move the window to midnight under somebody who was only editing it.
  it("keeps the old time when the field is cleared", () => {
    const onSettings = vi.fn();
    const { ui } = panel(
      {
        quietHours: {
          enabled: true,
          startMinute: 1350,
          endMinute: 420,
          overrideSeverity: "extreme",
        },
      },
      onSettings,
    );
    const { container } = render(ui);
    const start =
      container.querySelector<HTMLInputElement>("input[type='time']")!;
    fireEvent.change(start, { target: { value: "" } });
    expect(onSettings.mock.calls[0][0].watch.quietHours.startMinute).toBe(1350);
  });

  it("offers a test that can be pressed without any weather happening", () => {
    const onSendWatchTest = vi.fn();
    const { ui } = panel({}, vi.fn(), onSendWatchTest);
    render(ui);
    fireEvent.click(screen.getByText(en["watch.sendTest"]));
    expect(onSendWatchTest).toHaveBeenCalledTimes(1);
  });
});

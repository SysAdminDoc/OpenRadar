import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./MapOptionsPanels";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { en } from "../i18n/en";
import { WATCH_FAILURES_BEFORE_SAYING, type WatchHealth } from "../lib/watch";

afterEach(cleanup);

function panel(
  overrides: Partial<AppSettings["watch"]> = {},
  onSettings = vi.fn(),
  onSendWatchTest = vi.fn(),
  watchHealth?: WatchHealth,
  clock = 0,
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
        watchHealth={watchHealth}
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

describe("whether the watch is still hearing back", () => {
  it("says when it last did", () => {
    const now = Date.parse("2026-09-02T02:00:00.000Z");
    const { ui } = panel(
      { enabled: true },
      vi.fn(),
      vi.fn(),
      { lastCheckedAt: now - 4 * 60_000, failing: 0, failingSince: null },
      now,
    );
    render(ui);
    expect(screen.getByText(/Last checked 4 min ago/)).toBeTruthy();
    expect(document.querySelector("[data-watch-failing]")).toBeNull();
  });

  it("says nothing at all before the first check comes back", () => {
    // A panel opened two seconds after launch has nothing to report, and
    // "last checked never" is worse than silence.
    const { ui } = panel({ enabled: true });
    render(ui);
    expect(document.querySelector("[data-watch-checked]")).toBeNull();
    expect(document.querySelector("[data-watch-failing]")).toBeNull();
  });

  it("says how long it has been failing once it has given up quietly", () => {
    // The panel said "Watching 32.78, -96.80 for warnings and worse" whatever
    // had happened, so a watch that stopped reaching the service in the night
    // looked exactly like one hearing back every forty-five seconds.
    const now = Date.parse("2026-09-02T02:00:00.000Z");
    const { ui } = panel(
      { enabled: true },
      vi.fn(),
      vi.fn(),
      {
        lastCheckedAt: now - 3 * 60 * 60_000,
        failing: WATCH_FAILURES_BEFORE_SAYING,
        failingSince: now - 3 * 60 * 60_000,
      },
      now,
    );
    render(ui);
    expect(
      screen.getByText(/Checks have been failing for 3 hours/),
    ).toBeTruthy();
    // And not both at once: one line about the watch, not two.
    expect(document.querySelector("[data-watch-checked]")).toBeNull();
  });
});

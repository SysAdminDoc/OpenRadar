import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { useSettings } from "./useSettings";

const mocks = vi.hoisted(() => ({
  loadSettings: vi.fn<() => Promise<AppSettings>>(),
  saveSettings: vi.fn<(settings: AppSettings) => Promise<void>>(),
}));

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  return {
    ...actual,
    loadSettings: mocks.loadSettings,
    saveSettings: mocks.saveSettings,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.loadSettings.mockReset();
  mocks.saveSettings.mockReset();
  mocks.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.saveSettings.mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("settings persistence", () => {
  it("does not let a pending camera save overwrite newer settings", async () => {
    const { result } = renderHook(() =>
      useSettings({ onPersistError: () => {} }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hydrated).toBe(true);

    act(() => {
      result.current.updateCamera({
        ...result.current.settings.camera,
        center: [-97.5, 35.5],
      });
      result.current.applySettings({
        ...result.current.settingsRef.current,
        theme: "light",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
    expect(mocks.saveSettings.mock.calls[0][0].theme).toBe("light");
    expect(mocks.saveSettings.mock.calls[0][0].camera.center).toEqual([
      -97.5, 35.5,
    ]);
  });
});

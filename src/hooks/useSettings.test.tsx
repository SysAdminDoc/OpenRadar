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

describe("a shared link opened in a browser", () => {
  const address = window.location.href;

  afterEach(() => {
    window.history.replaceState(null, "", address);
  });

  it("holds the site the link named, with what it was drawing", async () => {
    // The desktop build takes a shared link through its own scheme and this
    // one has the parameters sitting in the address bar. Only the camera was
    // read here, so a link opened in a browser went to the right place under
    // whatever the receiver's own workspace happened to be on: the site, the
    // product, the tilt and the threshold were all written into the link and
    // then ignored.
    window.history.replaceState(
      null,
      "",
      "/?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0" +
        "&projection=mercator&site=KDMX&product=velocity&tilt=2&threshold=20",
    );
    // A reader who was on the national mosaic, which is the case where
    // "pins the site" means anything: against the defaults both of these
    // are already true and the assertions below would hold with the whole
    // change reverted.
    mocks.loadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      radar: { ...DEFAULT_SETTINGS.radar, singleSite: false, enabled: false },
    });
    const { result } = renderHook(() =>
      useSettings({ onPersistError: () => {} }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const radar = result.current.settings.radar;
    expect(radar.station).toBe("KDMX");
    expect(radar.product).toBe("velocity");
    expect(radar.tilt).toBe(2);
    expect(radar.thresholds.velocity).toBe(20);
    // A link naming a site is a link to that site, held: a receiver on the
    // mosaic would otherwise store a station they never chose and hold it
    // the next time they switched to a single site.
    expect(radar.singleSite).toBe(true);
    expect(radar.enabled).toBe(true);
    expect(result.current.settings.camera.center[0]).toBeCloseTo(-93.723, 3);
  });

  it("draws what the named radar has when the link names something else", async () => {
    // A terminal radar has no spectrum width. The link opens on the site and
    // the picture falls back to reflectivity rather than storing a choice
    // that radar cannot answer.
    window.history.replaceState(
      null,
      "",
      "/?lon=-96.9&lat=32.9&zoom=9.00&bearing=0.0&pitch=0.0" +
        "&projection=mercator&site=TDAL&product=spectrum-width&tilt=0",
    );
    const { result } = renderHook(() =>
      useSettings({ onPersistError: () => {} }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.settings.radar.station).toBe("TDAL");
    expect(result.current.settings.radar.product).toBe("reflectivity");
  });

  it("leaves the workspace alone when the address bar names no site", async () => {
    window.history.replaceState(
      null,
      "",
      "/?lon=-93.72300&lat=41.73100&zoom=9.50&bearing=0.0&pitch=0.0",
    );
    // A reader who already had a site held. Against the defaults this reads
    // null against null and could not tell a clobbered station from an
    // untouched one.
    mocks.loadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      radar: {
        ...DEFAULT_SETTINGS.radar,
        station: "KTLX",
        product: "velocity",
        tilt: 3,
      },
    });
    const { result } = renderHook(() =>
      useSettings({ onPersistError: () => {} }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.settings.radar.station).toBe("KTLX");
    expect(result.current.settings.radar.product).toBe("velocity");
    expect(result.current.settings.radar.tilt).toBe(3);
  });
});

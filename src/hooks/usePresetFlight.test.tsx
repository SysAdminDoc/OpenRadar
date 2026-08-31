import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceActions } from "./useWorkspaceActions";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CameraState,
} from "../lib/settings";
import type { MapViewportHandle } from "../components/MapViewport";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const HOME: CameraState = {
  center: [-96.8, 32.8],
  zoom: 6,
  bearing: 0,
  pitch: 0,
};
const AWAY: CameraState = {
  center: [-80.2, 25.8],
  zoom: 7,
  bearing: 0,
  pitch: 0,
};

function workspace(presets: AppSettings["presets"]) {
  const flyTo = vi.fn();
  const map = { flyTo, camera: () => HOME } as unknown as MapViewportHandle;
  const mapRef = { current: map };
  const settingsRef = { current: { ...DEFAULT_SETTINGS, presets } };
  return {
    flyTo,
    rendered: renderHook(() =>
      useWorkspaceActions({
        hydrated: true,
        mapRef,
        settingsRef,
        applySettings: vi.fn(),
        pushToast: vi.fn(),
        setActiveSurface: vi.fn(),
        setCustomOverlay: vi.fn(),
        customOverlay: null,
      }),
    ),
  };
}

const preset = (name: string, camera: CameraState) => ({
  name,
  camera,
  projection: "mercator" as const,
  mapStyle: "auto" as const,
});

describe("opening a saved view", () => {
  it("flies to it once the style has had a moment to land", () => {
    const { flyTo, rendered } = workspace([
      preset("Home", HOME),
      null,
      null,
      null,
    ]);
    act(() => rendered.result.current.usePreset(0));
    expect(flyTo).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyTo).toHaveBeenCalledWith(HOME);
  });

  // Two opened inside the delay used to leave two flights in the air, and the
  // later arrival won rather than the later request: the reader saw the view
  // they asked for and then watched it slide back to the one before it.
  it("leaves the newest camera active when two are opened quickly", () => {
    const { flyTo, rendered } = workspace([
      preset("Home", HOME),
      preset("Away", AWAY),
      null,
      null,
    ]);
    act(() => {
      rendered.result.current.usePreset(0);
      rendered.result.current.usePreset(1);
    });
    act(() => void vi.advanceTimersByTime(200));
    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyTo).toHaveBeenCalledWith(AWAY);
  });

  it("does not fly anywhere after the workspace has gone", () => {
    const { flyTo, rendered } = workspace([
      preset("Home", HOME),
      null,
      null,
      null,
    ]);
    act(() => rendered.result.current.usePreset(0));
    rendered.unmount();
    act(() => void vi.advanceTimersByTime(200));
    expect(flyTo).not.toHaveBeenCalled();
  });
});

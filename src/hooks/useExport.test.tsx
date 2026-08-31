import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapViewportHandle } from "../components/MapViewport";
import type { RadarFrame } from "../lib/radar";
import type { RadarTimelineState } from "./useRadarTimeline";
import { useExport } from "./useExport";

const { exportLoop, saveFile } = vi.hoisted(() => ({
  exportLoop: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return { ...actual, exportLoop };
});
vi.mock("../lib/saveFile", () => ({ saveFile }));

const frames: RadarFrame[] = [0, 1, 2].map((time) => ({
  providerId: "mrms",
  time,
  tileUrl: "https://example.com/{z}/{x}/{y}.png",
  tileSize: 256,
  maxZoom: 8,
  attribution: "NOAA",
}));

describe("loop export workspace restoration", () => {
  beforeEach(() => {
    exportLoop.mockReset();
    saveFile.mockReset();
  });

  it("restores the selected frame and playback even when encoding fails", async () => {
    const setPlaying = vi.fn();
    const selectFrame = vi.fn();
    const onceIdle = vi.fn().mockResolvedValue(undefined);
    const timeline: RadarTimelineState = {
      frames,
      frameIndex: 2,
      playing: true,
      source: null,
      sourceLabel: null,
      attribution: null,
      error: null,
      cached: false,
      newestObserved: undefined,
      setPlaying,
      selectFrame,
    };
    exportLoop.mockImplementation(async (options) => {
      await options.showFrame(0);
      await options.showFrame(1);
      throw new Error("encoder failed");
    });
    const map = {
      canvas: () => document.createElement("canvas"),
      onceIdle,
    } as unknown as MapViewportHandle;
    const pushToast = vi.fn();
    const { result } = renderHook(() =>
      useExport({
        mapRef: { current: map },
        frames,
        frameIndex: 2,
        source: null,
        timeline,
        pushToast,
      }),
    );

    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(result.current.busy).toBeNull());

    expect(setPlaying.mock.calls[0]).toEqual([false]);
    expect(selectFrame.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
    expect(onceIdle).toHaveBeenCalledTimes(3);
    expect(setPlaying.mock.calls.at(-1)).toEqual([true]);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) }),
    );
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapViewportHandle } from "../components/MapViewport";
import type { RadarFrame } from "../lib/radar";
import type { RadarTimelineState } from "./useRadarTimeline";
import { useExport } from "./useExport";

const { exportLoop, exportStill, saveFile } = vi.hoisted(() => ({
  exportLoop: vi.fn(),
  exportStill: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return { ...actual, exportLoop, exportStill };
});
vi.mock("../lib/saveFile", () => ({ saveFile }));

/** When the frames on the timeline reached this machine. */
const FETCHED_AT = Date.parse("2026-08-31T18:00:00Z");

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
      cachedAgeSeconds: null,
      fetchedAt: FETCHED_AT,
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
        basemapCredit: "OpenStreetMap",
        dataSources: [],
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

describe("the record written beside the picture", () => {
  const timeline: RadarTimelineState = {
    frames,
    frameIndex: 1,
    playing: false,
    source: null,
    sourceLabel: null,
    attribution: null,
    error: null,
    cached: false,
    cachedAgeSeconds: null,
    fetchedAt: FETCHED_AT,
    newestObserved: undefined,
    setPlaying: vi.fn(),
    selectFrame: vi.fn(),
  };

  function renderExport(over: Partial<Parameters<typeof useExport>[0]> = {}) {
    const map = {
      canvas: () => document.createElement("canvas"),
      onceIdle: vi.fn().mockResolvedValue(undefined),
    } as unknown as MapViewportHandle;
    return renderHook(() =>
      useExport({
        mapRef: { current: map },
        frames,
        frameIndex: 1,
        source: null,
        timeline,
        basemapCredit: "OpenStreetMap",
        dataSources: [],
        pushToast: vi.fn(),
        ...over,
      }),
    );
  }

  function sidecarFrom(call: unknown[]) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(JSON.parse(String(reader.result)));
      reader.readAsText(call[1] as Blob);
    });
  }

  beforeEach(() => {
    exportStill.mockReset();
    exportLoop.mockReset();
    saveFile.mockReset();
    saveFile.mockResolvedValue({ path: null });
    exportStill.mockResolvedValue(new Blob(["png"]));
  });

  it("saves a record for the frame the still actually holds", async () => {
    const { result } = renderExport();
    act(() => result.current.exportImage());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const [picture, sidecar] = saveFile.mock.calls;
    expect(picture[0]).toMatch(/^openradar-.*\.png$/);
    expect(sidecar[0]).toBe(picture[0].replace(/\.png$/, "-provenance.json"));

    const written = (await sidecarFrom(sidecar)) as {
      format: string;
      picture: string;
      frames: Array<{ index: number; sourceId: string; observed: string }>;
    };
    expect(written.format).toBe("openradar-provenance");
    expect(written.picture).toBe(picture[0]);
    // One entry, for the one frame that reached the file.
    expect(written.frames).toHaveLength(1);
    expect(written.frames[0].index).toBe(1);
    expect(written.frames[0].sourceId).toBe("mrms");
  });

  // The credit used to be the literal string "OpenRadar · OpenStreetMap ·
  // NOAA", so a live American frame proves nothing. A replayed hurricane does:
  // it was served by the Iowa State archive and the old line called it NOAA.
  it("credits the frame's own source rather than a fixed line", async () => {
    const replay: RadarFrame[] = [
      {
        providerId: "archive",
        time: 1_114_000_000,
        tileUrl: "https://example.com/{z}/{x}/{y}.png",
        tileSize: 256,
        maxZoom: 9,
        attribution:
          '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet NEXRAD archive</a>',
      },
    ];
    const { result } = renderExport({ frames: replay, frameIndex: 0 });
    act(() => result.current.exportImage());
    await waitFor(() => expect(exportStill).toHaveBeenCalled());

    const caption = exportStill.mock.calls[0][1];
    expect(caption.attribution).toBe(
      "OpenRadar · OpenStreetMap · Iowa State Mesonet NEXRAD archive",
    );
    expect(caption.attribution).not.toContain("NOAA");
    // And the tag itself never reaches the picture.
    expect(caption.attribution).not.toContain("<a ");
  });

  // The whole reason a record travels with a picture. An export made offline
  // from a disk cache during an outage used to write nulls for both of these
  // and stamp the moment of the export as the moment the bytes arrived, so
  // every exported record said the picture was live.
  it("says the bytes came off the disk, and how old they were", async () => {
    const offline: RadarTimelineState = {
      ...timeline,
      cached: true,
      cachedAgeSeconds: 3600,
    };
    const { result } = renderExport({ timeline: offline });
    act(() => result.current.exportImage());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{
        cachedAgeSeconds: number | null;
        freshForMs: number | null;
        fetched: string;
      }>;
    };
    const [record] = written.frames;
    expect(record.cachedAgeSeconds).toBe(3600);
    // The loop publishes on the gap between its own frames, which the three
    // fixture frames put a second apart.
    expect(record.freshForMs).toBe(2000);
    expect(record.fetched).toBe("2026-08-31T18:00:00.000Z");
  });

  it("holds every frame a loop wrote, in timeline order", async () => {
    exportLoop.mockImplementation(async (options) => {
      // A GIF writes the tail only, and walks it however it likes.
      options.captionFor(2);
      options.captionFor(1);
      return new Blob(["webm"]);
    });
    const { result } = renderExport();
    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ index: number }>;
    };
    expect(written.frames.map((frame) => frame.index)).toEqual([1, 2]);
  });

  it("keeps the picture when the record cannot be written", async () => {
    saveFile.mockReset();
    saveFile
      .mockResolvedValueOnce({ path: "C:/downloads/openradar.png" })
      .mockRejectedValueOnce(new Error("disk full"));
    const pushToast = vi.fn();
    const { result } = renderExport({ pushToast });
    act(() => result.current.exportImage());
    await waitFor(() => expect(result.current.busy).toBeNull());

    // The picture saved and the person was told so. The sidecar failing is a
    // log line, not a lost export.
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "C:/downloads/openradar.png" }),
    );
  });
});

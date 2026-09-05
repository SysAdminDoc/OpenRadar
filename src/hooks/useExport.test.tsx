import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapViewportHandle } from "../components/MapViewport";
import type { RadarFrame } from "../lib/radar";
import type { RadarTimelineState } from "./useRadarTimeline";
import { useExport } from "./useExport";

const { exportLoop, exportStill, saveFile, setWallpaper } = vi.hoisted(() => ({
  exportLoop: vi.fn(),
  exportStill: vi.fn(),
  saveFile: vi.fn(),
  setWallpaper: vi.fn(),
}));

vi.mock("../lib/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/export")>();
  return { ...actual, exportLoop, exportStill };
});
vi.mock("../lib/saveFile", () => ({ saveFile }));
vi.mock("../lib/wallpaper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/wallpaper")>();
  return { ...actual, setWallpaper };
});

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
        sweep: null,
        siteLoop: null,
        keys: [],
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
        sweep: null,
        siteLoop: null,
        keys: [],
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

  it("walks a held site's own volumes and records each one", async () => {
    // The mosaic steps every two minutes and a radar publishes a volume every
    // four to six, so walking the steps saved the same volume two and three
    // times over, each frame captioned with a mosaic time and credited to a
    // service that did not make the picture.
    const volumes = [4000, 2000, 0].map((back) => FETCHED_AT - back);
    const stepped: number[] = [];
    // Which volume the walk asked to be shown, in order, so the steps it
    // chose can be checked against them.
    const asked: number[] = [];
    const selectFrame = vi.fn((index: number) => {
      const at = [volumes[0], null, volumes[1], null, volumes[2]][index];
      if (typeof at === "number") asked.push(at);
    });
    exportLoop.mockImplementation(
      async (options: {
        frameCount: number;
        showFrame: (index: number) => Promise<void>;
        captionFor: (index: number) => { lines: string[] };
      }) => {
        for (let index = 0; index < options.frameCount; index += 1) {
          await options.showFrame(index);
          options.captionFor(index);
          stepped.push(index);
        }
        return new Blob(["webm"]);
      },
    );
    const stepFrames = [4, 3, 2, 1, 0].map((back) => ({
      ...frames[0],
      time: (FETCHED_AT - back * 1000) / 1000,
    }));
    const { result } = renderExport({
      // Five steps a second apart, which is the fixture timeline's cadence.
      frames: stepFrames,
      timeline: { ...timeline, frames: stepFrames, selectFrame },
      siteLoop: {
        sweep: {
          station: "KDMX",
          product: "Reflectivity",
          collected: new Date(FETCHED_AT).toISOString(),
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        },
        volumes,
        // Already showing whatever is asked for, so the walk does not wait.
        // The waiting itself is checked below.
        drawnVolume: () => asked.at(-1) ?? null,
      } as unknown as Parameters<typeof useExport>[0]["siteLoop"],
    });
    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    // Three volumes, not five steps.
    expect(stepped).toEqual([0, 1, 2]);
    // And the steps it stood on are the ones those volumes are visible at.
    // Without this the walk could pass its own index straight through to the
    // timeline, which is the off-by-one this whole path exists to prevent,
    // and every assertion below would still hold.
    expect(selectFrame.mock.calls.map(([index]) => index)).toEqual([
      0, 2, 4, 1,
    ]);
    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ observed: string | null; sourceId: string }>;
    };
    expect(written.frames.map((frame) => frame.observed)).toEqual(
      volumes.map((at) => new Date(at).toISOString()),
    );
    expect(new Set(written.frames.map((frame) => frame.sourceId))).toEqual(
      new Set(["level2:KDMX"]),
    );
  });

  it("says when each volume reached this machine, not when it was captioned", async () => {
    // A loop holds its volumes, and the second time one is drawn it is not
    // arriving, it is being read back. Every frame used to be stamped with
    // the moment its caption was written, which for a volume the loop had
    // been holding for minutes is simply wrong, and to carry no cache age,
    // which this record's own type documents as meaning the bytes came off
    // the network.
    const volumes = [4000, 2000, 0].map((back) => FETCHED_AT - back);
    // The oldest arrived ten minutes ago, the next five, and the newest has
    // only just landed.
    const arrivals = new Map([
      [volumes[0], FETCHED_AT - 600_000],
      [volumes[1], FETCHED_AT - 300_000],
      [volumes[2], FETCHED_AT],
    ]);
    const asked: number[] = [];
    const selectFrame = vi.fn((index: number) => {
      const at = [volumes[0], null, volumes[1], null, volumes[2]][index];
      if (typeof at === "number") asked.push(at);
    });
    exportLoop.mockImplementation(
      async (options: {
        frameCount: number;
        showFrame: (index: number) => Promise<void>;
        captionFor: (index: number) => { lines: string[] };
      }) => {
        for (let index = 0; index < options.frameCount; index += 1) {
          await options.showFrame(index);
          options.captionFor(index);
        }
        return new Blob(["webm"]);
      },
    );
    const stepFrames = [4, 3, 2, 1, 0].map((back) => ({
      ...frames[0],
      time: (FETCHED_AT - back * 1000) / 1000,
    }));
    const { result } = renderExport({
      frames: stepFrames,
      timeline: { ...timeline, frames: stepFrames, selectFrame },
      arrivedAt: (volume: number) => arrivals.get(volume) ?? null,
      siteLoop: {
        sweep: {
          station: "KDMX",
          product: "Reflectivity",
          collected: new Date(FETCHED_AT).toISOString(),
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        },
        volumes,
        drawnVolume: () => asked.at(-1) ?? null,
      } as unknown as Parameters<typeof useExport>[0]["siteLoop"],
    });
    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ fetched: string; cachedAgeSeconds: number | null }>;
    };
    expect(written.frames.map((frame) => frame.fetched)).toEqual(
      volumes.map((at) => new Date(arrivals.get(at)!).toISOString()),
    );
    // How long each had been held when the file was written. The wall clock
    // runs during the walk, so the ages are asserted by their spacing rather
    // than by an absolute number: five minutes between each, oldest first,
    // and none of them negative. A record that ignored the arrivals would
    // give three equal ages, and one that ignored the volume would give three
    // nulls.
    const ages = written.frames.map((frame) => frame.cachedAgeSeconds!);
    expect(ages[0] - ages[1]).toBe(300);
    expect(ages[1] - ages[2]).toBe(300);
    expect(ages[2]).toBeGreaterThanOrEqual(0);
  });

  it("waits for the volume it is about to caption", async () => {
    // The walk moves the timeline and the map goes idle within a few hundred
    // milliseconds, because the mosaic under the site redraws. The site's own
    // volume is a ten megabyte object still being fetched. Captured on idle,
    // every frame of the file held the previous volume under the next
    // volume's caption and record, with nothing on screen to say so.
    const volumes = [4000, 2000, 0].map((back) => FETCHED_AT - back);
    let drawn: number | null = null;
    const seen: Array<number | null> = [];
    const selectFrame = vi.fn((index: number) => {
      const at = [volumes[0], null, volumes[1], null, volumes[2]][index];
      // The picture lands a little after the step, the way a fetch does.
      if (typeof at === "number") window.setTimeout(() => (drawn = at), 30);
    });
    exportLoop.mockImplementation(
      async (options: {
        frameCount: number;
        showFrame: (index: number) => Promise<void>;
        captionFor: (index: number) => { lines: string[] };
      }) => {
        for (let index = 0; index < options.frameCount; index += 1) {
          await options.showFrame(index);
          seen.push(drawn);
          options.captionFor(index);
        }
        return new Blob(["webm"]);
      },
    );
    const stepFrames = [4, 3, 2, 1, 0].map((back) => ({
      ...frames[0],
      time: (FETCHED_AT - back * 1000) / 1000,
    }));
    const { result } = renderExport({
      frames: stepFrames,
      timeline: { ...timeline, frames: stepFrames, selectFrame },
      siteLoop: {
        sweep: {
          station: "KDMX",
          product: "Reflectivity",
          collected: new Date(FETCHED_AT).toISOString(),
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        },
        volumes,
        drawnVolume: () => drawn,
      } as unknown as Parameters<typeof useExport>[0]["siteLoop"],
    });
    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });

    // Every caption was written with its own volume on screen.
    expect(seen).toEqual(volumes);
  });

  it("credits the radar on a still of any site sweep, not the mosaic", async () => {
    // A still is the file somebody is most likely to send to another person,
    // and it was captioned from the timeline frame underneath the sweep.
    //
    // No loop here on purpose: this is the shape a hand-picked archive volume
    // and a terminal radar arrive in. Both have a sweep on the canvas and no
    // series of their own, and the first fix keyed the caption off the series.
    const { result } = renderExport({
      sweep: {
        station: "KDMX",
        product: "Reflectivity",
        collected: "2026-08-31T18:00:00.000Z",
        source: {
          kind: "archive",
          label: "NOAA NEXRAD Level II archive",
          url: "https://registry.opendata.aws/noaa-nexrad/",
        },
      } as unknown as Parameters<typeof useExport>[0]["sweep"],
      siteLoop: null,
    });
    act(() => result.current.exportImage());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ sourceId: string; observed: string | null }>;
    };
    expect(written.frames[0].sourceId).toBe("level2:KDMX");
    expect(written.frames[0].observed).toBe("2026-08-31T18:00:00.000Z");
  });

  it("looks a still's arrival up by the volume, not by the cut's own time", async () => {
    // `collected` is the CUT's start time. Under MESO-SAILS the lowest tilt
    // is cut four times across one volume, so it is not the volume's time and
    // an arrival looked up by it silently found nothing on every still.
    const volume = Date.parse("2026-08-31T17:55:00.000Z");
    const arrived = FETCHED_AT - 9 * 60_000;
    const { result } = renderExport({
      sweep: {
        station: "KDMX",
        product: "Reflectivity",
        // Eleven seconds into the volume, which is where a re-cut lands.
        collected: "2026-08-31T17:55:11.000Z",
        source: {
          kind: "archive",
          label: "NOAA NEXRAD Level II archive",
          url: "https://registry.opendata.aws/noaa-nexrad/",
        },
      } as unknown as Parameters<typeof useExport>[0]["sweep"],
      siteLoop: null,
      drawnVolume: () => volume,
      arrivedAt: (asked: number) => (asked === volume ? arrived : null),
    });
    act(() => result.current.exportImage());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ fetched: string; cachedAgeSeconds: number | null }>;
    };
    expect(written.frames[0].fetched).toBe(new Date(arrived).toISOString());
    // Held long before this export began, so the age is real.
    expect(written.frames[0].cachedAgeSeconds).toBeGreaterThan(0);
  });

  it("says a volume fetched during the walk came off the network", async () => {
    // `cachedAgeSeconds` means the disk cache served the bytes and they were
    // this old. Writing an age for a volume the walk had just fetched said
    // the cache served it when nothing had; the honest answer for those is
    // the null the field already has a meaning for.
    const volumes = [4000, 2000, 0].map((back) => FETCHED_AT - back);
    const asked: number[] = [];
    const selectFrame = vi.fn((index: number) => {
      const at = [volumes[0], null, volumes[1], null, volumes[2]][index];
      if (typeof at === "number") asked.push(at);
    });
    exportLoop.mockImplementation(
      async (options: {
        frameCount: number;
        showFrame: (index: number) => Promise<void>;
        captionFor: (index: number) => { lines: string[] };
      }) => {
        for (let index = 0; index < options.frameCount; index += 1) {
          await options.showFrame(index);
          options.captionFor(index);
        }
        return new Blob(["webm"]);
      },
    );
    const stepFrames = [4, 3, 2, 1, 0].map((back) => ({
      ...frames[0],
      time: (FETCHED_AT - back * 1000) / 1000,
    }));
    // The first was already held when the button was pressed. The other two
    // arrive while the file is being written, which is what a walk does.
    const held = Date.now() - 120_000;
    const { result } = renderExport({
      frames: stepFrames,
      timeline: { ...timeline, frames: stepFrames, selectFrame },
      arrivedAt: (volume: number) =>
        volume === volumes[0] ? held : Date.now(),
      siteLoop: {
        sweep: {
          station: "KDMX",
          product: "Reflectivity",
          collected: new Date(FETCHED_AT).toISOString(),
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        },
        volumes,
        drawnVolume: () => asked.at(-1) ?? null,
      } as unknown as Parameters<typeof useExport>[0]["siteLoop"],
    });
    act(() => result.current.exportLoopVideo());
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));

    const written = (await sidecarFrom(saveFile.mock.calls[1])) as {
      frames: Array<{ fetched: string; cachedAgeSeconds: number | null }>;
    };
    const ages = written.frames.map((frame) => frame.cachedAgeSeconds);
    expect(ages[0]).toBeGreaterThanOrEqual(120);
    expect(ages[1]).toBeNull();
    expect(ages[2]).toBeNull();
    // The arrival is still recorded for all three: when the bytes turned up
    // is true whether or not a cache served them.
    expect(written.frames[0].fetched).toBe(new Date(held).toISOString());
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

describe("the picture that goes on the desktop", () => {
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
        sweep: null,
        siteLoop: null,
        keys: [],
        pushToast: vi.fn(),
        ...over,
      }),
    );
  }

  beforeEach(() => {
    exportStill.mockReset();
    setWallpaper.mockReset();
    exportStill.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
  });

  it("writes the same composed still a saved picture gets", async () => {
    const { result } = renderExport();
    await act(async () => {
      await result.current.writeWallpaper();
    });
    expect(exportStill).toHaveBeenCalledTimes(1);
    // The caption is what carries the frame time, the credits and the age.
    // A picture on a desktop is looked at hours after it was made, so the
    // age is the line that stops a reader trusting a stale map, and the
    // assertion names it rather than checking a string is a string.
    const caption = exportStill.mock.calls[0][1] as {
      lines: string[];
      attribution: string;
    };
    expect(caption.attribution).toContain("OpenRadar");
    expect(caption.lines.join(" | ")).toMatch(/minute/);
    expect(caption.lines.length).toBeGreaterThanOrEqual(3);
    expect(setWallpaper).toHaveBeenCalledTimes(1);
    expect(setWallpaper.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  });

  it("leaves the last picture up when there is no frame to draw", async () => {
    // Offline, or before the first fetch lands. An empty map on somebody's
    // desktop is worse than the one that is already there.
    const { result } = renderExport({ frames: [], frameIndex: 0 });
    await act(async () => {
      await result.current.writeWallpaper();
    });
    expect(exportStill).not.toHaveBeenCalled();
    expect(setWallpaper).not.toHaveBeenCalled();
  });

  it("hands a failed write back to be said out loud", async () => {
    setWallpaper.mockRejectedValue(new Error("the folder is gone"));
    const { result } = renderExport();
    await expect(result.current.writeWallpaper()).rejects.toThrow(
      "the folder is gone",
    );
  });
});

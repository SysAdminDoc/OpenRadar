import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import { LIVE_REFRESH_MS, SWEEP_REFRESH_MS } from "../lib/level2";
import type { Level2ProductId, SweepImage } from "../lib/level2";
import { DEFAULT_SETTINGS, type RadarSettings } from "../lib/settings";

const nearestSite =
  vi.fn<(lon: number, lat: number) => Promise<string | null>>();
const fetchSweep =
  vi.fn<
    (
      station: string,
      product: Level2ProductId,
      tilt: number,
      live: boolean,
    ) => Promise<SweepImage>
  >();
const fetchArchiveSweep =
  vi.fn<
    (
      station: string,
      at: string,
      product: Level2ProductId,
      tilt: number,
    ) => Promise<SweepImage>
  >();
const fetchLocalSweep =
  vi.fn<
    (
      path: string,
      product: Level2ProductId,
      tilt: number,
    ) => Promise<SweepImage>
  >();
const pickArchiveFile = vi.fn<() => Promise<string | null>>();
const recentVolumeTimes =
  vi.fn<(station: string, count: number) => Promise<number[]>>();

vi.mock("../lib/level2", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/level2")>("../lib/level2");
  return {
    ...actual,
    level2Available: () => true,
    nearestSite: (lon: number, lat: number) => nearestSite(lon, lat),
    fetchSweep: (
      station: string,
      product: Level2ProductId,
      tilt: number,
      _dealias: boolean,
      _motion: [number, number] | null,
      _threshold: number | null,
      live: boolean,
    ) => fetchSweep(station, product, tilt, live),
    fetchArchiveSweep: (...args: Parameters<typeof actual.fetchArchiveSweep>) =>
      fetchArchiveSweep(args[0], args[1], args[2], args[3]),
    fetchLocalSweep: (...args: Parameters<typeof actual.fetchLocalSweep>) =>
      fetchLocalSweep(args[0], args[1], args[2]),
    pickArchiveFile: () => pickArchiveFile(),
    recentVolumeTimes: (station: string, count: number) =>
      recentVolumeTimes(station, count),
  };
});

function sweepFor(
  station: string,
  product: Level2ProductId,
  tilt: number,
): SweepImage {
  return {
    station,
    siteName: "Des Moines, IA",
    productId: product,
    paletteApplied: false,
    highContrast: false,
    smoothed: false,
    dealiased: false,
    live: false,
    liveTilts: 0,
    stormMotion: null,
    product: product === "velocity" ? "Velocity" : "Reflectivity",
    unit: product === "velocity" ? "m/s" : "dBZ",
    elevationDegrees: [0.48, 0.87, 1.31][tilt] ?? 0.48,
    tilts: [0.48, 0.87, 1.31],
    tiltIndex: tilt,
    collected: new Date().toISOString(),
    beneathCollected: null,
    west: -96.5,
    south: 39.6,
    east: -91,
    north: 43.8,
    image: "data:image/png;base64,AAAA",
    volume: `${station}-${product}-${tilt}`,
    radar: "WSR-88D",
    rangeKm: 230,
    source: {
      kind: "recent",
      label: "NOAA NEXRAD Level II",
      url: "https://registry.opendata.aws/noaa-nexrad/",
    },
  };
}

const radar: RadarSettings = {
  ...DEFAULT_SETTINGS.radar,
  singleSite: true,
  station: null,
};

function options(overrides: {
  center?: [number, number];
  radar?: Partial<RadarSettings>;
  showingTime?: number | null;
  compareTime?: number | null;
}) {
  return {
    ready: true,
    radar: { ...radar, ...overrides.radar },
    center: overrides.center ?? ([-93.7, 41.7] as [number, number]),
    zoom: 9,
    pageVisible: true,
    paletteGeneration: 0,
    showingTime: overrides.showingTime ?? null,
    compareTime: overrides.compareTime ?? null,
  };
}

beforeEach(() => {
  nearestSite.mockReset();
  fetchSweep.mockReset();
  fetchArchiveSweep.mockReset();
  fetchLocalSweep.mockReset();
  pickArchiveFile.mockReset();
  recentVolumeTimes.mockReset();
  recentVolumeTimes.mockResolvedValue([]);
  nearestSite.mockResolvedValue("KDMX");
  fetchSweep.mockImplementation(async (station, product, tilt, live) => ({
    ...sweepFor(station, product, tilt),
    live,
  }));
  fetchArchiveSweep.mockImplementation(async (station, _at, product, tilt) => ({
    ...sweepFor(station, product, tilt),
    collected: "2021-12-10T03:15:00.000Z",
    source: {
      kind: "archive",
      label: "NOAA NEXRAD Level II archive",
      url: "https://registry.opendata.aws/noaa-nexrad/",
    },
  }));
  fetchLocalSweep.mockImplementation(async (_path, product, tilt) => ({
    ...sweepFor("KTLX", product, tilt),
    collected: "2013-05-20T20:56:00.000Z",
    source: { kind: "local", label: "KTLX20130520_205600_V06", url: null },
  }));
  pickArchiveFile.mockResolvedValue("C:\\radar\\KTLX20130520_205600_V06");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("choosing a site", () => {
  it("drops the site when the view leaves every site's coverage", async () => {
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ center: props.center })),
      { initialProps: { center: [-93.7, 41.7] as [number, number] } },
    );

    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    // Out over the Atlantic, where the native side answers with nothing.
    nearestSite.mockResolvedValue(null);
    rerender({ center: [-64.8, 32.3] });

    await waitFor(() => expect(result.current.station).toBeNull());
    // The old site's sweep must not still be drawn under a label naming it.
    expect(result.current.sweep).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it("does not read the volume again when the map moves within one site", async () => {
    // The settings object is rebuilt whenever anything in it changes, and the
    // map centre lives in the same settings. Depending on the storm motion
    // object rather than the two numbers in it meant every pan looked like a
    // new motion and pulled the whole volume down again.
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(
          options({
            center: props.center,
            radar: {
              product: "storm-relative-velocity",
              // Rebuilt on each render, exactly as the settings state does it.
              stormMotion: { speedMs: 14, fromDegrees: 230 },
            },
          }),
        ),
      { initialProps: { center: [-93.7, 41.7] as [number, number] } },
    );

    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    expect(fetchSweep).toHaveBeenCalledTimes(1);

    // Inside one cell of the coarse grid the site is resolved on, so nothing
    // about which site to read has changed.
    rerender({ center: [-93.71, 41.71] });
    rerender({ center: [-93.72, 41.72] });
    rerender({ center: [-93.73, 41.73] });

    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    expect(fetchSweep).toHaveBeenCalledTimes(1);
  });

  it("holds a site the panel pinned rather than following the map", async () => {
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ radar: { station: "KTLX" } })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
    expect(nearestSite).not.toHaveBeenCalled();
  });
});

describe("what stays on the map", () => {
  it("takes the previous product down while the next one is on its way", async () => {
    let settle: (() => void) | null = null;
    const { result, rerender } = renderHook(
      (props: { product: Level2ProductId }) =>
        useSingleSiteRadar(options({ radar: { product: props.product } })),
      { initialProps: { product: "reflectivity" as Level2ProductId } },
    );

    await waitFor(() =>
      expect(result.current.sweep?.productId).toBe("reflectivity"),
    );

    // The next request hangs, which is what a slow archive looks like.
    fetchSweep.mockImplementation(
      (station, product, tilt) =>
        new Promise((resolve) => {
          settle = () => resolve(sweepFor(station, product, tilt));
        }),
    );
    rerender({ product: "velocity" });

    // Reflectivity must not still be on screen while velocity is asked for:
    // the legend already says velocity.
    await waitFor(() => expect(result.current.sweep).toBeNull());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      settle?.();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.sweep?.productId).toBe("velocity"),
    );
  });

  it("takes the sweep down when the request fails and says why", async () => {
    const { result, rerender } = renderHook(
      (props: { tilt: number }) =>
        useSingleSiteRadar(options({ radar: { tilt: props.tilt } })),
      { initialProps: { tilt: 0 } },
    );

    await waitFor(() => expect(result.current.sweep).not.toBeNull());

    fetchSweep.mockRejectedValue("KDMX has no Velocity sweep at that tilt");
    rerender({ tilt: 2 });

    await waitFor(() =>
      expect(result.current.error).toBe(
        "KDMX has no Velocity sweep at that tilt",
      ),
    );
    // A stale picture under a fresh label is worse than no picture.
    expect(result.current.sweep).toBeNull();
    expect(result.current.active).toBe(false);
  });
});

describe("historical volumes", () => {
  it("keeps the active sweep when a selected local file is malformed", async () => {
    const { result } = renderHook(() => useSingleSiteRadar(options({})));
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    const before = result.current.sweep;
    fetchLocalSweep.mockRejectedValue({
      code: "decode",
      args: ["the Archive II header is missing"],
      text: "the volume could not be decoded",
    });

    let loaded = true;
    await act(async () => {
      loaded = await result.current.openLocal();
    });

    expect(loaded).toBe(false);
    expect(result.current.sweep).toBe(before);
    expect(result.current.historical).toBe(false);
    expect(result.current.mode).toBe("recent");
    expect(result.current.error).toMatch(/Archive II header is missing/);
  });

  it("keeps product and tilt controls on the selected public volume", async () => {
    const { result, rerender } = renderHook(
      (props: { product: Level2ProductId; tilt: number }) =>
        useSingleSiteRadar(
          options({ radar: { product: props.product, tilt: props.tilt } }),
        ),
      {
        initialProps: {
          product: "reflectivity" as Level2ProductId,
          tilt: 0,
        },
      },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("ktlx", "2013-05-20T20:56:00.000Z");
    });
    expect(result.current.historical).toBe(true);
    expect(result.current.mode).toBe("archive");
    expect(result.current.sweep?.source.kind).toBe("archive");
    expect(fetchArchiveSweep).toHaveBeenLastCalledWith(
      "KTLX",
      "2013-05-20T20:56:00.000Z",
      "reflectivity",
      0,
    );

    rerender({ product: "velocity", tilt: 2 });
    await waitFor(() => {
      expect(result.current.sweep?.productId).toBe("velocity");
      expect(result.current.sweep?.tiltIndex).toBe(2);
    });
    expect(fetchArchiveSweep).toHaveBeenLastCalledWith(
      "KTLX",
      "2013-05-20T20:56:00.000Z",
      "velocity",
      2,
    );
  });

  it("keeps the last verified historical picture when another cut fails", async () => {
    const { result, rerender } = renderHook(
      (props: { product: Level2ProductId; tilt: number }) =>
        useSingleSiteRadar(
          options({ radar: { product: props.product, tilt: props.tilt } }),
        ),
      {
        initialProps: {
          product: "reflectivity" as Level2ProductId,
          tilt: 0,
        },
      },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    await act(async () => {
      await result.current.openArchive("KTLX", "2013-05-20T20:56:00.000Z");
    });
    const before = result.current.sweep;

    fetchArchiveSweep.mockRejectedValue({
      code: "noSweep",
      args: ["KTLX", "Velocity"],
      text: "KTLX has no Velocity sweep at that tilt",
    });
    rerender({ product: "velocity", tilt: 4 });

    await waitFor(() =>
      expect(result.current.error).toMatch(/no Velocity sweep/),
    );
    expect(result.current.sweep).toBe(before);
    expect(result.current.historical).toBe(true);
    expect(result.current.active).toBe(true);
  });

  it("returns from a selected volume to the recent site", async () => {
    const { result } = renderHook(() => useSingleSiteRadar(options({})));
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    await act(async () => {
      await result.current.openArchive("KTLX", "2013-05-20T20:56:00.000Z");
    });
    expect(result.current.historical).toBe(true);

    act(() => result.current.resumeRecent());
    await waitFor(() => {
      expect(result.current.historical).toBe(false);
      expect(result.current.sweep?.station).toBe("KDMX");
    });
  });
});

describe("a refresh that fails", () => {
  it("takes the picture down rather than leaving a frozen one up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() => useSingleSiteRadar(options({})));
      await waitFor(() => expect(result.current.sweep).not.toBeNull());

      // Nothing about the request changes; the archive simply stops answering.
      fetchSweep.mockRejectedValue("the volume listing could not be read");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SWEEP_REFRESH_MS + 1_000);
      });

      // The sweep still matches the site, product, and tilt being asked for,
      // so nothing else would drop it. A picture minutes old with no sign that
      // it has stopped updating is worse than handing the map back.
      await waitFor(() => expect(result.current.sweep).toBeNull());
      expect(result.current.error).toBe("the volume listing could not be read");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("moving between sites", () => {
  it("does not answer for the new place with the old place's site", async () => {
    let settle: ((site: string) => void) | null = null;
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ center: props.center })),
      { initialProps: { center: [-93.7, 41.7] as [number, number] } },
    );

    await waitFor(() => expect(result.current.station).toBe("KDMX"));

    // Oklahoma. The answer is slow, which is what a cold command call is.
    nearestSite.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    rerender({ center: [-97.5, 35.5] });

    // KDMX was resolved for Iowa. Naming it over Oklahoma, and fetching its
    // sweep, is answering a question nobody asked.
    expect(result.current.station).toBeNull();
    expect(result.current.sweep).toBeNull();

    await act(async () => {
      settle?.("KTLX");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.station).toBe("KTLX"));
  });
});

describe("drawing the volume in progress", () => {
  it("asks for it only when the reader has said to", async () => {
    const { result, rerender } = renderHook(
      (props: { live: boolean }) =>
        useSingleSiteRadar(options({ radar: { live: props.live } })),
      { initialProps: { live: false } },
    );
    await waitFor(() => expect(result.current.sweep).not.toBeNull());
    expect(fetchSweep.mock.calls[0][3]).toBe(false);
    expect(result.current.sweep?.live).toBe(false);

    rerender({ live: true });
    await waitFor(() => expect(result.current.sweep?.live).toBe(true));
    expect(fetchSweep.mock.calls.at(-1)?.[3]).toBe(true);
  });

  it("asks often enough that a new piece is on screen inside half a minute", async () => {
    // The radar publishes a piece every eleven or twelve seconds. Waiting the
    // finished volume's two minutes would leave most of them unseen, which is
    // the whole thing this is for.
    expect(LIVE_REFRESH_MS).toBeLessThanOrEqual(30_000);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() =>
        useSingleSiteRadar(options({ radar: { live: true } })),
      );
      await waitFor(() => expect(result.current.sweep).not.toBeNull());
      const first = fetchSweep.mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 500);
      });
      await waitFor(() =>
        expect(fetchSweep.mock.calls.length).toBeGreaterThan(first),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the slower ask when it is switched off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() =>
        useSingleSiteRadar(options({ radar: { live: false } })),
      );
      await waitFor(() => expect(result.current.sweep).not.toBeNull());
      const first = fetchSweep.mock.calls.length;

      // A finished volume lands every four to six minutes, so asking on the
      // live cadence would be four wasted requests out of five.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS + 500);
      });
      expect(fetchSweep.mock.calls.length).toBe(first);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SWEEP_REFRESH_MS);
      });
      await waitFor(() =>
        expect(fetchSweep.mock.calls.length).toBeGreaterThan(first),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the loop, and what is not part of it", () => {
  /** Three volumes five minutes apart, oldest first. */
  const VOLUMES = [10, 5, 0].map(
    (back) => Date.UTC(2026, 8, 3, 2, 0) - back * 60_000,
  );

  beforeEach(() => {
    recentVolumeTimes.mockResolvedValue(VOLUMES);
  });

  it("says which volume the picture on screen is, not which one was asked for", async () => {
    // The two differ for as long as a fetch takes, which for a ten megabyte
    // archive object is seconds. A saved loop that captured each frame as
    // soon as the map went idle wrote the previous volume's pixels under the
    // next volume's caption, silently, for every frame of the file.
    let settle: (() => void) | null = null;
    fetchArchiveSweep.mockImplementationOnce(
      async (station, _at, product, tilt) => {
        await new Promise<void>((resolve) => {
          settle = resolve;
        });
        return {
          ...sweepFor(station, product, tilt),
          collected: "2021-12-10T03:15:00.000Z",
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: "https://registry.opendata.aws/noaa-nexrad/",
          },
        };
      },
    );

    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      { initialProps: options({ showingTime: VOLUMES[0] + 60_000 }) },
    );

    await waitFor(() => expect(result.current.loop).not.toBeNull());
    expect(result.current.loop).toEqual({ index: 1, count: 3 });
    // Asked for, not yet drawn.
    expect(result.current.drawnVolume).toBeNull();

    await act(async () => {
      settle?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.drawnVolume).toBe(VOLUMES[0]));
  });

  it("stops re-listing while a loop is being written out", async () => {
    // A refresh answers with the LAST N volumes, so one landing mid-walk
    // pushes the oldest out of the list. A saved loop of thirty volumes runs
    // longer than the refresh interval, and the frames it had left to write
    // were volumes the hook had just stopped knowing about: the loop stood
    // down, the live sweep was drawn, and the caption still named the volume
    // that had gone.
    vi.useFakeTimers();
    try {
      let held = false;
      const { result } = renderHook(
        (props: Parameters<typeof useSingleSiteRadar>[0]) =>
          useSingleSiteRadar(props),
        {
          initialProps: {
            ...options({ showingTime: VOLUMES[0] + 60_000 }),
            listingHeld: () => held,
          },
        },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.volumes).toEqual(VOLUMES);

      // The archive publishes another volume, and the oldest falls off.
      const moved = [...VOLUMES.slice(1), VOLUMES[2] + 5 * 60_000];
      recentVolumeTimes.mockResolvedValue(moved);

      held = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SWEEP_REFRESH_MS * 2);
      });
      expect(result.current.volumes).toEqual(VOLUMES);
      expect(result.current.loop).toEqual({ index: 1, count: 3 });

      // Let go and the next tick takes the new list.
      held = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SWEEP_REFRESH_MS);
      });
      expect(result.current.volumes).toEqual(moved);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no loop position once the reader opens a volume by hand", async () => {
    // Scrubbing has not left the present; opening a file or a moment has.
    // With the loop position still set, the chrome read the view as current:
    // the legend said VOLUME 2 OF 3 over a volume from 2021, the archive
    // credit under the map disappeared, and the scrubber came back to life
    // over a picture it does not drive.
    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      { initialProps: options({ showingTime: VOLUMES[0] + 60_000 }) },
    );
    await waitFor(() => expect(result.current.loop).not.toBeNull());

    await act(async () => {
      await result.current.openArchive("KDMX", "2021-12-10T03:15:00.000Z");
    });

    expect(result.current.historical).toBe(true);
    expect(result.current.loop).toBeNull();
    expect(result.current.drawnVolume).toBeNull();
    expect(result.current.volumes).toEqual([]);
  });
});

describe("the pane that compares", () => {
  /** Three volumes five minutes apart, oldest first. */
  const VOLUMES = [10, 5, 0].map(
    (back) => Date.UTC(2026, 8, 3, 2, 0) - back * 60_000,
  );

  beforeEach(() => {
    recentVolumeTimes.mockResolvedValue(VOLUMES);
  });

  it("draws the volume the compare moment belongs to, not the one on the first pane", async () => {
    // The second pane was handed the first pane's sweep along with everything
    // else, so with a site held the two panes drew one volume between them
    // and the offset meant nothing at all.
    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      {
        initialProps: options({
          // Newest step on the first pane, and a moment on the second that
          // is nearer the volume AFTER it: four minutes past the oldest and
          // one minute short of the middle one. At-or-before takes the
          // oldest, nearest would take the middle, and a moment a minute
          // past a volume cannot tell the two rules apart.
          showingTime: VOLUMES[2],
          compareTime: VOLUMES[0] + 4 * 60_000,
        }),
      },
    );

    await waitFor(() => expect(result.current.compare.sweep).not.toBeNull());
    expect(result.current.compare.at).toBe(VOLUMES[0]);
    // At or before, the same rule the first pane follows: a minute past the
    // oldest volume is still that volume.
    const asked = fetchArchiveSweep.mock.calls.map(([, at]) => at);
    expect(asked).toContain(new Date(VOLUMES[0]).toISOString());
  });

  it("shows the same volume as the first pane when the offset is inside one", async () => {
    // Two mosaic steps apart is less than one volume apart, and the honest
    // answer is that there is nothing to compare: both panes show the volume
    // that was true then.
    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      {
        initialProps: options({
          showingTime: VOLUMES[1] + 4 * 60_000,
          compareTime: VOLUMES[1] + 60_000,
        }),
      },
    );
    await waitFor(() => expect(result.current.compare.sweep).not.toBeNull());
    expect(result.current.compare.at).toBe(VOLUMES[1]);
    expect(result.current.loop).not.toBeNull();
  });

  it("remembers when a volume's bytes arrived, and only for the ones it read", async () => {
    // What a saved loop needs to tell a picture that just came off the
    // network from one the loop has been holding for ten minutes. Nothing
    // recorded it: an export stamped every frame with the moment its caption
    // was written and reported no cache age, which the record's own type
    // documents as meaning the bytes came off the network.
    const before = Date.now();
    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      {
        initialProps: options({
          showingTime: VOLUMES[0],
          compareTime: VOLUMES[2],
        }),
      },
    );

    await waitFor(() => expect(result.current.compare.sweep).not.toBeNull());
    const first = result.current.arrivedAt(VOLUMES[0]);
    expect(first).not.toBeNull();
    expect(first).toBeGreaterThanOrEqual(before);
    expect(result.current.arrivedAt(VOLUMES[2])).not.toBeNull();
    // A volume neither pane asked for was never fetched, and saying when it
    // arrived would be an invention.
    expect(result.current.arrivedAt(VOLUMES[1])).toBeNull();
  });

  it("keeps each picture's own arrival, not the newest fetch's", async () => {
    // The arrival used to be filed under the volume alone while the pictures
    // were filed under the whole fetch key. Switching product overwrote the
    // time, and the earlier product's picture was still held and still
    // exportable: an export of it wrote a time ten minutes too late, with
    // nothing on screen to say so.
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      {
        initialProps: options({
          showingTime: VOLUMES[0],
          radar: { product: "reflectivity" },
        }),
      },
    );
    await waitFor(() => expect(result.current.sweep).not.toBeNull());
    const first = result.current.arrivedAt(VOLUMES[0]);
    expect(first).not.toBeNull();

    // Long enough that a wrong answer cannot be mistaken for a right one.
    await new Promise((done) => setTimeout(done, 25));
    rerender(
      options({ showingTime: VOLUMES[0], radar: { product: "velocity" } }),
    );
    await waitFor(() => expect(fetchArchiveSweep).toHaveBeenCalledTimes(2));
    const second = result.current.arrivedAt(VOLUMES[0]);
    expect(second).not.toBeNull();
    expect(second).toBeGreaterThan(first!);

    // Back to the first product. Nothing is fetched: the picture is the one
    // already held, and its arrival is the one it came with.
    rerender(
      options({ showingTime: VOLUMES[0], radar: { product: "reflectivity" } }),
    );
    await waitFor(() =>
      expect(result.current.arrivedAt(VOLUMES[0])).toBe(first),
    );
    expect(fetchArchiveSweep).toHaveBeenCalledTimes(2);
  });

  it("records the newest volume arriving, which nothing scrubs back to", async () => {
    // The newest volume is drawn by the live path rather than the scrubbed
    // one, and only the scrubbed one recorded anything. The last frame of
    // every saved loop was the one frame with no arrival.
    const before = Date.now();
    const { result } = renderHook(() => useSingleSiteRadar(options({})));
    await waitFor(() => expect(result.current.sweep).not.toBeNull());
    await waitFor(() =>
      expect(result.current.arrivedAt(VOLUMES[2])).not.toBeNull(),
    );
    expect(result.current.arrivedAt(VOLUMES[2])).toBeGreaterThanOrEqual(before);
  });

  it("has nothing to compare with the pane closed", async () => {
    const { result } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      { initialProps: options({ showingTime: VOLUMES[2] }) },
    );
    await waitFor(() => expect(result.current.volumes).toHaveLength(3));
    expect(result.current.compare).toEqual({ sweep: null, at: null });
  });
});

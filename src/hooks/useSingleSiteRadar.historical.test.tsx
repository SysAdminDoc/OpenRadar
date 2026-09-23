import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import { sweepDetailBox } from "../lib/level2";
import type { Level2ProductId, SweepImage } from "../lib/level2";
import {
  armSingleSiteSpies,
  DISCS,
  options,
  sweepFor,
  type Box,
} from "../test/singleSite";

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
      within: Box,
    ) => Promise<SweepImage>
  >();
const fetchLocalSweep =
  vi.fn<
    (
      path: string,
      product: Level2ProductId,
      tilt: number,
      within: Box,
    ) => Promise<SweepImage>
  >();
const pickArchiveFile = vi.fn<() => Promise<string | null>>();
const recentVolumeTimes =
  vi.fn<(station: string, count: number) => Promise<number[]>>();
const exportVolumeFile =
  vi.fn<(request: { station: string; volume: string }) => Promise<unknown>>();

// The desktop answer, because every data export is guarded on it and jsdom is
// a browser: left alone, `dataExportAvailable()` is false here and the whole
// family of guards below is unreachable, so a case about which of them offers
// what would pass against any answer at all.
vi.mock("../lib/dataExport", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/dataExport")>(
      "../lib/dataExport",
    );
  return {
    ...actual,
    dataExportAvailable: () => true,
    exportVolumeFile: (request: { station: string; volume: string }) =>
      exportVolumeFile(request),
  };
});

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
      fetchArchiveSweep(args[0], args[1], args[2], args[3], args[8]),
    fetchLocalSweep: (...args: Parameters<typeof actual.fetchLocalSweep>) =>
      fetchLocalSweep(args[0], args[1], args[2], args[7]),
    pickArchiveFile: () => pickArchiveFile(),
    recentVolumeTimes: (station: string, count: number) =>
      recentVolumeTimes(station, count),
  };
});

beforeEach(() => {
  armSingleSiteSpies({
    nearestSite,
    fetchSweep,
    fetchArchiveSweep,
    fetchLocalSweep,
    pickArchiveFile,
    recentVolumeTimes,
    exportVolumeFile,
  });
});

afterEach(() => {
  cleanup();
  // Vitest clears mocks between tests on its own since 5.0.
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
      null,
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
      null,
    );
  });

  it("draws an archived volume over the ground the reader is looking at", async () => {
    // The request key left the box out, so the effect that follows the reader
    // early-returned on an unchanged key however far they zoomed. An archived
    // volume opened at one zoom stayed clipped to that box for ever: zoom out
    // and it was a postage stamp on a map covering 460 kilometres.
    const { result, rerender } = renderHook(
      (props: { zoom: number }) => useSingleSiteRadar(options(props)),
      { initialProps: { zoom: 12 } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    const opened = fetchArchiveSweep.mock.calls.at(-1)![4];
    expect(
      opened,
      "an archived volume of the live site follows the zoom",
    ).not.toBeNull();

    rerender({ zoom: 13 });
    await waitFor(() => {
      expect(fetchArchiveSweep.mock.calls.at(-1)![4]).not.toEqual(opened);
    });
    const closer = fetchArchiveSweep.mock.calls.at(-1)![4]!;
    expect(closer[2] - closer[0]).toBeLessThan(opened![2] - opened![0]);
  });

  it("keeps the box a reader keeps coming back to, not the one they saw first", async () => {
    // `trimHeld` keeps the last entries by insertion order, and reading a key
    // out of a Map does not move it, so the order was when each box first
    // arrived rather than when it was last wanted. A reader working between
    // two boxes therefore lost whichever they had opened first the moment a
    // ninth arrived: the two in use were the two evicted, and the next pan
    // back paid ten megabytes for a picture that had been in hand a second
    // earlier.
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ ...props, zoom: 12 })),
      { initialProps: { center: [-96.2, 41.7] as [number, number] } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The snap grid at this zoom is a third of a degree. The box the archive
    // opened on is the earliest entry in the hold, which is the one insertion
    // order sheds first and recency keeps: eight more cells fill the hold and
    // a ninth pushes one out.
    const cellWide = 0.34375;
    const cells: Array<[number, number]> = [];
    for (let step = 0; step < 8; step += 1) {
      cells.push([-95.4 + step * cellWide, 41.7]);
    }
    const visit = async (at: [number, number]) => {
      rerender({ center: at });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    };

    // Seven more boxes, each a fetch of its own or the walk is not filling
    // the hold and nothing below means anything. With the opening box that
    // is eight, which is what the hold keeps.
    for (const at of cells.slice(0, 7)) {
      const before = fetchArchiveSweep.mock.calls.length;
      await visit(at);
      expect(
        fetchArchiveSweep.mock.calls.length,
        `${at[0]} was not a box of its own`,
      ).toBeGreaterThan(before);
    }

    // Back to the box the archive opened on. Held, so no fetch, and this is
    // the touch that has to move it to the front of the queue.
    const beforeReturn = fetchArchiveSweep.mock.calls.length;
    await visit([-96.2, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the opening box was not held at all",
    ).toBe(beforeReturn);

    // A ninth box, which pushes exactly one entry out of the hold.
    const beforeNinth = fetchArchiveSweep.mock.calls.length;
    await visit(cells[7]);
    expect(fetchArchiveSweep.mock.calls.length).toBeGreaterThan(beforeNinth);

    // The one just used must be the one still there.
    const beforeLast = fetchArchiveSweep.mock.calls.length;
    await visit([-96.2, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the box in use was the box evicted",
    ).toBe(beforeLast);
  });

  it("lets the held pictures go when the reader goes back to live", async () => {
    // Eight decoded sweeps, several megabytes each, stayed pinned for the
    // life of the window after historical mode was left, and none of them
    // could be reached again without re-entering it and choosing the same
    // volume anyway.
    //
    // Seen through a pan rather than through the open, because opening an
    // archive always fetches: it is the effect that reads the hold, so a box
    // panned to is the only thing that can say whether the hold survived.
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ ...props, zoom: 12 })),
      { initialProps: { center: [-96.2, 41.7] as [number, number] } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    const visit = async (at: [number, number]) => {
      rerender({ center: at });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    };

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A second box, so there is something in the hold worth keeping.
    const beforePan = fetchArchiveSweep.mock.calls.length;
    await visit([-95.4, 41.7]);
    expect(fetchArchiveSweep.mock.calls.length).toBeGreaterThan(beforePan);
    // Held: panning back is free, which is what the hold is for.
    const beforeBack = fetchArchiveSweep.mock.calls.length;
    await visit([-96.2, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the second box was never held, so this proves nothing",
    ).toBe(beforeBack);

    act(() => {
      result.current.resumeRecent();
    });
    await waitFor(() => expect(result.current.historical).toBe(false));

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The same box as before. Still held, it would come back without a fetch,
    // which is the memory this is meant to have released.
    const beforeAgain = fetchArchiveSweep.mock.calls.length;
    await visit([-95.4, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the pictures were still held after going back to live",
    ).toBeGreaterThan(beforeAgain);
  });

  it("lets the held pictures go when single site is switched off too", async () => {
    // `resumeRecent` is one way out of historical mode and not the only one.
    // Turning the radar off, or leaving single site, drops the mode without
    // that button ever being pressed, and eight decoded sweeps stayed pinned
    // for the life of the window through that door.
    //
    // Seen through a pan, because the request key survives the round trip and
    // the picture on screen comes back from React state rather than from the
    // hold: a box panned to is the only thing that can say whether the hold
    // itself survived.
    const { result, rerender } = renderHook(
      (props: { singleSite: boolean; center: [number, number] }) =>
        useSingleSiteRadar(
          options({
            zoom: 12,
            center: props.center,
            radar: { singleSite: props.singleSite },
          }),
        ),
      {
        initialProps: {
          singleSite: true,
          center: [-96.2, 41.7] as [number, number],
        },
      },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    const visit = async (at: [number, number], singleSite = true) => {
      rerender({ singleSite, center: at });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    };

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A second box, then back, so there is something held worth releasing.
    const beforePan = fetchArchiveSweep.mock.calls.length;
    await visit([-95.4, 41.7]);
    expect(fetchArchiveSweep.mock.calls.length).toBeGreaterThan(beforePan);
    const beforeBack = fetchArchiveSweep.mock.calls.length;
    await visit([-96.2, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the second box was never held, so this proves nothing",
    ).toBe(beforeBack);

    // Out of single site and back, which never touches `resumeRecent`.
    await visit([-96.2, 41.7], false);
    await visit([-96.2, 41.7], true);

    const beforeAgain = fetchArchiveSweep.mock.calls.length;
    await visit([-95.4, 41.7]);
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the pictures were still held after leaving single site",
    ).toBeGreaterThan(beforeAgain);
  });

  it("puts a file on screen even if a held box is served while it loads", async () => {
    // Both an explicit open and a box served out of the hold move the request
    // counter, so a stale answer cannot repaint the map. The hold's move
    // landed between an open taking its number and its answer arriving: the
    // picker closed, the file was read, and the picture was thrown away as
    // stale. `openLocal` returns false for that, which is also what a
    // cancelled dialog looks like, so nothing was said and the press appeared
    // to do nothing.
    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ ...props, zoom: 12 })),
      { initialProps: { center: [-96.2, 41.7] as [number, number] } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const visit = async (at: [number, number]) => {
      rerender({ center: at });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    };

    // Somewhere else and back, so the first box is in the hold and panning to
    // it is served from memory rather than fetched.
    await visit([-95.4, 41.7]);
    await visit([-96.2, 41.7]);

    // The file the reader picks, held open until the pan that hits the hold
    // has been served.
    let handOver: (() => void) | null = null;
    pickArchiveFile.mockResolvedValue("C:/volumes/picked_KTLX");
    fetchLocalSweep.mockImplementation(
      (_path: string, product: Level2ProductId, tilt: number) =>
        new Promise((resolve) => {
          handOver = () =>
            resolve({
              ...sweepFor("KTLX", product, tilt),
              collected: "2013-05-20T20:56:00.000Z",
              source: { kind: "local", label: "picked", url: null },
            });
        }),
    );

    // Deliberately not wrapped in one `act`. A `rerender` inside an outer
    // `act` defers its commit until that act settles, so the effect ran after
    // the file had already answered and the race never happened: a probe on
    // the request counter showed the answer landing first every time.
    // `rerender` wraps itself, so calling it between the two awaits is what
    // puts the hold branch in the middle of the open.
    const opening = result.current.openLocal();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(handOver, "the file was never read").not.toBeNull();

    const before = fetchArchiveSweep.mock.calls.length;
    rerender({ center: [-95.4, 41.7] });
    expect(
      fetchArchiveSweep.mock.calls.length,
      "the pan was fetched rather than served from the hold",
    ).toBe(before);

    let picked: boolean | undefined;
    await act(async () => {
      handOver?.();
      picked = await opening;
    });
    expect(picked, "the open reported failure").toBe(true);

    await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
    expect(
      result.current.mode,
      "the file the reader picked was dropped for a box out of memory",
    ).toBe("local");
  });

  it("holds an archived box it has already drawn, the way the loop does", async () => {
    // The scrubber has kept its frames since it was written and this path
    // never learned to: it compared one string and kept nothing, so panning
    // off a grid cell and back re-fetched the archived volume and re-decoded
    // it. Ten megabytes and a decode for a picture already in hand.
    const { result, rerender } = renderHook(
      (props: { zoom: number }) => useSingleSiteRadar(options(props)),
      { initialProps: { zoom: 12 } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const opened = fetchArchiveSweep.mock.calls.at(-1)![4];
    expect(opened).not.toBeNull();
    const settled = fetchArchiveSweep.mock.calls.length;

    // Away to a different box, which is a fetch, and back to the first, which
    // must not be. Waiting for each to land matters: the request key is only
    // written when the answer arrives, so moving on before that early-returns
    // on the unchanged key and would prove nothing about the cache.
    rerender({ zoom: 13 });
    await waitFor(() =>
      expect(fetchArchiveSweep.mock.calls.at(-1)![4]).not.toEqual(opened),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ zoom: 12 });
    await waitFor(() =>
      expect(fetchArchiveSweep.mock.calls.at(-1)![4]).toEqual(opened),
    ).catch(() => undefined);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // One fetch for the box moved to, and none for the one moved back to.
    expect(
      fetchArchiveSweep.mock.calls.length - settled,
      "a there-and-back over an archived volume cost more than one fetch",
    ).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not let a fetch the held box overtook repaint the map", async () => {
    // Serving a held box takes the request counter with it. Without that, a
    // fetch already in flight lands afterwards, still believing it is the
    // current one, writes the request key to its own box and paints its own
    // picture: the reader is looking at one box and the map is drawing
    // another. For an archive source nothing in the effect's dependencies has
    // changed by then, so it never runs again and the wrong picture stays.
    //
    // Three cells, because two cannot reach the held branch: returning to the
    // box that last landed leaves the request key equal to the new one and
    // the effect returns before it looks at the hold. What is needed is a
    // move onto ground nobody has been to, so a fetch is in flight, and then
    // a move back onto ground that is held.
    //
    // Two locks hold this path and either one alone is enough: the request
    // counter the held branch bumps, and the per-run token `useLatestReply`
    // hands out, which the re-run invalidates. Removing either leaves this
    // case green and removing both fails it, which is how it was established
    // on 2026-09-08 that the bump is a second lock rather than the only one.
    // An earlier report called it load-bearing on its own; it is not. What is
    // pinned here is the behaviour, that a fetch the reader moved past cannot
    // repaint the map, rather than whichever guard happens to deliver it.
    const pending: Array<() => void> = [];
    let holdThem = false;
    fetchArchiveSweep.mockImplementation(
      async (station, _at, product, tilt, within) => {
        const answer: SweepImage = {
          ...sweepFor(station, product, tilt),
          // Which box this picture was drawn for, so the assertion can name
          // the one on screen rather than counting calls.
          volume: `box:${String(within)}`,
          collected: "2021-12-10T03:15:00.000Z",
          source: {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive",
            url: null,
          },
        };
        if (!holdThem) return answer;
        return new Promise<SweepImage>((resolve) => {
          pending.push(() => resolve(answer));
        });
      },
    );

    const first: [number, number] = [-93.7, 41.7];
    const second: [number, number] = [-93.4, 41.7];
    const fresh: [number, number] = [-93.1, 41.7];
    const boxes = [first, second, fresh].map((at) =>
      String(sweepDetailBox(DISCS.KDMX, at, 13, 1440)),
    );
    // Three cells of the snap grid, or there is nothing to overtake.
    expect(new Set(boxes).size, "the three cameras share a box").toBe(3);

    const { result, rerender } = renderHook(
      (props: { center: [number, number] }) =>
        useSingleSiteRadar(options({ center: props.center, zoom: 13 })),
      { initialProps: { center: first } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() =>
      expect(result.current.sweep?.volume).toBe(`box:${boxes[0]}`),
    );

    // A second box, so the first one is held and the request key has moved
    // off it. Both are needed for the branch below.
    rerender({ center: second });
    await waitFor(() =>
      expect(result.current.sweep?.volume).toBe(`box:${boxes[1]}`),
    );

    // Onto ground nobody has been to, and hold that answer in flight.
    holdThem = true;
    rerender({ center: fresh });
    await waitFor(() => expect(pending.length).toBe(1));

    // Back onto the first box, which is served from the hold without a fetch.
    rerender({ center: first });
    await waitFor(() =>
      expect(result.current.sweep?.volume).toBe(`box:${boxes[0]}`),
    );

    // Now the overtaken fetch lands. It must not repaint the map.
    await act(async () => {
      pending.forEach((release) => release());
      await Promise.resolve();
    });
    expect(
      result.current.sweep?.volume,
      "a fetch the reader had already moved past drew over the held box",
    ).toBe(`box:${boxes[0]}`);
  });

  it("measures a second file on its own disc, not on the first file's", async () => {
    // The station used to come off the sweep on screen. Opening a second file
    // leaves the first one there until the new answer lands, so the new file
    // was measured on the previous file's disc: the same intersection sliver
    // the first open avoids, moved to every open after it. It self-corrected
    // one decode later, which is a wrong picture and a wasted ten megabytes
    // per switch rather than a stuck state, and nothing could see it.
    pickArchiveFile.mockResolvedValue("C:/volumes/A_KTLX");
    fetchLocalSweep.mockImplementation(async (path, product, tilt) => ({
      ...sweepFor(path.includes("A_") ? "KTLX" : "KVNX", product, tilt),
      collected: "2013-05-20T20:56:00.000Z",
      source: { kind: "local", label: String(path), url: null },
    }));
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ zoom: 13 })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openLocal();
    });
    await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
    await waitFor(() =>
      expect(fetchLocalSweep.mock.calls.length).toBeGreaterThan(1),
    );
    // The first file is settled and boxed on its own disc, or what follows
    // proves nothing about which disc the second one used.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchLocalSweep.mock.calls.at(-1)![3]).toEqual(
      sweepDetailBox(DISCS.KTLX, [-93.7, 41.7], 13, 1440),
    );

    const before = fetchLocalSweep.mock.calls.length;
    pickArchiveFile.mockResolvedValue("C:/volumes/B_KVNX");
    await act(async () => {
      await result.current.openLocal();
    });
    await waitFor(() => expect(result.current.sweep?.station).toBe("KVNX"));

    // The ask that opened it carries nothing: this file's site is not known
    // yet, and the only disc in hand belongs to the file being replaced.
    expect(
      fetchLocalSweep.mock.calls[before][3],
      "the second file was asked for over the first file's box",
    ).toBeNull();

    // Then its own answer says where it reaches, and the next ask is measured
    // there. Against the box KVNX's disc gives for this camera, because both
    // discs contain the centre and a containment check passes on either.
    await waitFor(() =>
      expect(fetchLocalSweep.mock.calls.length).toBeGreaterThan(before + 1),
    );
    const second = fetchLocalSweep.mock.calls.at(-1)![3];
    expect(second).toEqual(sweepDetailBox(DISCS.KVNX, [-93.7, 41.7], 13, 1440));
    expect(second).not.toEqual(
      sweepDetailBox(DISCS.KTLX, [-93.7, 41.7], 13, 1440),
    );
  });

  it("boxes a file it has opened before without asking for the disc again", () => {
    // Keyed on the file currently open, going back to one seen a moment ago
    // was asked for unboxed all over again: a whole ten megabyte volume on
    // every switch back and forth, for a site whose reach was already known.
    // Nothing about the first file teaches anything the second time.
    return (async () => {
      pickArchiveFile.mockResolvedValue("C:/volumes/A_KTLX");
      fetchLocalSweep.mockImplementation(async (path, product, tilt) => ({
        ...sweepFor(path.includes("A_") ? "KTLX" : "KVNX", product, tilt),
        collected: "2013-05-20T20:56:00.000Z",
        source: { kind: "local", label: String(path), url: null },
      }));
      const { result } = renderHook(() =>
        useSingleSiteRadar(options({ zoom: 13 })),
      );
      await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

      await act(async () => {
        await result.current.openLocal();
      });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      pickArchiveFile.mockResolvedValue("C:/volumes/B_KVNX");
      await act(async () => {
        await result.current.openLocal();
      });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KVNX"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Back to the first file, whose site and reach are both known by now.
      const before = fetchLocalSweep.mock.calls.length;
      pickArchiveFile.mockResolvedValue("C:/volumes/A_KTLX");
      await act(async () => {
        await result.current.openLocal();
      });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));

      expect(
        fetchLocalSweep.mock.calls[before][3],
        "a file already seen was asked for over its whole disc again",
      ).toEqual(sweepDetailBox(DISCS.KTLX, [-93.7, 41.7], 13, 1440));
    })();
  });

  it("learns a file's site again when the file at that path has changed", () => {
    // The note was written once and never revisited, so a path whose file had
    // been replaced on disk with a volume from another station kept the old
    // station's disc for the life of the window: every ask measured on ground
    // it does not cover, with nothing to correct it.
    return (async () => {
      pickArchiveFile.mockResolvedValue("C:/volumes/same-name");
      fetchLocalSweep.mockImplementation(async (_path, product, tilt) => ({
        ...sweepFor("KTLX", product, tilt),
        collected: "2013-05-20T20:56:00.000Z",
        source: { kind: "local", label: "same-name", url: null },
      }));
      const { result } = renderHook(() =>
        useSingleSiteRadar(options({ zoom: 13 })),
      );
      await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
      await act(async () => {
        await result.current.openLocal();
      });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // The same path, a different volume behind it.
      fetchLocalSweep.mockImplementation(async (_path, product, tilt) => ({
        ...sweepFor("KVNX", product, tilt),
        collected: "2013-05-20T20:56:00.000Z",
        source: { kind: "local", label: "same-name", url: null },
      }));
      await act(async () => {
        await result.current.openLocal();
      });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KVNX"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      // It settles on the new site's own disc rather than the old one's.
      expect(
        fetchLocalSweep.mock.calls.at(-1)![3],
        "the file kept the disc of the volume that used to be at that path",
      ).toEqual(sweepDetailBox(DISCS.KVNX, [-93.7, 41.7], 13, 1440));
    })();
  });

  it("does not send one site's box to a file recorded at another", async () => {
    // The box is measured on the live station's disc. A file from disk carries
    // whatever site it was recorded at, and the native side clips the box to
    // that site's own disc, so a neighbour overlapping in both axes drew as a
    // sliver of the intersection rather than falling back to the whole disc.
    pickArchiveFile.mockResolvedValue("C:/volumes/KTLX20130520_205600");
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ zoom: 13 })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    // The control: an archived volume of the live site is on the same ground
    // and does get a box. Without this the null below would pass on a view
    // that had no box to leak in the first place.
    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() =>
      expect(fetchArchiveSweep.mock.calls.at(-1)![4]).not.toBeNull(),
    );

    await act(async () => {
      await result.current.openLocal();
    });
    expect(fetchLocalSweep).toHaveBeenCalled();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The first ask is unboxed, because nothing yet knows which site the file
    // holds: the box would have to come from the view's own station, and two
    // discs that overlap in both axes clip to a sliver of the intersection.
    expect(
      fetchLocalSweep.mock.calls[0][3],
      "a file from disk was asked for over another site's box",
    ).toBeNull();

    // Its answer carries its own corners, so the second ask is measured on
    // the file's own disc. Before this it was the one sweep in the app that
    // never followed the reader's zoom: 460 kilometres at 449 metres a pixel
    // however far in they went.
    await waitFor(() =>
      expect(fetchLocalSweep.mock.calls.length).toBeGreaterThan(1),
    );
    const boxed = fetchLocalSweep.mock.calls[1][3];
    expect(
      boxed,
      "the second ask should carry the file's own box",
    ).not.toBeNull();
    // KTLX's disc, not KDMX's, and said as the box that disc produces for
    // this camera rather than as a containment. The two discs overlap and
    // both contain the centre, so "inside KTLX" was true of the KDMX box as
    // well: the assertion that used to be here passed on the sliver it was
    // written to catch.
    expect(boxed).toEqual(sweepDetailBox(DISCS.KTLX, [-93.7, 41.7], 13, 1440));
    expect(boxed).not.toEqual(
      sweepDetailBox(DISCS.KDMX, [-93.7, 41.7], 13, 1440),
    );

    // And it settles: the boxed answer's corners are the box rather than the
    // disc, so recording them would walk the picture inwards a step at a time.
    const asked = fetchLocalSweep.mock.calls.length;
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchLocalSweep.mock.calls.length, "a third ask").toBe(asked);
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

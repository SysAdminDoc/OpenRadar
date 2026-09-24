import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import {
  LIVE_REFRESH_MS,
  SWEEP_REFRESH_MS,
  sweepDetailBox,
} from "../lib/level2";
import type { Level2ProductId, SweepImage } from "../lib/level2";
import { log } from "../lib/log";
import { providerHealth, resetHealth } from "../lib/providers/health";
import {
  armSingleSiteSpies,
  DISCS,
  longRange,
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
      fetchArchiveSweep(args[0], args[1], args[2], args[3], args[9]),
    fetchLocalSweep: (...args: Parameters<typeof actual.fetchLocalSweep>) =>
      fetchLocalSweep(args[0], args[1], args[2], args[8]),
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

describe("choosing a site", () => {
  it("counts a failing live feed per station, not across them", async () => {
    // One record serves the Diagnostics row, and letting it count for itself
    // meant the run belonged to whatever the reader last looked at. KDMX
    // failing once then KTLX failing once said "KTLX ... 2 times running",
    // which is a false sentence in the line a reader copies into a bug
    // report. A healthy site also zeroed a failing one's run, so a feed down
    // for hours never reached a second failure if the reader kept stepping
    // away and back.
    resetHealth();
    const warned: string[] = [];
    const warn = vi.spyOn(log, "warn").mockImplementation((_area, line) => {
      warned.push(String(line));
    });
    try {
      fetchSweep.mockImplementation(async (station, product, tilt) => ({
        ...sweepFor(station.toUpperCase(), product, tilt),
        liveFailed: `${station.toUpperCase()} chunk bucket refused`,
      }));
      const { result, rerender } = renderHook(
        (props: { station: string }) =>
          useSingleSiteRadar(
            options({ radar: { live: true, station: props.station } }),
          ),
        { initialProps: { station: "KDMX" } },
      );
      await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

      // A different site, failing once. Its own first failure, not a second.
      rerender({ station: "KTLX" });
      await waitFor(() => expect(result.current.sweep?.station).toBe("KTLX"));
      expect(
        warned.filter((line) => line.includes("times running")),
        "a station was blamed for another station's failure",
      ).toEqual([]);
      expect(
        providerHealth().find((one) => one.id === "level2")
          ?.consecutiveFailures,
      ).toBe(1);

      // Back to the first, whose own run resumes and reaches two.
      rerender({ station: "KDMX" });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")
            ?.consecutiveFailures,
        ).toBe(2),
      );
      const said = warned.filter((line) => line.includes("times running"));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("KDMX");
      expect(said[0]).toContain("2 times running");
    } finally {
      warn.mockRestore();
      resetHealth();
    }
  });

  it("counts the ask failing outright, on the same run", async () => {
    // A volume in progress that could not be read reached the Diagnostics
    // row; the command failing outright reached the log and the map and
    // nothing else. So the worse of the two failures left the Level II source
    // saying it had answered a minute ago, which is the row a reader copies
    // into a bug report.
    resetHealth();
    const warned: string[] = [];
    const warn = vi.spyOn(log, "warn").mockImplementation((_area, line) => {
      warned.push(String(line));
    });
    try {
      fetchSweep.mockRejectedValue(
        new Error("the Level II host refused the connection"),
      );
      const { result, rerender } = renderHook(
        (props: { tilt: number }) =>
          useSingleSiteRadar(
            options({ radar: { tilt: props.tilt, live: true } }),
          ),
        { initialProps: { tilt: 0 } },
      );
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")?.lastError,
        ).toBe("the Level II host refused the connection"),
      );
      expect(result.current.sweep).toBeNull();
      expect(
        providerHealth().find((one) => one.id === "level2")
          ?.consecutiveFailures,
      ).toBe(1);
      // One line about it, not two: this path already wrote its own.
      expect(
        warned.filter((line) => line.includes("refused the connection")),
      ).toHaveLength(1);

      // The two kinds of failure are one run. A feed that alternates between
      // refusing the ask and answering with a volume it could not read is not
      // recovering between them.
      fetchSweep.mockImplementation(async (station, product, tilt) => ({
        ...sweepFor(station.toUpperCase(), product, tilt),
        liveFailed: "the chunk bucket refused the connection",
      }));
      rerender({ tilt: 1 });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")
            ?.consecutiveFailures,
        ).toBe(2),
      );
    } finally {
      warn.mockRestore();
      resetHealth();
    }
  });

  it("holds a terminal radar and draws its sweep", async () => {
    // The harness could hold one and never got a picture for it: the disc
    // table had no entry, the fixture threw on the spread, and every case
    // about a terminal radar was green without the live path ever running its
    // body.
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ radar: { live: true, station: "TATL" } })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("TATL"));
    expect(result.current.sweep?.radar).toBe("TDWR");
    // Its own reach, which is what makes it a different instrument.
    expect(result.current.sweep?.rangeKm).toBeLessThan(100);
    // And what it says about itself, which a fixture written the other way
    // round left saying Level II: the object literal after the branch won,
    // so the branch's own source was never read. These two hold the fixture
    // rather than the hook, which passes both fields straight through: what
    // they catch is this harness drifting from what the native side really
    // writes, which is what made every other case here mean nothing.
    expect(result.current.sweep?.source.label).toContain("Level III");
    expect(result.current.sweep?.siteName).toBe("Atlanta, GA");
  });

  it("saves the object the picture was decoded from, by its own name", async () => {
    // A picture, a CSV and a GeoTIFF are all this app's account of the volume.
    // The volume is what another tool reopens, and it was the one thing a
    // reader who had found the sweep that matters could not keep.
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ radar: { station: "KDMX" } })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    const save = result.current.saveVolume;
    expect(save, "no way to save the volume on screen").not.toBeNull();
    await act(async () => {
      await save?.();
    });
    // The key off the sweep on screen rather than the station and a moment:
    // asked for again a minute later, "the newest volume at KDMX" can be a
    // different file, and a copy of a volume that is not the one being looked
    // at is the whole of what this has to rule out.
    expect(exportVolumeFile).toHaveBeenCalledWith({
      station: "KDMX",
      volume: result.current.sweep?.volume,
    });
  });

  it("saves a terminal radar's product the same way", async () => {
    // It publishes a Level III product rather than a volume, and the object
    // is just as much the thing a case study is reopened from.
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ radar: { live: true, station: "TATL" } })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("TATL"));
    await act(async () => {
      await result.current.saveVolume?.();
    });
    expect(exportVolumeFile).toHaveBeenCalledWith({
      station: "TATL",
      volume: result.current.sweep?.volume,
    });
  });

  it("does not offer to save the volume the radar is sweeping now", async () => {
    // A live picture is two volumes: the one being swept, drawn over the last
    // finished one. The newer half arrives as chunks under a numbered folder
    // rather than as an object, so its key is `114` and there is no single
    // file to hand over. Offered anyway, the button asked the native side for
    // a volume called `114` and came back refused, every time.
    fetchSweep.mockImplementation(async (station, product, tilt, live) => ({
      ...sweepFor(station, product, tilt),
      live,
      liveTilts: live ? 3 : 0,
      volume: live ? "114" : `${station}-${product}-${tilt}`,
    }));
    const { result, rerender } = renderHook(
      (props: { live: boolean }) =>
        useSingleSiteRadar(
          options({ radar: { live: props.live, station: "KDMX" } }),
        ),
      { initialProps: { live: true } },
    );
    await waitFor(() => expect(result.current.sweep?.live).toBe(true));
    expect(result.current.saveVolume).toBeNull();

    // The control, through the same path: the same site with the composite
    // off is one finished volume, and it is offered.
    rerender({ live: false });
    await waitFor(() => expect(result.current.sweep?.live).toBe(false));
    await act(async () => {
      await result.current.saveVolume?.();
    });
    expect(exportVolumeFile).toHaveBeenCalledTimes(1);
  });

  it("does not offer to save a file the reader opened themselves", async () => {
    // Its key is a hash of the bytes rather than a bucket object, and they
    // have the file already: there is nothing to fetch and nowhere to fetch
    // it from.
    pickArchiveFile.mockResolvedValue("C:/storms/KDMX20260830_092159_V06");
    fetchLocalSweep.mockImplementation(async () => ({
      ...sweepFor("KDMX", "reflectivity", 0),
      volume: "local:0123456789abcdef",
      source: { kind: "local" as const, label: "a file", url: null },
    }));
    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ radar: { station: "KDMX" } })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    // The control: a fetched volume is offered, so what the assertion below
    // reads is the file rather than the guard never being reached. Called
    // rather than compared against null, which `undefined` also satisfies:
    // deleting the property outright left the first version of this green.
    await act(async () => {
      await result.current.saveVolume?.();
    });
    expect(exportVolumeFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.openLocal();
    });
    await waitFor(() => expect(result.current.mode).toBe("local"));
    expect(result.current.saveVolume).toBeNull();
  });

  it("offers a terminal radar none of the things it has no volume for", async () => {
    // Three more places read the same question and none of them was covered:
    // a terminal radar has no Level II archive to list a loop from, no volume
    // to cut a cross-section through, and no gates to write out as values.
    // All three survived having their guard removed against the whole suite,
    // which is the same hole the case above was filed for wearing a different
    // hat.
    const { result, rerender } = renderHook(
      (props: { station: string }) =>
        useSingleSiteRadar(
          options({ radar: { live: true, station: props.station } }),
        ),
      { initialProps: { station: "TATL" } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("TATL"));
    expect(result.current.crossSection).toBeNull();
    // And nothing was asked of the archive listing, which is what the loop
    // would be built from.
    expect(recentVolumeTimes).not.toHaveBeenCalled();

    // The control, through the same path: a site that does have a volume is
    // offered the cut and does have its loop listed. Writing the gates out is
    // not among them here, because that one is a desktop command and this
    // harness is a browser.
    rerender({ station: "KDMX" });
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    expect(result.current.crossSection).not.toBeNull();
    await waitFor(() => expect(recentVolumeTimes).toHaveBeenCalled());
  });

  it("says nothing about the Level II feed for a radar that has none", async () => {
    // A terminal radar has no chunk feed. Its sweep carries no failure by
    // construction, so recording a success for it claimed the Level II bucket
    // had answered when it was never asked. Deleted on 2026-09-09 rather than
    // shipped vacuous, because it passed with the guard removed: nothing ever
    // reached the block it guards.
    resetHealth();
    try {
      const { result, rerender } = renderHook(
        (props: { station: string }) =>
          useSingleSiteRadar(
            options({ radar: { live: true, station: props.station } }),
          ),
        { initialProps: { station: "TATL" } },
      );
      // Waiting for the sweep is what keeps this honest, and it is the whole
      // of it: without this line the case passes against a build with the
      // guard taken out, because nothing has reached the block the guard is
      // on by the time the assertion runs. It is not a step towards the
      // assertion below; it is the assertion's own precondition.
      await waitFor(() => expect(result.current.sweep?.station).toBe("TATL"));
      expect(
        providerHealth().find((one) => one.id === "level2"),
        "a terminal radar answered for the Level II feed",
      ).toBeUndefined();

      // The positive control, through the same path: a site that does have
      // one still reaches the row.
      rerender({ station: "KDMX" });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2"),
        ).toBeTruthy(),
      );
    } finally {
      resetHealth();
    }
  });

  it("does not blame the feed for an ask it cannot satisfy", async () => {
    // Every failure comes back through the same catch, including the ones
    // that are not about the source at all: a tilt the site's VCP does not
    // have, a file over the size limit, a station that is not a NEXRAD. The
    // source answered perfectly in all three, and marking it as failing puts
    // a wrong sentence in the row a reader copies into a bug report and in
    // the incident ring behind it.
    resetHealth();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    try {
      fetchSweep.mockRejectedValue({
        code: "noSweep",
        args: ["KDMX", "Velocity"],
      });
      const { result, rerender } = renderHook(
        (props: { tilt: number }) =>
          useSingleSiteRadar(
            options({ radar: { tilt: props.tilt, live: true } }),
          ),
        { initialProps: { tilt: 0 } },
      );
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(
        providerHealth().find((one) => one.id === "level2"),
        "the feed was blamed for a tilt the site does not sweep",
      ).toBeUndefined();

      // The positive control, through the same path: a source that really
      // did not answer still reaches the row.
      fetchSweep.mockRejectedValue({ code: "httpUnreachable", args: [] });
      rerender({ tilt: 1 });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")
            ?.consecutiveFailures,
        ).toBe(1),
      );

      // And a site that has published nothing for a day, which is a radar off
      // air for maintenance rather than a feed that cannot be reached. It was
      // read as the feed for one commit, on reasoning about a listing that
      // swallows failed days; that listing is the loop-times command and
      // records nothing, while this path propagates its failures and so meets
      // a real outage as a refused connection. A three-day upgrade would have
      // turned the Level II row red with the feed answering perfectly.
      fetchSweep.mockRejectedValue({ code: "noVolume", args: ["KDMX"] });
      rerender({ tilt: 2 });
      await waitFor(() => expect(result.current.error).toContain("KDMX"));
      expect(
        providerHealth().find((one) => one.id === "level2")
          ?.consecutiveFailures,
      ).toBe(1);
    } finally {
      warn.mockRestore();
      resetHealth();
    }
  });

  it("counts a live feed that keeps failing, and says so on the second", async () => {
    // The picture is the last finished volume whether the site is between
    // volumes or its chunks cannot be reached at all, and the age beside the
    // sweep reads the same either way. The reason used to reach a debug line
    // in the native log and nothing a reader could open, so a feed that had
    // been down for hours looked exactly like one that was briefly behind.
    resetHealth();
    const warned: string[] = [];
    const warn = vi.spyOn(log, "warn").mockImplementation((_area, line) => {
      warned.push(String(line));
    });
    try {
      fetchSweep.mockImplementation(async (station, product, tilt) => ({
        ...sweepFor(station.toUpperCase(), product, tilt),
        liveFailed: "the chunk bucket refused the connection",
      }));
      const { result, rerender } = renderHook(
        (props: { tilt: number }) =>
          useSingleSiteRadar(
            options({ radar: { tilt: props.tilt, live: true } }),
          ),
        { initialProps: { tilt: 0 } },
      );
      await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

      // One failure is ordinary and says nothing.
      expect(
        providerHealth().find((one) => one.id === "level2")
          ?.consecutiveFailures,
      ).toBe(1);
      expect(warned.filter((line) => line.includes("times running"))).toEqual(
        [],
      );

      // A second in a row is a run, and that is what reaches the log.
      rerender({ tilt: 1 });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")
            ?.consecutiveFailures,
        ).toBe(2),
      );
      const said = warned.filter((line) => line.includes("times running"));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain("the chunk bucket refused the connection");

      // And the row Diagnostics reads carries the reason and the count.
      const record = providerHealth().find((one) => one.id === "level2");
      expect(record?.lastError).toBe("the chunk bucket refused the connection");

      // A live volume that reads clears it, so a site that recovers stops
      // being described as failing.
      fetchSweep.mockImplementation(async (station, product, tilt) =>
        sweepFor(station.toUpperCase(), product, tilt),
      );
      rerender({ tilt: 2 });
      await waitFor(() =>
        expect(
          providerHealth().find((one) => one.id === "level2")
            ?.consecutiveFailures,
        ).toBe(0),
      );
      expect(
        providerHealth().find((one) => one.id === "level2")?.lastError,
      ).toBeNull();
    } finally {
      warn.mockRestore();
      resetHealth();
    }
  });

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

  it("measures each terminal product against its own disc", async () => {
    // A terminal radar has two reaches: 88.8 kilometres in 150 metre bins for
    // its base products and 417 in 300 metre ones for the long range one. The
    // record that says how far the box may narrow held one entry per station,
    // so whichever product loaded first lent its ground to the other. The
    // long range product measured against the base disc stopped four steps
    // in where it has bins for thirty-two, and a base product measured
    // against the long range disc went to a sixty-fourth of ground it was not
    // being drawn over, which is four times deeper than the fixed sixteenth
    // this whole rule replaced.
    const base = String(sweepDetailBox(DISCS.TATL, [-84.26, 33.65], 13, 1440));
    const long = String(
      sweepDetailBox(
        { ...DISCS.TATL, ...longRange("TATL"), rangeKm: 417, gateKm: 0.3 },
        [-84.26, 33.65],
        13,
        1440,
      ),
    );
    fetchArchiveSweep.mockImplementation(
      async (station, _at, product, tilt, within) => ({
        ...sweepFor(station, product, tilt),
        volume: `box:${String(within)}`,
        collected: "2021-12-10T03:15:00.000Z",
        source: {
          kind: "archive" as const,
          label: "NOAA NEXRAD Level III (TDWR)",
          url: null,
        },
      }),
    );

    // The long range product first, so its disc is the one in hand.
    const { result, rerender } = renderHook(
      (props: { product: Level2ProductId }) =>
        useSingleSiteRadar(
          options({
            center: [-84.26, 33.65],
            zoom: 13,
            radar: { station: "TATL", product: props.product, live: false },
          }),
        ),
      {
        initialProps: {
          product: "long-range-reflectivity" as Level2ProductId,
        },
      },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("TATL"));
    await act(async () => {
      await result.current.openArchive("tatl", "2021-12-10T03:15:00.000Z");
    });
    await waitFor(() =>
      expect(result.current.sweep?.volume, "the long range product").toBe(
        `box:${long}`,
      ),
    );

    // And back to a base product, which must be measured on 88.8 kilometres
    // and not on the 417 still in the record.
    rerender({ product: "reflectivity" });
    await waitFor(() =>
      expect(result.current.sweep?.volume, "a base product").toBe(
        `box:${base}`,
      ),
    );
  });

  it("narrows to the gate on screen, not the one that arrived first", async () => {
    // How far the box may narrow is now read off the sweep rather than taken
    // as a share of the disc, which means it is a property of the moment and
    // not of the site: an archive volume from before super resolution carries
    // its reflectivity on kilometre gates and its velocity on quarter
    // kilometre ones. The site's reach is learned once, from the one answer
    // that covered the whole disc. The gate cannot be, or a reader who
    // switched product would keep whichever ceiling happened to land first.
    let gateKm = 1;
    fetchSweep.mockImplementation(async (station, product, tilt) => ({
      ...sweepFor(station, product, tilt),
      gateKm,
    }));
    fetchArchiveSweep.mockImplementation(
      async (station, _at, product, tilt, within) => ({
        ...sweepFor(station, product, tilt),
        gateKm,
        // Which box this picture was drawn for, so the assertion names the
        // one on screen rather than counting calls.
        volume: `box:${String(within)}`,
        collected: "2021-12-10T03:15:00.000Z",
        source: {
          kind: "archive" as const,
          label: "NOAA NEXRAD Level II archive",
          url: null,
        },
      }),
    );

    const at: [number, number] = [-93.7, 41.7];
    const coarse = String(
      sweepDetailBox({ ...DISCS.KDMX, gateKm: 1 }, at, 13, 1440),
    );
    const fine = String(
      sweepDetailBox({ ...DISCS.KDMX, gateKm: 0.25 }, at, 13, 1440),
    );
    // A quarter of the disc against a sixteenth. Without this the two boxes
    // could be equal and the case would pass on nothing.
    expect(coarse).not.toBe(fine);

    const { result } = renderHook(() =>
      useSingleSiteRadar(options({ center: at, zoom: 13 })),
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:15:00.000Z");
    });
    // Kilometre gates, so four steps and no more.
    await waitFor(() =>
      expect(result.current.sweep?.volume).toBe(`box:${coarse}`),
    );

    // The same site, the same camera, a moment on quarter kilometre gates.
    gateKm = 0.25;
    await act(async () => {
      await result.current.openArchive("kdmx", "2021-12-10T03:16:00.000Z");
    });
    await waitFor(() =>
      expect(result.current.sweep?.volume).toBe(`box:${fine}`),
    );
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
            // Zoomed in far enough that a box is asked for at all. The suite
            // default is below the threshold, so with it this case ran on a
            // view that had no box to re-ask for and proved nothing about the
            // grid: "no second request" was true because there was never a
            // first one.
            zoom: 12,
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
    // Arriving costs two: the whole disc, which says where the site reaches,
    // and then the box measured on it. Both belong to the arrival, and what
    // this case is about is that panning adds nothing to them.
    await waitFor(() => expect(fetchSweep.mock.calls.length).toBe(2));
    const arrived = fetchSweep.mock.calls.length;

    // Inside one cell of the coarse grid the site is resolved on, so nothing
    // about which site to read has changed.
    rerender({ center: [-93.71, 41.71] });
    rerender({ center: [-93.72, 41.72] });
    rerender({ center: [-93.73, 41.73] });

    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    expect(fetchSweep).toHaveBeenCalledTimes(arrived);
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

  it("keeps the loop volume a reader keeps returning to", async () => {
    // The same defect `AUD-454` fixed in the historical hold, in the map the
    // loop uses. `trimHeld` sheds by insertion order and a `Map` read does
    // not reorder, so a reader working between two volumes lost the two they
    // were using. This map also answers `arrivedAt`, which the export caption
    // reads, so an eviction took the arrival time out of the written record
    // as well as costing the fetch.
    //
    // The hold is bounded at twice the loop length, so a loop of one keeps
    // two: three distinct boxes are enough to make it shed.
    const base = {
      ...options({
        zoom: 12,
        showingTime: VOLUMES[0] + 60_000,
        radar: { loopVolumes: 1 },
      }),
    };
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      { initialProps: { ...base, center: [-96.2, 41.7] as [number, number] } },
    );
    await waitFor(() => expect(result.current.drawnVolume).toBe(VOLUMES[0]));

    const visit = async (at: [number, number]) => {
      rerender({ ...base, center: at });
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    };
    const asks = () => fetchArchiveSweep.mock.calls.length;

    // A second box, then back to the first, which is the touch that has to
    // move it to the front of the queue.
    const beforeSecond = asks();
    await visit([-95.4, 41.7]);
    expect(asks(), "the second box was not a fetch of its own").toBeGreaterThan(
      beforeSecond,
    );
    const beforeBack = asks();
    await visit([-96.2, 41.7]);
    expect(asks(), "the first box was never held").toBe(beforeBack);

    // A third box, which pushes one entry out of a hold that keeps two.
    await visit([-94.7, 41.7]);

    // The one just used must be the one still there, and its arrival time
    // must have survived with it.
    const beforeLast = asks();
    await visit([-96.2, 41.7]);
    expect(asks(), "the volume in use was the volume evicted").toBe(beforeLast);
    expect(
      result.current.arrivedAt(VOLUMES[0]),
      "the arrival time went with the eviction",
    ).not.toBeNull();
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

  it("times a volume from when its picture arrived, not when it was listed", async () => {
    // The newest volume is noted the moment the listing names it, with no
    // picture yet, and a pane can fetch that same volume much later. Carrying
    // the listing time onto the picture made `useExport` write a cache age
    // for bytes that had just come off the network: it reports one for
    // anything that arrived before the walk began, and the record's own type
    // says a cache age means the disk served it. A delivery time a few
    // seconds late is a smaller wrong answer than a cache hit that never
    // happened.
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useSingleSiteRadar>[0]) =>
        useSingleSiteRadar(props),
      { initialProps: options({}) },
    );
    await waitFor(() =>
      expect(result.current.arrivedAt(VOLUMES[2])).not.toBeNull(),
    );
    const listed = result.current.arrivedAt(VOLUMES[2])!;

    // Long enough that a wrong answer cannot be mistaken for a right one.
    await new Promise((done) => setTimeout(done, 25));
    rerender(options({ compareTime: VOLUMES[2] }));
    await waitFor(() => expect(result.current.compare.sweep).not.toBeNull());
    expect(
      result.current.arrivedAt(VOLUMES[2]),
      "the picture was stamped with the moment the listing named it",
    ).toBeGreaterThan(listed);
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

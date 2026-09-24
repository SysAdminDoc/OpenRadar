import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import type { Level2ProductId, SweepImage } from "../lib/level2";
import { armSingleSiteSpies, options, type Box } from "../test/singleSite";

/**
 * The echo mask reaches every sweep the hook asks for.
 *
 * A review switched each request's mask argument to `false` in turn, and to
 * nothing in the historical request key, and every test stayed green: the
 * suites' mocks pass on only the arguments they are about. These keep the
 * one they drop.
 */

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

/** Which command was asked, and whether it was asked to mask. */
const asked: Array<[string, unknown]> = [];

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
    fetchSweep: (...args: Parameters<typeof actual.fetchSweep>) => {
      asked.push(["live", args[11]]);
      return fetchSweep(args[0], args[1], args[2], args[6]);
    },
    fetchArchiveSweep: (
      ...args: Parameters<typeof actual.fetchArchiveSweep>
    ) => {
      asked.push(["archive", args[8]]);
      return fetchArchiveSweep(args[0], args[1], args[2], args[3], args[9]);
    },
    fetchLocalSweep: (...args: Parameters<typeof actual.fetchLocalSweep>) => {
      asked.push(["local", args[7]]);
      return fetchLocalSweep(args[0], args[1], args[2], args[8]);
    },
    pickArchiveFile: () => pickArchiveFile(),
    recentVolumeTimes: (station: string, count: number) =>
      recentVolumeTimes(station, count),
  };
});

beforeEach(() => {
  asked.length = 0;
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
});

function lastAsked(command: string): unknown {
  return asked.filter(([named]) => named === command).at(-1)?.[1];
}

describe("the echo mask on every sweep the hook asks for", () => {
  it("asks the live sweep for it, and asks again when it changes", async () => {
    const { result, rerender } = renderHook(
      (props: { echoMask: boolean }) =>
        useSingleSiteRadar(options({ radar: { echoMask: props.echoMask } })),
      { initialProps: { echoMask: true } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));
    expect(lastAsked("live")).toBe(true);
    rerender({ echoMask: false });
    await waitFor(() => expect(lastAsked("live")).toBe(false));
  });

  it("asks an archived volume and a local file for it too", async () => {
    pickArchiveFile.mockResolvedValue("C:\\radar\\KTLX20130520_205600_V06");
    const { result, rerender } = renderHook(
      (props: { echoMask: boolean }) =>
        useSingleSiteRadar(options({ radar: { echoMask: props.echoMask } })),
      { initialProps: { echoMask: true } },
    );
    await waitFor(() => expect(result.current.sweep?.station).toBe("KDMX"));

    await act(async () => {
      await result.current.openArchive("ktlx", "2013-05-20T20:56:00.000Z");
    });
    expect(lastAsked("archive")).toBe(true);
    // The request key carries it, so turning it off redraws the volume open
    // now rather than serving the masked one back.
    rerender({ echoMask: false });
    await waitFor(() => expect(lastAsked("archive")).toBe(false));

    rerender({ echoMask: true });
    await act(async () => {
      await result.current.openLocal();
    });
    expect(lastAsked("local")).toBe(true);
  });
});

describe("every request in the hooks passes it on", () => {
  // The scrubber and the compare pane ask for archived volumes from their own
  // effects, which a case above cannot reach without building the whole
  // loop. So every call site is read: each one names the mask, or spreads an
  // argument list that does.
  it("names the mask at every call", () => {
    const files = ["useSingleSiteRadar.ts", "useHistoricalSweep.ts"].map(
      (name) => readFileSync(join(process.cwd(), "src", "hooks", name), "utf8"),
    );
    let calls = 0;
    for (const source of files) {
      for (const found of source.matchAll(
        /\b(fetchSweep|fetchArchiveSweep|fetchLocalSweep)\(/g,
      )) {
        // The argument list, to the bracket that closes the call.
        let depth = 0;
        let at = (found.index ?? 0) + found[0].length - 1;
        const start = at;
        for (; at < source.length; at += 1) {
          if (source[at] === "(") depth += 1;
          if (source[at] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        const args = source.slice(start, at + 1);
        calls += 1;
        const spread = /\.\.\.(\w+)/.exec(args)?.[1];
        const listed = spread
          ? new RegExp(
              `const ${spread} = \\[[^\\]]*\\bechoMask\\b[^\\]]*\\]`,
            ).test(source)
          : false;
        expect(
          /echoMask/.test(args) || listed,
          `${found[1]}${args.slice(0, 80)}`,
        ).toBe(true);
      }
    }
    // Three in the single-site hook (the live sweep, the scrubber and the
    // compare pane) and two in the historical one, found rather than assumed.
    expect(calls).toBeGreaterThanOrEqual(5);
  });
});

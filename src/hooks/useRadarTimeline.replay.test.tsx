import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRadarTimeline, type ArchiveReplay } from "./useRadarTimeline";
import type { RadarFrame } from "../lib/radar";

const REFRESH_MS = 5 * 60_000;

function frame(time: number, providerId: RadarFrame["providerId"]): RadarFrame {
  return {
    providerId,
    time,
    tileUrl: `https://example.test/${providerId}/${time}/{z}/{x}/{y}.png`,
    tileSize: 256,
    maxZoom: 10,
    attribution: "test",
  };
}

const NOW = 1_788_083_202;
const LANDFALL = 1_664_391_900;

const replay: ArchiveReplay = {
  id: "AL092022",
  label: "Iowa State radar archive",
  attributionUrl: "https://mesonet.agron.iastate.edu/",
  // Twenty-five quarter-hour frames either side of the landfall.
  frames: Array.from({ length: 25 }, (_, index) =>
    frame(LANDFALL - 12 * 900 + index * 900, "archive"),
  ),
  focusTime: LANDFALL,
};

let served = 0;

vi.mock("../lib/providers", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/providers")>(
      "../lib/providers",
    );
  return {
    ...actual,
    fetchRadarTimeline: vi.fn(async () => {
      // Each refresh publishes a newer live loop, which is what a real one does.
      served += 1;
      return {
        provider: {
          id: "ridge" as const,
          label: "NWS RIDGE II",
          detail: "test",
          attribution: "test",
          attributionUrl: "https://example.test/",
          coverage: [],
          tileBudgetLimit: 1,
          discoveryBudgetLimit: 1,
          budgetWindowMs: 1,
          host: "example.test",
          fetchFrames: async () => [],
        },
        frames: [0, 1, 2].map((step) =>
          frame(NOW + served * 120 + step * 120, "ridge"),
        ),
      };
    }),
    fetchHrrrRun: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
});

beforeEach(() => {
  served = 0;
  // jsdom has no matchMedia, and the hook asks it whether to autoplay.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  // Vitest clears mocks between tests on its own since 5.0.
});

function options(archive: ArchiveReplay | null) {
  return {
    ready: true,
    center: [-93.7, 41.7] as [number, number],
    loopMinutes: 120,
    animationSpeed: -0.1,
    futureRadar: false,
    pageVisible: true,
    archive,
  };
}

describe("a replay and the live loop at the same time", () => {
  it("keeps the frame the viewer scrubbed to when the live loop refreshes", async () => {
    const { result } = renderHook(() => useRadarTimeline(options(replay)));

    await waitFor(() => expect(result.current.frames).toHaveLength(25));
    act(() => result.current.setPlaying(false));

    // Scrub to the start of the replay, three hours before landfall.
    act(() => result.current.selectFrame(0));
    expect(result.current.frameIndex).toBe(0);

    // Five minutes pass and the live loop refreshes behind the replay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 1_000);
    });

    expect(served).toBeGreaterThan(1);
    // Still where the viewer left it, not thrown back to the landfall.
    expect(result.current.frameIndex).toBe(0);
    expect(result.current.frames[result.current.frameIndex].time).toBe(
      replay.frames[0].time,
    );
  });

  it("starts a replay on the moment it is about", async () => {
    const { result } = renderHook(() => useRadarTimeline(options(replay)));
    await waitFor(() => expect(result.current.frames).toHaveLength(25));
    act(() => result.current.setPlaying(false));
    // The focus frame is the thirteenth of twenty-five.
    expect(result.current.frames[result.current.frameIndex].time).toBe(
      LANDFALL,
    );
    expect(result.current.sourceLabel).toBe("Iowa State radar archive");
  });

  it("hands the playhead back to the newest live frame when the replay ends", async () => {
    const { result, rerender } = renderHook(
      ({ archive }: { archive: ArchiveReplay | null }) =>
        useRadarTimeline(options(archive)),
      { initialProps: { archive: replay as ArchiveReplay | null } },
    );

    await waitFor(() => expect(result.current.frames).toHaveLength(25));
    act(() => result.current.setPlaying(false));
    act(() => result.current.selectFrame(3));

    rerender({ archive: null });
    await waitFor(() => expect(result.current.frames).toHaveLength(3));
    // The newest live frame, not the oldest one nearest the archive time.
    expect(result.current.frameIndex).toBe(2);
    expect(result.current.sourceLabel).toBe("NWS RIDGE II");
  });
});

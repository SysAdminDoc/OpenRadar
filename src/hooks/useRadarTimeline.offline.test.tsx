import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRadarTimeline } from "./useRadarTimeline";
import type { RadarFrame } from "../lib/radar";

const NOW = 1_788_083_202;
const REFRESH_MS = 5 * 60_000;

function frame(time: number): RadarFrame {
  return {
    providerId: "ridge",
    time,
    tileUrl: `https://example.test/${time}/{z}/{x}/{y}.png`,
    tileSize: 256,
    maxZoom: 10,
    attribution: "test",
  };
}

const provider = {
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
};

/** Flipped by each test to say what the next refresh should do. */
let refreshFails = false;

vi.mock("../lib/providers", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/providers")>(
      "../lib/providers",
    );
  return {
    ...actual,
    fetchRadarTimeline: vi.fn(async () => {
      if (refreshFails) throw new Error("The radar service is unreachable.");
      return { provider, frames: [0, 1, 2].map((step) => frame(NOW + step)) };
    }),
    fetchHrrrRun: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
});

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(() => {
  refreshFails = false;
  setOnline(true);
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
  vi.clearAllMocks();
});

const options = {
  ready: true,
  center: [-93.7, 41.7] as [number, number],
  loopMinutes: 120,
  animationSpeed: -0.1,
  futureRadar: false,
  pageVisible: true,
};

describe("a loop with no network behind it", () => {
  it("keeps the frames it has and says they are not live", async () => {
    const { result } = renderHook(() => useRadarTimeline(options));
    await waitFor(() => expect(result.current.frames).toHaveLength(3));
    expect(result.current.cached).toBe(false);

    // The service goes away while the machine still believes it has a
    // network, which is what a captive portal or a dead provider looks like.
    // What is on screen came from somewhere and is still worth showing;
    // replacing it with an error message is worse.
    refreshFails = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
    });

    await waitFor(() => expect(result.current.cached).toBe(true));
    expect(result.current.frames).toHaveLength(3);
    expect(result.current.error).toBeNull();

    // And a refresh that works again puts it back on live.
    refreshFails = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 1);
    });
    await waitFor(() => expect(result.current.cached).toBe(false));
  });

  it("says so while offline even when nothing has failed yet", async () => {
    const { result } = renderHook(() => useRadarTimeline(options));
    await waitFor(() => expect(result.current.frames).toHaveLength(3));

    // Every tile under this loop is now coming off the disk, whether or not a
    // refresh has had the chance to fail.
    act(() => setOnline(false));
    expect(result.current.cached).toBe(true);

    act(() => setOnline(true));
    expect(result.current.cached).toBe(false);
  });

  it("says nothing is there when nothing ever arrived", async () => {
    refreshFails = true;
    const { result } = renderHook(() => useRadarTimeline(options));
    await waitFor(() =>
      expect(result.current.error).toBe("Radar temporarily unavailable"),
    );
    // Nothing was ever drawn, so there is no last view to offer.
    expect(result.current.frames).toHaveLength(0);
    expect(result.current.cached).toBe(false);
  });
});

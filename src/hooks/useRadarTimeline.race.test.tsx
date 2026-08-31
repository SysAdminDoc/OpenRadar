import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarFrame } from "../lib/radar";
import type { RadarTimeline } from "../lib/providers";
import { useRadarTimeline } from "./useRadarTimeline";

const mocks = vi.hoisted(() => ({
  fetchRadarTimeline: vi.fn<() => Promise<RadarTimeline>>(),
}));

vi.mock("../lib/providers", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/providers")>(
      "../lib/providers",
    );
  return {
    ...actual,
    fetchRadarTimeline: mocks.fetchRadarTimeline,
    fetchHrrrRun: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
});

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

function timeline(time: number): RadarTimeline {
  const frame: RadarFrame = {
    providerId: "ridge",
    time,
    tileUrl: `https://example.test/${time}/{z}/{x}/{y}.png`,
    tileSize: 256,
    maxZoom: 10,
    attribution: "test",
  };
  return { provider, frames: [frame], cachedAgeSeconds: null };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(() => {
  mocks.fetchRadarTimeline.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  setOnline(true);
});

afterEach(() => cleanup());

describe("overlapping radar refreshes", () => {
  it("keeps the result from the newest request", async () => {
    let finishOld: ((value: RadarTimeline) => void) | null = null;
    let finishNew: ((value: RadarTimeline) => void) | null = null;
    mocks.fetchRadarTimeline
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishNew = resolve;
        }),
      );

    const { result } = renderHook(() =>
      useRadarTimeline({
        ready: true,
        center: [-96.8, 32.78],
        loopMinutes: 120,
        animationSpeed: 1,
        futureRadar: false,
        pageVisible: false,
      }),
    );
    await waitFor(() =>
      expect(mocks.fetchRadarTimeline).toHaveBeenCalledTimes(1),
    );

    act(() => setOnline(false));
    act(() => setOnline(true));
    await waitFor(() =>
      expect(mocks.fetchRadarTimeline).toHaveBeenCalledTimes(2),
    );

    await act(async () => finishNew!(timeline(200)));
    await waitFor(() => expect(result.current.frames[0]?.time).toBe(200));
    await act(async () => finishOld!(timeline(100)));
    expect(result.current.frames[0]?.time).toBe(200);
  });
});

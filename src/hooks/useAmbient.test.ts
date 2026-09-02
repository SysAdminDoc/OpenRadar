import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAmbient } from "./useAmbient";
import { metarOverlay } from "../lib/overlays/metar";

const HOME: [number, number] = [-96.8, 32.78];

function reporting(raw: string, minutesAgo: number, now: number) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: HOME },
        properties: {
          id: "KAMB",
          raw,
          observed: Math.floor((now - minutesAgo * 60_000) / 1000),
        },
      },
    ],
  };
}

const RAIN = "KAMB 021253Z 18008KT 6SM -RA BR OVC012 12/11 A2989";
const NOW = Date.UTC(2026, 8, 2, 13, 0);

let frames: (() => void)[] = [];

beforeEach(() => {
  frames = [];
  // Counted rather than run: the sampler asks for a frame and this decides
  // whether one ever arrives, which is the whole question it is measuring.
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the weather on the chrome", () => {
  it("draws what the nearest station reported", async () => {
    vi.spyOn(metarOverlay, "fetchData").mockResolvedValue(
      reporting(RAIN, 5, NOW),
    );
    const { result } = renderHook(() =>
      useAmbient({
        enabled: true,
        center: HOME,
        clock: NOW,
        reducedMotion: true,
        pageVisible: true,
      }),
    );
    await waitFor(() => expect(result.current.seen?.condition).toBe("rain"));
    expect(result.current.seen?.station).toBe("KAMB");
  });

  it("asks for nothing at all while it is switched off", async () => {
    const fetched = vi
      .spyOn(metarOverlay, "fetchData")
      .mockResolvedValue(reporting(RAIN, 5, NOW));
    const { result } = renderHook(() =>
      useAmbient({
        enabled: false,
        center: HOME,
        clock: NOW,
        reducedMotion: false,
        pageVisible: true,
      }),
    );
    expect(fetched).not.toHaveBeenCalled();
    expect(result.current.seen).toBeNull();
  });

  it("takes itself off when the window cannot keep up", async () => {
    // No frame ever arrives, which is the shape of a window that has stopped
    // painting. Two bad measurements in a row and the effect stops: a
    // decorative animation that costs the radar loop its frames is a bug
    // wearing a costume.
    vi.spyOn(metarOverlay, "fetchData").mockResolvedValue(
      reporting(RAIN, 5, NOW),
    );
    // Real time with the budget turned down, rather than a fake clock: the
    // thing being measured is a frame that never arrives, and faking the
    // clock is exactly what replaces the frame stub above.
    const { result } = renderHook(() =>
      useAmbient({
        enabled: true,
        center: HOME,
        clock: NOW,
        reducedMotion: false,
        pageVisible: true,
        sampleMs: 20,
      }),
    );
    await waitFor(() => expect(result.current.seen).not.toBeNull());
    expect(frames.length).toBeGreaterThan(0);
    await waitFor(() => expect(result.current.dropped).toBe(true));
    expect(result.current.seen).toBeNull();
  });

  it("does not measure what it is not animating", async () => {
    // Under reduced motion there is nothing moving to cost anything, so the
    // sampler never runs and the still treatment stays.
    vi.spyOn(metarOverlay, "fetchData").mockResolvedValue(
      reporting(RAIN, 5, NOW),
    );
    const { result } = renderHook(() =>
      useAmbient({
        enabled: true,
        center: HOME,
        clock: NOW,
        reducedMotion: true,
        pageVisible: true,
        sampleMs: 20,
      }),
    );
    await waitFor(() => expect(result.current.seen).not.toBeNull());
    expect(frames).toHaveLength(0);

    await new Promise((done) => setTimeout(done, 120));
    expect(result.current.dropped).toBe(false);
    expect(result.current.seen).not.toBeNull();
  });

  it("says nothing rather than showing an error when nobody answers", async () => {
    vi.spyOn(metarOverlay, "fetchData").mockRejectedValue(
      new Error("no station"),
    );
    const { result } = renderHook(() =>
      useAmbient({
        enabled: true,
        center: HOME,
        clock: NOW,
        reducedMotion: true,
        pageVisible: true,
      }),
    );
    await waitFor(() => expect(result.current.seen).toBeNull());
  });
});

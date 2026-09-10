import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { SNOWFALL_REFRESH_MS, useSnowfall } from "./useSnowfall";
import type { SnowfallAnalysis, SnowfallWindow } from "../lib/snowfall";

const read =
  vi.fn<
    (window: SnowfallWindow, highContrast: boolean) => Promise<SnowfallAnalysis>
  >();

vi.mock("../lib/snowfall", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/snowfall")>("../lib/snowfall");
  return {
    ...actual,
    snowfallAvailable: () => true,
    fetchSnowfall: (window: SnowfallWindow, highContrast: boolean) =>
      read(window, highContrast),
  };
});

/** An answer carrying the window it was asked for, so a mix-up is visible. */
function analysis(
  window: SnowfallWindow,
  highContrast: boolean,
): SnowfallAnalysis {
  return {
    hours: Number(window.replace("h", "")),
    valid: "2026-09-09T12:00:00+00:00",
    west: -126,
    south: 21,
    east: -66,
    north: 55,
    image: `data:image/png;base64,${window}${highContrast ? "-hc" : ""}`,
    bands: [{ inches: 0.1, color: "#dbeafe" }],
    attribution: "NOAA National Operational Hydrologic Remote Sensing Center",
    attributionUrl: "https://www.nohrsc.noaa.gov/snowfall/",
  };
}

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(async (window, highContrast) =>
    analysis(window, highContrast),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(
  initial: { window: SnowfallWindow; enabled: boolean } = {
    window: "24h",
    enabled: true,
  },
) {
  return renderHook(
    (props: { window: SnowfallWindow; enabled: boolean }) =>
      useSnowfall({
        ready: true,
        enabled: props.enabled,
        window: props.window,
        highContrast: false,
      }),
    { initialProps: initial },
  );
}

describe("the snowfall analysis on the map", () => {
  it("asks once for the window chosen", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.analysis).toBeTruthy());
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("24h", false);
    expect(result.current.analysis?.hours).toBe(24);
    expect(result.current.error).toBeNull();
  });

  it("asks for nothing at all while the layer is off", async () => {
    const { result, rerender } = mount({ window: "24h", enabled: false });
    await act(async () => {});
    expect(read).not.toHaveBeenCalled();
    expect(result.current.analysis).toBeNull();

    // And the moment it is switched on, without waiting for an interval: a
    // reader who turns a layer on is asking for it now.
    rerender({ window: "24h", enabled: true });
    await waitFor(() => expect(result.current.analysis?.hours).toBe(24));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never shows one window's total under another window's name", async () => {
    // The whole reason the answer is held with the question beside it. A
    // 72-hour total left on screen for the second it takes the next picture
    // to arrive is a wrong number rather than a slow one, and the legend
    // beside it would be naming the window the reader just chose.
    let release: ((value: SnowfallAnalysis) => void) | null = null;
    read.mockImplementation(async (window, highContrast) => {
      if (window === "72h") {
        return new Promise<SnowfallAnalysis>((resolve) => {
          release = resolve;
        });
      }
      return analysis(window, highContrast);
    });

    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.analysis?.hours).toBe(24));

    rerender({ window: "72h", enabled: true });
    await act(async () => {});
    // The day's total is gone the moment three days is what was asked for.
    expect(result.current.analysis).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      release?.(analysis("72h", false));
    });
    await waitFor(() => expect(result.current.analysis?.hours).toBe(72));
  });

  it("keeps a failure with the window it was a failure for", async () => {
    read.mockImplementation(async (window, highContrast) => {
      if (window === "48h") throw new Error("the office was not reachable");
      return analysis(window, highContrast);
    });

    const { result, rerender } = mount();
    rerender({ window: "48h", enabled: true });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.analysis).toBeNull();

    // And going back to a window that answers clears it, rather than leaving
    // an error from a different question standing over a good picture.
    rerender({ window: "24h", enabled: true });
    await waitFor(() => expect(result.current.analysis?.hours).toBe(24));
    expect(result.current.error).toBeNull();
  });

  it("asks again on its own interval, and not before", async () => {
    vi.useFakeTimers();
    const { result } = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.analysis).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);

    // The office publishes twice a day, so nothing about a shorter wait than
    // this would be answered with anything new.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SNOWFALL_REFRESH_MS - 1000);
    });
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});

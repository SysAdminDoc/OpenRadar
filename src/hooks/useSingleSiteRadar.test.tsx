import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSingleSiteRadar } from "./useSingleSiteRadar";
import { SWEEP_REFRESH_MS } from "../lib/level2";
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
    ) => Promise<SweepImage>
  >();

vi.mock("../lib/level2", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/level2")>("../lib/level2");
  return {
    ...actual,
    level2Available: () => true,
    nearestSite: (lon: number, lat: number) => nearestSite(lon, lat),
    fetchSweep: (station: string, product: Level2ProductId, tilt: number) =>
      fetchSweep(station, product, tilt),
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
    product: product === "velocity" ? "Velocity" : "Reflectivity",
    unit: product === "velocity" ? "m/s" : "dBZ",
    elevationDegrees: [0.48, 0.87, 1.31][tilt] ?? 0.48,
    tilts: [0.48, 0.87, 1.31],
    tiltIndex: tilt,
    collected: new Date().toISOString(),
    west: -96.5,
    south: 39.6,
    east: -91,
    north: 43.8,
    image: "data:image/png;base64,AAAA",
    volume: `${station}-${product}-${tilt}`,
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
}) {
  return {
    ready: true,
    radar: { ...radar, ...overrides.radar },
    center: overrides.center ?? ([-93.7, 41.7] as [number, number]),
    zoom: 9,
    pageVisible: true,
    paletteGeneration: 0,
  };
}

beforeEach(() => {
  nearestSite.mockReset();
  fetchSweep.mockReset();
  nearestSite.mockResolvedValue("KDMX");
  fetchSweep.mockImplementation(async (station, product, tilt) =>
    sweepFor(station, product, tilt),
  );
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

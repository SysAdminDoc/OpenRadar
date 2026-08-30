import { describe, expect, it, vi } from "vitest";
import { flashPoints, type FlashWindow } from "./useLightning";

const NEWEST = 1_788_083_202;

function window_(overrides: Partial<FlashWindow> = {}): FlashWindow {
  return {
    satellite: "GOES-19 East",
    windowMinutes: 5,
    observed: NEWEST,
    trimmed: false,
    filesRead: 15,
    filesExpected: 15,
    flashes: [
      // Five minutes old, the far end of the window.
      {
        latitude: 30,
        longitude: -90,
        energyJoules: 1,
        areaSquareKm: 100,
        time: NEWEST - 300,
      },
      {
        latitude: 31,
        longitude: -91,
        energyJoules: 2,
        areaSquareKm: 120,
        time: NEWEST - 150,
      },
      {
        latitude: 32,
        longitude: -92,
        energyJoules: 3,
        areaSquareKm: 140,
        time: NEWEST,
      },
    ],
    ...overrides,
  };
}

describe("drawing a flash window", () => {
  it("fades a flash by how long ago it happened", () => {
    const points = flashPoints(window_()) as {
      features: Array<{
        geometry: { coordinates: number[] };
        properties: { age: number };
      }>;
    };
    expect(points.features).toHaveLength(3);
    // Longitude first, which is what GeoJSON wants.
    expect(points.features[0].geometry.coordinates).toEqual([-90, 30]);

    // Oldest at the far end of the fade, newest at the bright end.
    expect(points.features[0].properties.age).toBe(1);
    expect(points.features[1].properties.age).toBeCloseTo(0.5, 5);
    expect(points.features[2].properties.age).toBe(0);
  });

  it("keeps the fade inside its range when a file arrives out of order", () => {
    // A flash stamped after the newest file, or from before the window.
    const odd = window_({
      flashes: [
        {
          latitude: 30,
          longitude: -90,
          energyJoules: 1,
          areaSquareKm: 1,
          time: NEWEST + 600,
        },
        {
          latitude: 31,
          longitude: -91,
          energyJoules: 1,
          areaSquareKm: 1,
          time: NEWEST - 6000,
        },
      ],
    });
    const points = flashPoints(odd) as {
      features: Array<{ properties: { age: number } }>;
    };
    expect(points.features[0].properties.age).toBe(0);
    expect(points.features[1].properties.age).toBe(1);
  });

  it("draws nothing rather than dividing by a window of no length", () => {
    const points = flashPoints(window_({ windowMinutes: 0 })) as {
      features: Array<{ properties: { age: number } }>;
    };
    expect(points.features.every((point) => point.properties.age === 0)).toBe(
      true,
    );
  });
});

describe("a window that has stopped being current", () => {
  it("is not drawn as if it were", async () => {
    const { renderHook, waitFor, cleanup } =
      await import("@testing-library/react");
    const { useLightning } = await import("./useLightning");
    const invoke = vi.fn().mockResolvedValue(window_());
    vi.stubGlobal("window", window);
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = { invoke, transformCallback: (c: unknown) => c };
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

    try {
      const { result, rerender } = renderHook(
        ({ clock }: { clock: number }) =>
          useLightning({
            ready: true,
            enabled: true,
            pageVisible: false,
            clock,
          }),
        { initialProps: { clock: NEWEST * 1000 } },
      );

      await waitFor(() => expect(result.current.window).not.toBeNull());
      expect(result.current.points).not.toBeNull();

      // Half an hour later, with nothing new fetched: the same flashes must
      // not still be drawn, least of all at full brightness.
      rerender({ clock: (NEWEST + 30 * 60) * 1000 });
      expect(result.current.window).toBeNull();
      expect(result.current.points).toBeNull();
    } finally {
      cleanup();
      vi.doUnmock("@tauri-apps/api/core");
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});

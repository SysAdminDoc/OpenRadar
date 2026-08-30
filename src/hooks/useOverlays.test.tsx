import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverlays } from "./useOverlays";
import {
  OVERLAY_ADAPTERS,
  overlayAdapter,
  type OverlayId,
} from "../lib/overlays";

// By id, not position: this test is not about the order of the list.
const alerts = overlayAdapter("alerts");
const viewport = { west: -100, south: 30, east: -90, north: 40 };

/**
 * The toggles, with only the named overlays on.
 *
 * Built from the adapter list rather than written out, so adding an overlay
 * does not mean editing every case in this file.
 */
function only(...on: OverlayId[]): Record<OverlayId, boolean> {
  return Object.fromEntries(
    OVERLAY_ADAPTERS.map((adapter) => [adapter.id, on.includes(adapter.id)]),
  ) as Record<OverlayId, boolean>;
}

function collection(headline: string) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point", coordinates: [-95, 35] },
        properties: { headline },
      },
    ],
  };
}

let fetchData: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchData = vi.spyOn(alerts, "fetchData");
  for (const adapter of OVERLAY_ADAPTERS.filter(
    (candidate) => candidate.id !== alerts.id,
  )) {
    vi.spyOn(adapter, "fetchData").mockResolvedValue({
      type: "FeatureCollection",
      features: [],
    });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useOverlays", () => {
  it("fetches an enabled overlay for a padded viewport", async () => {
    fetchData.mockResolvedValue(collection("Tornado Warning"));

    const { result } = renderHook(() => useOverlays(only("alerts"), viewport));

    await waitFor(() =>
      expect(result.current.alerts.data.features).toHaveLength(1),
    );
    expect(result.current.alerts.error).toBeNull();
    expect(fetchData.mock.calls[0][0]).toEqual({
      west: -105,
      south: 25,
      east: -85,
      north: 45,
    });
  });

  it("keeps the last good snapshot when the feed fails", async () => {
    fetchData.mockResolvedValueOnce(collection("Flood Warning"));

    const { result, rerender } = renderHook(
      ({ bounds }) => useOverlays(only("alerts"), bounds),
      { initialProps: { bounds: viewport } },
    );

    await waitFor(() =>
      expect(result.current.alerts.data.features).toHaveLength(1),
    );

    fetchData.mockRejectedValueOnce(new Error("NWS alerts returned 500."));
    // Just outside the padded box, so the hook asks again for an area the old
    // snapshot still covers.
    rerender({ bounds: { west: -90, south: 30, east: -80, north: 40 } });

    await waitFor(() => expect(result.current.alerts.error).toBeTruthy());
    expect(result.current.alerts.data.features).toHaveLength(1);
    expect(result.current.alerts.data.features[0].properties.headline).toBe(
      "Flood Warning",
    );
  });

  it("reports nothing for a disabled overlay and asks for no data", async () => {
    fetchData.mockResolvedValue(collection("Heat Advisory"));

    const { result } = renderHook(() => useOverlays(only(), viewport));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.alerts.data.features).toHaveLength(0);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("does not refetch while the padded box still covers the viewport", async () => {
    fetchData.mockResolvedValue(collection("Flood Watch"));

    const { result, rerender } = renderHook(
      ({ bounds }) => useOverlays(only("alerts"), bounds),
      { initialProps: { bounds: viewport } },
    );

    await waitFor(() =>
      expect(result.current.alerts.data.features).toHaveLength(1),
    );
    rerender({ bounds: { west: -99, south: 31, east: -91, north: 39 } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchData).toHaveBeenCalledTimes(1);
  });
});

describe("snapshot scoping", () => {
  it("stops showing a snapshot once the map has left its area", async () => {
    fetchData.mockResolvedValue(collection("Flood Warning"));

    const { result, rerender } = renderHook(
      ({ bounds }) => useOverlays(only("alerts"), bounds),
      { initialProps: { bounds: viewport } },
    );

    await waitFor(() =>
      expect(result.current.alerts.data.features).toHaveLength(1),
    );

    fetchData.mockReturnValue(new Promise(() => {}));
    rerender({ bounds: { west: -60, south: 10, east: -50, north: 20 } });

    expect(result.current.alerts.data.features).toHaveLength(0);
  });

  it("keeps a worldwide feed through a pan and asks for it once", async () => {
    // By id, not position: the order of the list is not this test s subject.
    const usgs = overlayAdapter("earthquakes");
    const usgsFetch = vi
      .spyOn(usgs, "fetchData")
      .mockResolvedValue(collection("M 5.8 Somewhere"));

    const { result, rerender } = renderHook(
      ({ bounds }) => useOverlays(only("earthquakes"), bounds),
      { initialProps: { bounds: viewport } },
    );

    await waitFor(() =>
      expect(result.current.earthquakes.data.features).toHaveLength(1),
    );

    rerender({ bounds: { west: 100, south: -40, east: 120, north: -20 } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.earthquakes.data.features).toHaveLength(1);
    expect(usgsFetch).toHaveBeenCalledTimes(1);
  });
});

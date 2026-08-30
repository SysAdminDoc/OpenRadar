import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverlays } from "./useOverlays";
import { OVERLAY_ADAPTERS } from "../lib/overlays";

const alerts = OVERLAY_ADAPTERS[0];
const viewport = { west: -100, south: 30, east: -90, north: 40 };

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
  for (const adapter of OVERLAY_ADAPTERS.slice(1)) {
    vi.spyOn(adapter, "fetchData").mockResolvedValue({
      type: "FeatureCollection",
      features: [],
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOverlays", () => {
  it("fetches an enabled overlay for a padded viewport", async () => {
    fetchData.mockResolvedValue(collection("Tornado Warning"));

    const { result } = renderHook(() =>
      useOverlays(
        { alerts: true, earthquakes: false, wildfires: false },
        viewport,
      ),
    );

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
      ({ bounds }) =>
        useOverlays(
          { alerts: true, earthquakes: false, wildfires: false },
          bounds,
        ),
      { initialProps: { bounds: viewport } },
    );

    await waitFor(() =>
      expect(result.current.alerts.data.features).toHaveLength(1),
    );

    fetchData.mockRejectedValueOnce(new Error("NWS alerts returned 500."));
    // Panning outside the padded box is what forces the next request.
    rerender({ bounds: { west: -60, south: 10, east: -50, north: 20 } });

    await waitFor(() => expect(result.current.alerts.error).toBeTruthy());
    expect(result.current.alerts.data.features).toHaveLength(1);
    expect(result.current.alerts.data.features[0].properties.headline).toBe(
      "Flood Warning",
    );
  });

  it("reports nothing for a disabled overlay and asks for no data", async () => {
    fetchData.mockResolvedValue(collection("Heat Advisory"));

    const { result } = renderHook(() =>
      useOverlays(
        { alerts: false, earthquakes: false, wildfires: false },
        viewport,
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.alerts.data.features).toHaveLength(0);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("does not refetch while the padded box still covers the viewport", async () => {
    fetchData.mockResolvedValue(collection("Flood Watch"));

    const { result, rerender } = renderHook(
      ({ bounds }) =>
        useOverlays(
          { alerts: true, earthquakes: false, wildfires: false },
          bounds,
        ),
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

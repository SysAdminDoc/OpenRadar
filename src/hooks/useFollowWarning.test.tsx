import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFollowSignal, useFollowWarning } from "./useFollowWarning";
import type { OverlayData } from "../lib/overlays";
import type { AppSettings } from "../lib/settings";
import type { WatchAlert } from "../lib/watch";
import type { MapViewportHandle } from "../components/MapViewport";
import { DEFAULT_SETTINGS } from "../lib/settings";

afterEach(cleanup);

const WARNING: WatchAlert = {
  id: "urn:oid:2.49.0.1.840.0.the-one",
  rank: 3,
  headline: "Tornado Warning for Story County",
  agency: "nws",
  impact: "",
  severity: "extreme",
  issued: Date.UTC(2026, 4, 21, 22, 14),
  expires: Date.UTC(2026, 4, 21, 22, 45),
  distanceMiles: 6.2,
  reason: {
    event: "Tornado Warning",
    severity: "extreme",
    minSeverity: "severe",
    radiusMiles: 30,
    distanceMiles: 6.2,
    upgradedFrom: null,
  },
};

/** One warning on the map, carrying the identity the watch decided by. */
function drawn(): OverlayData {
  return {
    features: [
      {
        type: "Feature",
        properties: { capId: WARNING.id },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-93.7, 41.9],
              [-93.5, 41.9],
              [-93.5, 42.1],
              [-93.7, 42.1],
              [-93.7, 41.9],
            ],
          ],
        },
      },
    ],
  } as unknown as OverlayData;
}

function harness() {
  const fitBounds = vi.fn();
  const pushToast = vi.fn();
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    followNewWarnings: true,
  };
  const mapRef = {
    current: {
      fitBounds,
      interactedAt: () => null,
    } as unknown as MapViewportHandle,
  };
  return {
    fitBounds,
    pushToast,
    options: {
      alerts: drawn(),
      settingsRef: { current: settings },
      onSettings: vi.fn(),
      pushToast,
      mapRef,
    },
  };
}

describe("flying to a warning that was just announced", () => {
  it("spends the announcement, so an unrelated wake-up does not fly again", () => {
    // The effect is woken by more than the announcement: an export starting
    // or finishing runs it too, because a flight is refused while one is
    // going on. An announcement that was read without being cleared came back
    // on the next of those, and the map flew to a warning that had been
    // announced minutes earlier with nothing new having happened.
    const { fitBounds, options } = harness();
    const { result } = renderHook(() => useFollowSignal());
    const { rerender } = renderHook(
      ({ exportBusy }: { exportBusy: string | null }) =>
        useFollowWarning({
          signal: result.current.signal,
          take: result.current.take,
          exportBusy,
          ...options,
        }),
      { initialProps: { exportBusy: null as string | null } },
    );

    result.current.remember(WARNING);
    rerender({ exportBusy: null });
    expect(fitBounds).toHaveBeenCalledTimes(1);

    // A still being saved, then finished. Nothing about the warning changed.
    rerender({ exportBusy: "picture" });
    rerender({ exportBusy: null });
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("spends it even when the warning could not be flown to", () => {
    // Refused because the alerts layer is empty, which it is for the whole of
    // a replay and any time the reader has warnings switched off. Held rather
    // than spent, the flight lands whenever the layer next fills, which is
    // the warning arriving out of nowhere the hook exists to prevent.
    const { fitBounds, options } = harness();
    const { result } = renderHook(() => useFollowSignal());
    const { rerender } = renderHook(
      ({
        alerts,
        exportBusy,
      }: {
        alerts: OverlayData | null;
        exportBusy: string | null;
      }) =>
        useFollowWarning({
          ...options,
          signal: result.current.signal,
          take: result.current.take,
          exportBusy,
          alerts,
        }),
      {
        initialProps: {
          alerts: null as OverlayData | null,
          exportBusy: null as string | null,
        },
      },
    );

    result.current.remember(WARNING);
    rerender({ alerts: null, exportBusy: null });
    expect(fitBounds).not.toHaveBeenCalled();

    // The layer fills, and something in the effect's own dependencies wakes it
    // at the same time. A held announcement lands here.
    rerender({ alerts: drawn(), exportBusy: "picture" });
    rerender({ alerts: drawn(), exportBusy: null });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("takes each announcement once and then reads nothing", () => {
    const { result } = renderHook(() => useFollowSignal());
    result.current.remember(WARNING);
    expect(result.current.take()).toBe(WARNING);
    expect(result.current.take()).toBeNull();
  });
});

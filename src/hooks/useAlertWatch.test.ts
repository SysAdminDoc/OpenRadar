import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAlertWatch } from "./useAlertWatch";
import type { OverlayData } from "../lib/overlays";
import type { WatchSettings } from "../lib/watch";
import { alertType } from "../lib/alertTypes";

const fetchData = vi.fn<() => Promise<OverlayData>>();
const tone = vi.fn(async () => true);

vi.mock("../lib/overlays/alerts", async () => {
  const actual = await vi.importActual<typeof import("../lib/overlays/alerts")>(
    "../lib/overlays/alerts",
  );
  return {
    ...actual,
    alertsOverlay: { ...actual.alertsOverlay, fetchData: () => fetchData() },
  };
});

vi.mock("../lib/sound", () => ({
  playAlertTone: () => tone(),
  resetSound: () => {},
}));

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  // The browser path, so the fallback toast is what gets called and no
  // notification plugin has to exist.
  return { ...actual, isDesktopRuntime: () => false };
});

const watch: WatchSettings = {
  enabled: true,
  center: [-96.8, 32.78],
  radiusMiles: 30,
  minSeverity: "severe",
  sound: false,
};

const near: Array<[number, number]> = [
  [-96.9, 32.7],
  [-96.7, 32.7],
  [-96.7, 32.9],
  [-96.9, 32.9],
  [-96.9, 32.7],
];

function alerts(...headlines: string[]): OverlayData {
  return {
    type: "FeatureCollection",
    features: headlines.map((headline) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [near] },
      properties: {
        headline,
        severity: "extreme",
        // The kind the real parse works out from the product name, which is
        // what the switches are keyed on.
        kind: alertType(headline),
        url: `https://example.test/${headline}`,
      },
    })),
  };
}

beforeEach(() => {
  fetchData.mockReset();
  tone.mockReset();
  tone.mockResolvedValue(true);
  fetchData.mockResolvedValue(alerts());
});

afterEach(() => cleanup());

/**
 * The one thing here that reaches somebody who is not looking at the screen.
 * Saying the same thing twice trains people to ignore it, and saying nothing
 * is the whole failure this exists to prevent.
 */
describe("watching a place for alerts", () => {
  it("announces a warning once, however many times it is checked", async () => {
    vi.useFakeTimers();
    try {
      const told = vi.fn();
      fetchData.mockResolvedValue(alerts("Tornado Warning"));
      renderHook(() => useAlertWatch(watch, {}, told));

      await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
      expect(told.mock.calls[0][0].headline).toBe("Tornado Warning");

      // Four more polls of the same still-current warning.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000 * 4 + 100);
      });
      expect(told).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces a second warning that turns up later", async () => {
    vi.useFakeTimers();
    try {
      const told = vi.fn();
      fetchData.mockResolvedValue(alerts("Tornado Warning"));
      renderHook(() => useAlertWatch(watch, {}, told));
      await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));

      fetchData.mockResolvedValue(
        alerts("Tornado Warning", "Flash Flood Warning"),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000 + 100);
      });
      await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));
      expect(told.mock.calls[1][0].headline).toBe("Flash Flood Warning");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing at all while the watch is off", async () => {
    const told = vi.fn();
    fetchData.mockResolvedValue(alerts("Tornado Warning"));
    renderHook(() => useAlertWatch({ ...watch, enabled: false }, {}, told));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchData).not.toHaveBeenCalled();
    expect(told).not.toHaveBeenCalled();
  });

  it("starts again from nothing when the watched place moves", async () => {
    // A different point is a different watch. What was announced about the
    // old one says nothing about whether the new one has been mentioned.
    const told = vi.fn();
    fetchData.mockResolvedValue(alerts("Tornado Warning"));
    const { rerender } = renderHook(
      (props: { watch: WatchSettings }) => useAlertWatch(props.watch, {}, told),
      { initialProps: { watch } },
    );
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));

    rerender({ watch: { ...watch, center: [-96.81, 32.79] } });
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));
  });

  it("makes no sound unless it was asked to", async () => {
    const told = vi.fn();
    fetchData.mockResolvedValue(alerts("Tornado Warning"));
    renderHook(() => useAlertWatch(watch, {}, told));
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    expect(tone).not.toHaveBeenCalled();
  });

  it("makes one sound for a batch, not one for each", async () => {
    // Three warnings arriving together should not sound like an alarm going
    // off, which is the thing that gets an app muted for good.
    const told = vi.fn();
    fetchData.mockResolvedValue(
      alerts(
        "Tornado Warning",
        "Flash Flood Warning",
        "Severe Thunderstorm Warning",
      ),
    );
    renderHook(() => useAlertWatch({ ...watch, sound: true }, {}, told));
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(3));
    expect(tone).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a kind the reader switched off", async () => {
    // The panel lists what the map draws, and this notification's own action
    // opens that panel. Announcing a kind the panel will not show sends
    // somebody to an empty list.
    const told = vi.fn();
    fetchData.mockResolvedValue(alerts("Flash Flood Warning"));
    renderHook(() => useAlertWatch(watch, { flood: false }, told));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(told).not.toHaveBeenCalled();

    // And still announces the kinds that are on.
    const other = vi.fn();
    fetchData.mockResolvedValue(
      alerts("Flash Flood Warning", "Tornado Warning"),
    );
    renderHook(() => useAlertWatch(watch, { flood: false }, other));
    await vi.waitFor(() => expect(other).toHaveBeenCalledTimes(1));
    expect(other.mock.calls[0][0].headline).toBe("Tornado Warning");
  });

  it("does not replay everything when a kind is switched back on", async () => {
    vi.useFakeTimers();
    try {
      const told = vi.fn();
      fetchData.mockResolvedValue(alerts("Tornado Warning"));
      const { rerender } = renderHook(
        (props: { kinds: Record<string, boolean> }) =>
          useAlertWatch(watch, props.kinds, told),
        { initialProps: { kinds: {} as Record<string, boolean> } },
      );
      await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));

      rerender({ kinds: { flood: false } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000 + 100);
      });
      // The tornado warning was already mentioned; changing an unrelated
      // switch is not a reason to mention it again.
      expect(told).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps quiet and carries on when the service fails", async () => {
    vi.useFakeTimers();
    try {
      const told = vi.fn();
      fetchData.mockRejectedValue(new Error("the service returned 503"));
      renderHook(() => useAlertWatch(watch, {}, told));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(told).not.toHaveBeenCalled();

      // And the next poll still happens: one failure must not end the watch.
      fetchData.mockResolvedValue(alerts("Tornado Warning"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000 + 100);
      });
      await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });
});

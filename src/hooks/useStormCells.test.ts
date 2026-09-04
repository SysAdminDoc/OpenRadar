import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStormCells } from "./useStormCells";
import { CELLS_REFRESH_MS, type CellReport } from "../lib/cells";

const cells = vi.fn<(station: string) => Promise<CellReport>>();

vi.mock("../lib/cells", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/cells")>("../lib/cells");
  return {
    ...actual,
    cellsAvailable: () => true,
    fetchCells: (station: string) => cells(station),
  };
});

const NOW = Date.UTC(2026, 7, 30, 19, 53, 11);

function report(overrides: Partial<CellReport> = {}): CellReport {
  return {
    station: "KDMX",
    siteLatitude: 41.7,
    siteLongitude: -93.7,
    observed: new Date(NOW).toISOString(),
    cells: [
      {
        id: "Y6",
        latitude: 41.7,
        longitude: -94.2,
        rangeKm: 42,
        azimuthDegrees: 270,
        directionDegrees: 90,
        speedMs: 15,
        forecast: [],
        past: [],
      },
    ],
    mesocyclones: [],
    ...overrides,
  };
}

beforeEach(() => {
  cells.mockReset();
  cells.mockImplementation(async (station) => report({ station }));
});

afterEach(() => cleanup());

describe("the cells the map is given", () => {
  it("never shows one site's storms while another site is being read", async () => {
    // The effect does not clear state, because writing state during an effect
    // cascades a render. What makes that safe is the gate below it, and this
    // is the only thing that checks the gate is there.
    // Typed as a mutable box rather than a bare let, because TypeScript
    // narrows a let assigned only inside a callback to null forever.
    const pending: { settle: ((value: CellReport) => void) | null } = {
      settle: null,
    };
    cells.mockImplementation(
      (station) =>
        new Promise<CellReport>((resolve) => {
          if (station === "KTLX") pending.settle = resolve;
          else resolve(report({ station }));
        }),
    );

    const { result, rerender } = renderHook(
      (props: { station: string }) =>
        useStormCells({
          ready: true,
          enabled: true,
          station: props.station,
          pageVisible: true,
          clock: NOW,
        }),
      { initialProps: { station: "KDMX" } },
    );

    await waitFor(() => expect(result.current.report?.station).toBe("KDMX"));

    // Now look at another site. Its answer has not arrived, and the first
    // site's storms must not stand in for it.
    rerender({ station: "KTLX" });
    expect(result.current.report).toBeNull();
    expect(result.current.features).toBeNull();

    pending.settle?.(report({ station: "KTLX" }));
    await waitFor(() => expect(result.current.report?.station).toBe("KTLX"));
  });

  it("stops drawing cells from a volume that has gone stale", async () => {
    // Cells are the one layer somebody might act on, and a volume from half an
    // hour ago is not what is happening now.
    const { result, rerender } = renderHook(
      (props: { clock: number }) =>
        useStormCells({
          ready: true,
          enabled: true,
          station: "KDMX",
          pageVisible: true,
          clock: props.clock,
        }),
      { initialProps: { clock: NOW } },
    );

    await waitFor(() => expect(result.current.report).not.toBeNull());

    // Nineteen minutes on, still worth drawing.
    rerender({ clock: NOW + 19 * 60_000 });
    expect(result.current.report).not.toBeNull();

    // Twenty-one, and it is a picture of something that has moved on.
    rerender({ clock: NOW + 21 * 60_000 });
    expect(result.current.report).toBeNull();
    expect(result.current.features).toBeNull();
  });

  it("takes the cells down when a later read fails, rather than leaving the last ones", async () => {
    // The refresh runs on its own timer inside one mount, so the clock has to
    // be driven rather than the hook remounted: a fresh mount has no previous
    // report to leave behind, and would pass whatever the failure path does.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useStormCells({
          ready: true,
          enabled: true,
          station: "KDMX",
          pageVisible: true,
          clock: NOW,
        }),
      );

      await vi.waitFor(() => expect(result.current.report).not.toBeNull());

      cells.mockRejectedValue("the site did not answer");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CELLS_REFRESH_MS + 10);
      });

      await vi.waitFor(() =>
        expect(result.current.error).toBe("the site did not answer"),
      );
      // Drawing the last volume's cells over a newer picture, under a label
      // saying they are current, is worse than drawing none.
      expect(result.current.report).toBeNull();
      expect(result.current.features).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for nothing at all while the layer is off", async () => {
    renderHook(() =>
      useStormCells({
        ready: true,
        enabled: false,
        station: "KDMX",
        pageVisible: true,
        clock: NOW,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cells).not.toHaveBeenCalled();
  });

  it("refuses a volume time it cannot read", async () => {
    cells.mockResolvedValue(report({ observed: "not a time" }));
    const { result } = renderHook(() =>
      useStormCells({
        ready: true,
        enabled: true,
        station: "KDMX",
        pageVisible: true,
        clock: NOW,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A picture that cannot say when it was taken cannot be judged fresh.
    expect(result.current.report).toBeNull();
  });
});

describe("a hidden window", () => {
  it("stops asking, unless the approach watch needs it to carry on", async () => {
    // The approach notice is derived from this report and exists to reach
    // somebody who is not looking at the map, so with the watch on the
    // report has to keep arriving while the window is in the tray.
    vi.useFakeTimers();
    try {
      cells.mockResolvedValue(report());
      const quiet = renderHook(() =>
        useStormCells({
          ready: true,
          enabled: true,
          station: "KDMX",
          pageVisible: false,
          clock: NOW,
        }),
      );
      await vi.waitFor(() => expect(cells).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CELLS_REFRESH_MS * 3);
      });
      // One read, from switching the layer on. Nothing since.
      expect(cells).toHaveBeenCalledTimes(1);
      quiet.unmount();

      cells.mockClear();
      renderHook(() =>
        useStormCells({
          ready: true,
          enabled: true,
          station: "KDMX",
          pageVisible: false,
          keepPollingWhileHidden: true,
          clock: NOW,
        }),
      );
      await vi.waitFor(() => expect(cells).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CELLS_REFRESH_MS * 3);
      });
      expect(cells.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRID_WATCH_REFRESH_MS, useGridWatch } from "./useGridWatch";
import type { GridNotice, GridRule } from "../lib/gridWatch";
import type { WatchPlace } from "../lib/watch";

const grid = vi.hoisted(() => ({ peak: vi.fn() }));
vi.mock("../lib/providers/mrms", async (original) => {
  const actual = await original<typeof import("../lib/providers/mrms")>();
  // `domainFor` is the real one: which grid covers a place is the thing
  // under test here, not something to be told.
  return { ...actual, mrmsAvailable: () => true, mrmsPeakNear: grid.peak };
});
vi.mock("../lib/runtime", () => ({ isDesktopRuntime: () => false }));
vi.mock("../lib/sound", () => ({
  playAlertTone: () => Promise.resolve(true),
  resetSound: () => {},
}));
vi.mock("../lib/online", () => ({
  isOnline: () => true,
  noteReached: () => {},
}));

const RULE: GridRule = {
  enabled: true,
  radiusMiles: 10,
  threshold: 1,
  sound: false,
};

function place(over: Partial<WatchPlace> = {}): WatchPlace {
  return {
    id: "ballfield",
    name: "Ballfield",
    named: true,
    enabled: true,
    center: [-93.6, 41.6],
    radiusMiles: 10,
    minSeverity: "severe",
    sound: false,
    ...over,
  };
}

/**
 * Quiet hours that are quiet right now, whenever the suite happens to run.
 *
 * An hour either side of this minute rather than a fixed window, because
 * `inQuietHours` reads the local clock and a fixed pair would silence
 * nothing on a machine in the wrong time zone.
 */
function quietNow() {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  return {
    enabled: true,
    startMinute: (minute + 1440 - 60) % 1440,
    endMinute: (minute + 60) % 1440,
    overrideSeverity: "extreme" as const,
  };
}

/** Millimetres, so a peak of 50.8 is two inches of hail. */
function peakOf(mm: number) {
  return { value: mm, time: Math.floor(Date.now() / 1000), miles: 3 };
}

beforeEach(() => {
  vi.useFakeTimers();
  grid.peak.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("a grid rule watching a place", () => {
  it("reads the national grid that covers the place, not always the lower forty-eight", async () => {
    grid.peak.mockResolvedValue(null);
    const said: GridNotice[] = [];
    renderHook(
      (props: { places: WatchPlace[] }) =>
        useGridWatch({
          rule: "hail",
          settings: RULE,
          places: props.places,
          ready: true,
          onFallback: (notice) => said.push(notice),
        }),
      {
        initialProps: {
          places: [
            place(),
            place({ id: "sanjuan", name: "San Juan", center: [-66.11, 18.47] }),
            place({
              id: "anchorage",
              name: "Anchorage",
              center: [-149.9, 61.22],
            }),
          ],
        },
      },
    );
    await vi.advanceTimersByTimeAsync(0);

    // The fifth argument is the region. Every one of these places is inside a
    // grid the app already draws, and asking CONUS for the last two is asking
    // for a row off the bottom of it.
    const domains = grid.peak.mock.calls.map((call) => call[4]);
    expect(domains).toEqual(["CONUS", "CARIB", "ALASKA"]);
  });

  it("does not ask about a place no national grid covers", async () => {
    grid.peak.mockResolvedValue(null);
    renderHook(() =>
      useGridWatch({
        rule: "hail",
        settings: RULE,
        // Off every one of the five grids, which is nothing measured rather
        // than a reading of zero.
        places: [place({ id: "berlin", name: "Berlin", center: [13.4, 52.5] })],
        ready: true,
        onFallback: () => {},
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(grid.peak).not.toHaveBeenCalled();
  });

  it("honours quiet hours set after the rule was already running", async () => {
    // Under the threshold to begin with, so nothing has been said yet and the
    // start branch is the one still to come.
    grid.peak.mockResolvedValue(peakOf(10));
    const said: GridNotice[] = [];
    const { rerender } = renderHook(
      (props: { places: WatchPlace[] }) =>
        useGridWatch({
          rule: "hail",
          settings: RULE,
          places: props.places,
          ready: true,
          onFallback: (notice) => said.push(notice),
        }),
      { initialProps: { places: [place()] } },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toHaveLength(0);

    // The reader sets quiet hours while the rule is running, and hail arrives.
    grid.peak.mockResolvedValue(peakOf(50.8));
    rerender({ places: [place({ quietHours: quietNow() })] });
    await vi.advanceTimersByTimeAsync(GRID_WATCH_REFRESH_MS + 1);
    expect(said).toHaveLength(0);

    // And the control: the same hail with the silence lifted does announce,
    // so what held it back was the quiet hours and not a rule that had
    // stopped asking.
    rerender({
      places: [place({ quietHours: { ...quietNow(), enabled: false } })],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toHaveLength(1);
    expect(said[0]?.kind).toBe("over");
  });
});

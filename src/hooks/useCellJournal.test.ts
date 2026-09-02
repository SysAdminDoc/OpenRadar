import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCellJournal, JOURNAL_PASS_MILES } from "./useCellJournal";
import type { CellReport, StormCell } from "../lib/cells";
import type { WatchPlace } from "../lib/watch";

const appended = vi.fn();
vi.mock("../lib/journal", () => ({
  appendJournalRow: (...args: unknown[]) => appended(...args),
}));

const HOME: [number, number] = [-96.8, 32.78];

function place(over: Partial<WatchPlace> = {}): WatchPlace {
  return {
    enabled: true,
    center: HOME,
    radiusMiles: 30,
    minSeverity: "severe",
    sound: false,
    id: "home",
    name: "Casa",
    named: true,
    ...over,
  };
}

/** A cell a given number of miles due north of home. */
function cell(id: string, milesNorth: number): StormCell {
  return {
    id,
    latitude: HOME[1] + milesNorth / 69,
    longitude: HOME[0],
    rangeKm: 30,
    azimuthDegrees: 0,
    directionDegrees: 90,
    speedMs: 12,
    forecast: [],
    past: [],
  };
}

function report(
  cells: StormCell[],
  observed = "2026-09-02T13:00:00Z",
): CellReport {
  return {
    station: "KFWS",
    siteLatitude: 32.57,
    siteLongitude: -97.3,
    observed,
    cells,
    mesocyclones: [],
  };
}

beforeEach(() => {
  appended.mockReset();
});

describe("what the record says about a storm going past", () => {
  it("writes one row for a cell that comes near a named place", () => {
    renderHook(() =>
      useCellJournal({
        report: report([cell("A1", 4)]),
        places: [place()],
        enabled: true,
      }),
    );
    expect(appended).toHaveBeenCalledTimes(1);
    const row = appended.mock.calls[0][0];
    expect(row.place).toBe("Casa");
    expect(row.source).toBe("KFWS");
    // The volume's own time, not the moment the app read it. A row that dates
    // a storm by when it was noticed says something untrue about the radar.
    expect(row.observed).toBe("2026-09-02T13:00:00Z");
    expect(row.text).toContain("A1");
    expect(row.kind).toBe("observation");
  });

  it("says nothing about a storm that stays away", () => {
    renderHook(() =>
      useCellJournal({
        report: report([cell("B2", JOURNAL_PASS_MILES + 5)]),
        places: [place()],
        enabled: true,
      }),
    );
    expect(appended).not.toHaveBeenCalled();
  });

  it("writes one row for a storm, not one for every volume", () => {
    const { rerender } = renderHook(
      (props: { at: string }) =>
        useCellJournal({
          report: report([cell("A1", 3)], props.at),
          places: [place()],
          enabled: true,
        }),
      { initialProps: { at: "2026-09-02T13:00:00Z" } },
    );
    // The algorithm says the same storm is the same storm across volumes, and
    // twelve rows about one storm sitting over somewhere for an hour is a
    // record nobody would read.
    rerender({ at: "2026-09-02T13:05:00Z" });
    rerender({ at: "2026-09-02T13:10:00Z" });
    expect(appended).toHaveBeenCalledTimes(1);
  });

  it("writes one row for a storm whichever radar site saw it", () => {
    const { rerender } = renderHook(
      (props: { station: string }) =>
        useCellJournal({
          report: { ...report([cell("A1", 3)]), station: props.station },
          places: [place()],
          enabled: true,
        }),
      { initialProps: { station: "KFWS" } },
    );
    // Tuning to a neighbouring site is something the reader did. The storm is
    // the same storm, and a second row about it is an entry created by a
    // person rather than by the weather.
    rerender({ station: "KDYX" });
    expect(appended).toHaveBeenCalledTimes(1);
  });

  it("keeps quiet about a place the reader never named", () => {
    renderHook(() =>
      useCellJournal({
        report: report([cell("A1", 2)]),
        places: [place({ named: false, name: "Home" })],
        enabled: true,
      }),
    );
    // The same rule the warning rows follow: a coordinate somebody never
    // called anything is not a place they have claimed.
    expect(appended).not.toHaveBeenCalled();
  });

  it("keeps quiet with the watch switched off", () => {
    renderHook(() =>
      useCellJournal({
        report: report([cell("A1", 2)]),
        places: [place()],
        enabled: false,
      }),
    );
    expect(appended).not.toHaveBeenCalled();
  });

  it("hands the picture of the frame along with the row", () => {
    const capture = vi.fn(async () => new Uint8Array([1, 2, 3]));
    renderHook(() =>
      useCellJournal({
        report: report([cell("A1", 1)]),
        places: [place()],
        enabled: true,
        capture,
      }),
    );
    expect(appended.mock.calls[0][1]).toBe(capture);
  });
});

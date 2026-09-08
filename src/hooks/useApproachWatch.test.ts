import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApproachWatch } from "./useApproachWatch";
import { DEFAULT_APPROACH, type ApproachSettings } from "../lib/approach";
import type { CellReport, StormCell } from "../lib/cells";
import type { WatchPlace } from "../lib/watch";

/**
 * The state this hook holds, which the rules underneath it do not.
 *
 * `src/lib/approach.test.ts` covers what counts as approaching. What lives
 * here is the remembering: said once per storm per place, across a clock that
 * ticks every minute; a place that moved or was switched off forgotten on its
 * own rather than with everybody else's; a storm the tracker dropped forgotten
 * too, so a reused identifier is not suppressed for the rest of the session;
 * and the desktop notification against the in-app fallback. The hook had none
 * of it, and the comment at its own top records a bug of exactly that class: a
 * per-run flag meant a permission prompt outliving one minute swallowed the
 * notice, because the key was recorded and never said.
 */
vi.mock("../lib/sound", () => ({
  playAlertTone: () => Promise.resolve(true),
  resetSound: () => {},
}));

/** Which of the two ways a notice can be delivered, switched per test. */
const delivery = vi.hoisted(() => ({ desktop: false, announces: true }));
vi.mock("../lib/runtime", () => ({
  isDesktopRuntime: () => delivery.desktop,
}));
vi.mock("../lib/notify", () => ({
  announceOnDesktop: () => Promise.resolve(delivery.announces),
}));

afterEach(() => {
  cleanup();
  delivery.desktop = false;
  delivery.announces = true;
  vi.restoreAllMocks();
});

const OBSERVED = "2026-09-03T18:00:00Z";
const NOW = Date.parse(OBSERVED);

/**
 * A cell heading due east at a known speed, put west of the place it is
 * heading for.
 *
 * Borrowed from `approach.test.ts` for the same reason it exists there: the
 * minutes fall out of the closest-approach code the map draws rather than out
 * of a number written into the fixture.
 */
function cellHeadingEast(id: string, lon: number, lat: number): StormCell {
  return {
    id,
    latitude: lat,
    longitude: lon,
    directionDegrees: 90,
    speedMs: 15,
  } as StormCell;
}

function report(cells: StormCell[], observed = OBSERVED): CellReport {
  return {
    station: "KDMX",
    observed,
    cells,
    mesocyclones: [],
  } as unknown as CellReport;
}

function place(
  id: string,
  name: string,
  lon: number,
  lat: number,
  overrides: Partial<WatchPlace> = {},
): WatchPlace {
  return {
    id,
    name,
    enabled: true,
    center: [lon, lat],
    radiusMiles: 25,
    minSeverity: "severe",
    sound: false,
    named: true,
    ...overrides,
  };
}

// An hour, because the fixture geometry is borrowed and the two places in
// it are a little over half an hour and a little under three quarters away.
// The window itself is the rules module's to test, not this one's.
const SETTINGS: ApproachSettings = {
  ...DEFAULT_APPROACH,
  enabled: true,
  minutes: 60,
};

interface Props {
  report: CellReport | null;
  places: WatchPlace[];
  clock: number;
  settings?: ApproachSettings;
}

function watch(onFallback: (approach: unknown) => void, start: Props) {
  return renderHook(
    (props: Props) =>
      useApproachWatch({
        report: props.report,
        places: props.places,
        settings: props.settings ?? SETTINGS,
        clock: props.clock,
        onFallback,
      }),
    { initialProps: start },
  );
}

const HOME = place("home", "Home", -94.0, 41.6);
const SCHOOL = place("school", "School", -93.9, 41.6);
const COMING = report([cellHeadingEast("A1", -94.4, 41.6)]);

describe("what the approach watch remembers between ticks", () => {
  it("says a storm once per place, however often the clock moves", async () => {
    // The effect re-runs every minute with the clock. Saying it again each
    // time is the failure this record exists to stop.
    const onFallback = vi.fn();
    const view = watch(onFallback, {
      report: COMING,
      places: [HOME],
      clock: NOW,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(onFallback.mock.calls[0][0]).toMatchObject({
      placeId: "home",
      cellId: "A1",
    });

    view.rerender({ report: COMING, places: [HOME], clock: NOW + 60_000 });
    view.rerender({ report: COMING, places: [HOME], clock: NOW + 120_000 });
    await Promise.resolve();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("says the same storm again for a second place", async () => {
    // Kept per place rather than per storm: one cell crossing two watched
    // places is two things a reader wants to know.
    const onFallback = vi.fn();
    watch(onFallback, {
      report: COMING,
      places: [HOME, SCHOOL],
      clock: NOW,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));
    expect(onFallback.mock.calls.map((call) => call[0].placeId).sort()).toEqual(
      ["home", "school"],
    );
  });

  it("forgets a place that was switched off, and only that place", async () => {
    // Clearing the lot meant toggling one place off and back on re-announced
    // every storm at every other place, which is the defect the per-place
    // record replaced.
    const onFallback = vi.fn();
    const view = watch(onFallback, {
      report: COMING,
      places: [HOME, SCHOOL],
      clock: NOW,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));

    // Home off, then on again to the same storm still coming.
    view.rerender({
      report: COMING,
      places: [{ ...HOME, enabled: false }, SCHOOL],
      clock: NOW + 60_000,
    });
    view.rerender({
      report: COMING,
      places: [HOME, SCHOOL],
      clock: NOW + 120_000,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(3));
    // Home again, and the school not a second time.
    expect(onFallback.mock.calls[2][0].placeId).toBe("home");
    expect(
      onFallback.mock.calls.filter((call) => call[0].placeId === "school"),
    ).toHaveLength(1);
  });

  it("forgets a place that moved", async () => {
    // The record is keyed on where the place was as well as on which it is,
    // because a place dragged across the map is a different question.
    const onFallback = vi.fn();
    const view = watch(onFallback, {
      report: COMING,
      places: [HOME],
      clock: NOW,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));

    view.rerender({
      report: COMING,
      places: [place("home", "Home", -93.95, 41.6)],
      clock: NOW + 60_000,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));
  });

  it("says a storm again when the tracker drops it and reuses the letter", async () => {
    // The identifiers are reused. A set that grew all session would suppress
    // a different storm that later inherited the same letter and number,
    // which is the one failure here nobody would ever see.
    const onFallback = vi.fn();
    const view = watch(onFallback, {
      report: COMING,
      places: [HOME],
      clock: NOW,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));

    // The tracker loses it.
    view.rerender({
      report: report([]),
      places: [HOME],
      clock: NOW + 60_000,
    });
    // And a different storm arrives under the same identifier.
    view.rerender({
      report: report([cellHeadingEast("A1", -94.3, 41.6)]),
      places: [HOME],
      clock: NOW + 120_000,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));
    expect(onFallback.mock.calls[1][0].cellId).toBe("A1");
  });

  it("says nothing at all while the watch is switched off", async () => {
    const onFallback = vi.fn();
    watch(onFallback, {
      report: COMING,
      places: [HOME],
      clock: NOW,
      settings: { ...SETTINGS, enabled: false },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("how an approach reaches the reader", () => {
  it("hands it to the desktop and does not repeat it in the app", async () => {
    // A notification that landed is already announced by a screen reader, and
    // a toast beside it would be the app saying a thing that is not a warning
    // twice.
    delivery.desktop = true;
    delivery.announces = true;
    const onFallback = vi.fn();
    watch(onFallback, { report: COMING, places: [HOME], clock: NOW });
    await Promise.resolve();
    await Promise.resolve();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back in the app when the desktop would not take it", async () => {
    // A machine that refused the permission, or a build with no plugin. The
    // reader still has to be told.
    delivery.desktop = true;
    delivery.announces = false;
    const onFallback = vi.fn();
    watch(onFallback, { report: COMING, places: [HOME], clock: NOW });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(onFallback.mock.calls[0][0].placeId).toBe("home");
  });
});

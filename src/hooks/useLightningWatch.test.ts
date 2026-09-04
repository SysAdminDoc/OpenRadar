import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLightningWatch } from "./useLightningWatch";
import type { FlashWindow } from "./useLightning";
import {
  QUIET_AFTER_MS,
  type LightningNotice,
  type LightningRule,
} from "../lib/lightningWatch";
import type { WatchPlace } from "../lib/watch";

vi.mock("../lib/sound", () => ({
  playAlertTone: () => Promise.resolve(true),
  resetSound: () => {},
}));

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  // The browser path, so the fallback is what gets called and no
  // notification plugin has to exist.
  return { ...actual, isDesktopRuntime: () => false };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const AT = Date.UTC(2026, 4, 20, 21, 0, 0);

const RULE: LightningRule = {
  enabled: true,
  radiusMiles: 10,
  count: 1,
  sound: false,
};

const PLACE: WatchPlace = {
  id: "ballfield",
  name: "Ballfield",
  named: true,
  enabled: true,
  center: [-93.6, 41.6],
  radiusMiles: 10,
  minSeverity: "severe",
  sound: false,
};

/** A window holding one flash right on top of the watched place. */
function windowWith(flashes: number, at: number): FlashWindow {
  return {
    satellite: "GOES-19",
    windowMinutes: 5,
    observed: Math.floor(at / 1000),
    flashes: Array.from({ length: flashes }, () => ({
      latitude: 41.6,
      longitude: -93.6,
      energyJoules: 1,
      areaSquareKm: 1,
      time: Math.floor(at / 1000),
    })),
    trimmed: false,
    filesRead: 1,
    filesExpected: 1,
  };
}

function watch(onFallback: (notice: LightningNotice) => void) {
  return renderHook(
    (props: { window: FlashWindow | null; clock: number }) =>
      useLightningWatch({
        window: props.window,
        places: [PLACE],
        rule: RULE,
        clock: props.clock,
        onFallback,
      }),
    {
      initialProps: {
        window: windowWith(1, AT) as FlashWindow | null,
        clock: AT,
      },
    },
  );
}

describe("what a gap in the flash feed does to what a place has been told", () => {
  it("does not say a storm has started a second time after the feed goes quiet", async () => {
    // The feed answers with nothing whenever its bucket listing fails, when
    // the newest file it found has aged out of the window, and whenever the
    // reader switches the lightning layer off. None of those is "the storm
    // is over" and none of them may forget that this place was told.
    const onFallback = vi.fn();
    const view = watch(onFallback);
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(onFallback.mock.calls[0][0].kind).toBe("started");

    view.rerender({ window: null, clock: AT + 60_000 });
    view.rerender({ window: windowWith(1, AT + 120_000), clock: AT + 120_000 });
    await Promise.resolve();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("still says it is over half an hour after the last flash", async () => {
    // The all-clear is measured from the newest flash this map remembers. A
    // gap that forgot the place could never say it, so somebody told to come
    // in would never be told they can go back out.
    const onFallback = vi.fn();
    const view = watch(onFallback);
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));

    view.rerender({ window: null, clock: AT + 60_000 });
    view.rerender({
      window: windowWith(0, AT + QUIET_AFTER_MS + 60_000),
      clock: AT + QUIET_AFTER_MS + 60_000,
    });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));
    expect(onFallback.mock.calls[1][0].kind).toBe("quiet");
  });

  it("forgets a place that is no longer being watched", async () => {
    // The prune that the null guard must not have taken away: a place
    // switched off and back on does not announce a storm that ended.
    const onFallback = vi.fn();
    const view = renderHook(
      (props: { places: WatchPlace[]; clock: number }) =>
        useLightningWatch({
          window: windowWith(1, props.clock),
          places: props.places,
          rule: RULE,
          clock: props.clock,
          onFallback,
        }),
      { initialProps: { places: [PLACE] as WatchPlace[], clock: AT } },
    );
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));

    view.rerender({
      places: [{ ...PLACE, enabled: false }],
      clock: AT + 60_000,
    });
    view.rerender({ places: [PLACE], clock: AT + 120_000 });
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalledTimes(2));
    expect(onFallback.mock.calls[1][0].kind).toBe("started");
  });
});

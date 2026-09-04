import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_MS,
  flashAgeExpression,
  flashPoints,
  useLightning,
  type FlashWindow,
} from "./useLightning";

const flashes = vi.fn<() => Promise<FlashWindow>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => flashes(),
}));

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  return { ...actual, isDesktopRuntime: () => true };
});

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

/**
 * Works out what the layer would paint, the way MapLibre would.
 *
 * The fade used to be a number worked out per flash when the collection was
 * built, and these tests asserted on it there. It is a paint expression now,
 * because ageing at build time meant rebuilding and re-uploading every flash
 * on every tick of the clock, and worse, the ages were measured against the
 * fetch's own newest flash rather than against now, so the fade did not
 * actually advance between fetches. The assertions have moved to where the
 * behaviour moved; they have not been weakened.
 */
function evaluate(
  expression: unknown,
  feature: Record<string, number>,
): number {
  if (!Array.isArray(expression)) return expression as number;
  const [op, ...rest] = expression as [string, ...unknown[]];
  const value = (at: unknown) => evaluate(at, feature);
  switch (op) {
    case "get":
      return feature[rest[0] as string];
    case "min":
      return Math.min(...rest.map(value));
    case "max":
      return Math.max(...rest.map(value));
    case "-":
      return value(rest[0]) - value(rest[1]);
    case "/":
      return value(rest[0]) / value(rest[1]);
    default:
      throw new Error(`no rule for ${op}`);
  }
}

describe("drawing a flash window", () => {
  it("carries when each flash happened, and nothing worked out from it", () => {
    const points = flashPoints(window_()) as {
      features: Array<{
        geometry: { coordinates: number[] };
        properties: { at: number };
      }>;
    };
    expect(points.features).toHaveLength(3);
    // Longitude first, which is what GeoJSON wants.
    expect(points.features[0].geometry.coordinates).toEqual([-90, 30]);
    expect(points.features[0].properties.at).toBe(NEWEST - 300);
    expect(points.features[2].properties.at).toBe(NEWEST);
  });

  it("fades a flash by how long ago it happened", () => {
    // Read at the moment of the newest flash, the same three flashes the old
    // build-time fade was checked against.
    const age = flashAgeExpression(NEWEST * 1000, 5);
    expect(evaluate(age, { at: NEWEST - 300 })).toBe(1);
    expect(evaluate(age, { at: NEWEST - 150 })).toBeCloseTo(0.5, 5);
    expect(evaluate(age, { at: NEWEST })).toBe(0);
  });

  it("moves the fade on as the clock does, which the old one did not", () => {
    // The whole point of the change. Two and a half minutes later the flash
    // that was brightest is halfway down the ramp.
    const later = flashAgeExpression((NEWEST + 150) * 1000, 5);
    expect(evaluate(later, { at: NEWEST })).toBeCloseTo(0.5, 5);
    const laterStill = flashAgeExpression((NEWEST + 300) * 1000, 5);
    expect(evaluate(laterStill, { at: NEWEST })).toBe(1);
  });

  it("keeps the fade inside its range when a file arrives out of order", () => {
    // A flash stamped after the newest file, or from before the window.
    const age = flashAgeExpression(NEWEST * 1000, 5);
    expect(evaluate(age, { at: NEWEST + 600 })).toBe(0);
    expect(evaluate(age, { at: NEWEST - 6000 })).toBe(1);
  });

  it("draws rather than dividing by a window of no length", () => {
    const age = flashAgeExpression(NEWEST * 1000, 0);
    const drawn = evaluate(age, { at: NEWEST });
    expect(Number.isFinite(drawn)).toBe(true);
    expect(drawn).toBe(0);
  });

  it("hands the map the same collection until the next fetch", () => {
    // A tick of the clock must not look like new data. Rebuilding the
    // collection put every flash back through setData once a minute for a
    // picture that differed only in brightness.
    const one = window_();
    expect(flashPoints(one)).toEqual(flashPoints(one));
  });
});

describe("what the map is handed", () => {
  afterEach(() => {
    cleanup();
    flashes.mockReset();
    vi.useRealTimers();
  });

  it("is the same collection until the next fetch", async () => {
    // The acceptance for the change: a tick of the clock is a repaint, not a
    // reload. If the hook builds a new collection each tick, the map is asked
    // to take the whole window again through setData once a minute.
    flashes.mockResolvedValue(
      window_({ observed: Math.floor(Date.now() / 1000) }),
    );
    const { result, rerender } = renderHook(
      (props: { clock: number }) =>
        useLightning({
          ready: true,
          enabled: true,
          pageVisible: true,
          clock: props.clock,
        }),
      { initialProps: { clock: Date.now() } },
    );

    await vi.waitFor(() => expect(result.current.points).not.toBeNull());
    const first = result.current.points;

    rerender({ clock: Date.now() + 60_000 });
    rerender({ clock: Date.now() + 120_000 });
    rerender({ clock: Date.now() + 180_000 });

    expect(result.current.points).toBe(first);
    expect(flashes).toHaveBeenCalledTimes(1);
  });

  it("shares one pending native refresh across interval ticks", async () => {
    vi.useFakeTimers();
    const first = deferred<FlashWindow>();
    const second = deferred<FlashWindow>();
    flashes
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() =>
      useLightning({
        ready: true,
        enabled: true,
        pageVisible: true,
        clock: NEWEST * 1000,
      }),
    );
    await act(async () => Promise.resolve());
    expect(flashes).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(flashes).toHaveBeenCalledTimes(1);

    await act(async () =>
      first.resolve(window_({ satellite: "First window" })),
    );
    expect(result.current.window?.satellite).toBe("First window");

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(flashes).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(flashes).toHaveBeenCalledTimes(2);

    await act(async () =>
      second.resolve(window_({ satellite: "Second window" })),
    );
    expect(result.current.window?.satellite).toBe("Second window");
  });
});

describe("a hidden window", () => {
  it("stops asking, unless the lightning watch needs it to carry on", async () => {
    // A watch that only works while somebody is looking at the map is not a
    // watch: the reader minimised the window or put it in the tray precisely
    // so it could tell them something they were not watching for.
    vi.useFakeTimers();
    try {
      flashes.mockResolvedValue(window_());
      const quiet = renderHook(() =>
        useLightning({
          ready: true,
          enabled: true,
          pageVisible: false,
          clock: Date.now(),
        }),
      );
      await vi.waitFor(() => expect(flashes).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
      });
      // One read, from switching the layer on. Nothing since.
      expect(flashes).toHaveBeenCalledTimes(1);
      quiet.unmount();

      flashes.mockClear();
      renderHook(() =>
        useLightning({
          ready: true,
          enabled: true,
          pageVisible: false,
          keepPollingWhileHidden: true,
          clock: Date.now(),
        }),
      );
      await vi.waitFor(() => expect(flashes).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
      });
      expect(flashes.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWind } from "./useWind";
import { WIND_REFRESH_MS, type WindField } from "../lib/wind";

const wind = vi.fn<() => Promise<WindField>>();
const available = vi.fn(() => true);

vi.mock("../lib/wind", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/wind")>("../lib/wind");
  return {
    ...actual,
    windAvailable: () => available(),
    fetchWind: () => wind(),
  };
});

function field(overrides: Partial<WindField> = {}): WindField {
  return {
    west: -130,
    south: 20,
    east: -60,
    north: 55,
    columns: 4,
    rows: 3,
    u: new Array(12).fill(5),
    v: new Array(12).fill(-2),
    run: "2026-08-30T18:00:00Z",
    ...overrides,
  } as WindField;
}

beforeEach(() => {
  wind.mockReset();
  available.mockReset();
  available.mockReturnValue(true);
  wind.mockResolvedValue(field());
});

afterEach(() => cleanup());

/**
 * A model run is published every six hours, so this is not a fast-moving
 * thing. What matters is that it is asked for once and only while wanted.
 */
describe("the wind field the particles follow", () => {
  it("is not asked for at all until the layer is on", async () => {
    const { rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useWind({ ready: true, enabled: props.enabled, pageVisible: true }),
      { initialProps: { enabled: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wind).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(wind).toHaveBeenCalledTimes(1));
  });

  it("is not asked for before the workspace is ready", async () => {
    renderHook(() =>
      useWind({ ready: false, enabled: true, pageVisible: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wind).not.toHaveBeenCalled();
  });

  it("hides what it has while the layer is off, without forgetting it", async () => {
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useWind({ ready: true, enabled: props.enabled, pageVisible: true }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.field).not.toBeNull());

    rerender({ enabled: false });
    expect(result.current.field).toBeNull();

    // Back on, and the field is there again straight away rather than the
    // layer coming up empty while a fresh read runs. It does read again,
    // which is right: a run may have been published in between.
    rerender({ enabled: true });
    expect(result.current.field).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("does not poll behind a hidden window", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() =>
        useWind({ ready: true, enabled: true, pageVisible: false }),
      );
      await vi.waitFor(() => expect(wind).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIND_REFRESH_MS * 3);
      });
      // One read, from switching the layer on. Nothing since.
      expect(wind).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads again when the next run could be out", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() =>
        useWind({ ready: true, enabled: true, pageVisible: true }),
      );
      await vi.waitFor(() => expect(wind).toHaveBeenCalledTimes(1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIND_REFRESH_MS + 10);
      });
      expect(wind).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the field it has when a later read fails", async () => {
    // A model run does not stop being true because the next request timed
    // out, and a particle layer that empties itself on a hiccup is worse than
    // one that carries on with a six-hour-old run it was already drawing.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useWind({ ready: true, enabled: true, pageVisible: true }),
      );
      await vi.waitFor(() => expect(result.current.field).not.toBeNull());

      wind.mockRejectedValue("the model did not answer");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIND_REFRESH_MS + 10);
      });
      await vi.waitFor(() =>
        expect(result.current.error).toBe("the model did not answer"),
      );
      expect(result.current.field).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reporting a failure once the next run arrives", async () => {
    // The panel keeps saying the model did not answer while the particles are
    // moving to a field that did arrive, which is a message about nothing and
    // the reader has no way to tell it is stale. Nothing was asserting that
    // the error clears, so deleting the line that clears it kept the suite
    // green.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useWind({ ready: true, enabled: true, pageVisible: true }),
      );
      await vi.waitFor(() => expect(result.current.field).not.toBeNull());

      wind.mockRejectedValue("the model did not answer");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIND_REFRESH_MS + 10);
      });
      await vi.waitFor(() =>
        expect(result.current.error).toBe("the model did not answer"),
      );

      wind.mockResolvedValue(field({ init: "2026-08-31T00:00:00Z" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WIND_REFRESH_MS + 10);
      });
      await vi.waitFor(() => expect(result.current.error).toBeNull());
      expect(result.current.field?.init).toBe("2026-08-31T00:00:00Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is loading only until something arrives", async () => {
    let settle: ((value: WindField) => void) | null = null;
    wind.mockImplementation(
      () =>
        new Promise<WindField>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useWind({ ready: true, enabled: true, pageVisible: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => {
      settle?.(field());
    });
    await waitFor(() => expect(result.current.field).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it("asks for nothing where there is no model to ask", async () => {
    available.mockReturnValue(false);
    const { result } = renderHook(() =>
      useWind({ ready: true, enabled: true, pageVisible: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wind).not.toHaveBeenCalled();
    expect(result.current.field).toBeNull();
  });
});

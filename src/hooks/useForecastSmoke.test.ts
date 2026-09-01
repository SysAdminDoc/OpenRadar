import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForecastSmoke } from "./useForecastSmoke";
import type { SmokeField } from "../lib/forecastSmoke";

const read =
  vi.fn<(valid: string, preferredInit: string | null) => Promise<SmokeField>>();

vi.mock("../lib/forecastSmoke", async () => {
  const actual = await vi.importActual<typeof import("../lib/forecastSmoke")>(
    "../lib/forecastSmoke",
  );
  return {
    ...actual,
    forecastSmokeAvailable: () => true,
    fetchForecastSmoke: (valid: string, preferredInit: string | null) =>
      read(valid, preferredInit),
  };
});

function field(valid: string, init = "2026-08-30T05:00:00+00:00"): SmokeField {
  return {
    init,
    leadHours: 1,
    // Written the way the native side writes it, which is not the way the
    // page asks.
    valid: valid.replace("Z", "+00:00"),
    west: -134,
    south: 21,
    east: -61,
    north: 52,
    columns: 4,
    rows: 3,
    maxUgm3: 12,
    ramp: [],
    image: "data:image/png;base64,",
  };
}

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(async (valid, preferredInit) =>
    field(valid, preferredInit ?? undefined),
  );
});

afterEach(() => cleanup());

const INIT = "2026-08-30T05:00:00Z";

describe("the hour the playhead is on", () => {
  it("asks once per hour and answers repeats from what it holds", async () => {
    // Playback crosses each hour four times a loop and comes back round.
    const { result, rerender } = renderHook(
      (props: { valid: string | null }) =>
        useForecastSmoke({
          ready: true,
          enabled: true,
          valid: props.valid,
          preferredInit: INIT,
        }),
      { initialProps: { valid: "2026-08-30T06:00:00Z" } },
    );
    await waitFor(() => expect(result.current.field).not.toBeNull());
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("2026-08-30T06:00:00Z", INIT);

    rerender({ valid: "2026-08-30T07:00:00Z" });
    await waitFor(() =>
      expect(result.current.field?.valid).toBe("2026-08-30T07:00:00+00:00"),
    );
    expect(read).toHaveBeenCalledTimes(2);

    // Back to the first hour: held, not fetched, and the right one.
    rerender({ valid: "2026-08-30T06:00:00Z" });
    expect(result.current.field?.valid).toBe("2026-08-30T06:00:00+00:00");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("hands the map nothing on an observed frame, and nothing from another hour", async () => {
    const { result, rerender } = renderHook(
      (props: { valid: string | null }) =>
        useForecastSmoke({
          ready: true,
          enabled: true,
          valid: props.valid,
          preferredInit: INIT,
        }),
      { initialProps: { valid: "2026-08-30T06:00:00Z" as string | null } },
    );
    await waitFor(() => expect(result.current.field).not.toBeNull());

    rerender({ valid: null });
    expect(result.current.field).toBeNull();

    // A new hour whose answer has not arrived: the old hour must not stand
    // in for it, because the legend would name a time the picture is not.
    // A box rather than a bare let: TypeScript narrows a let assigned only
    // inside a callback to null for ever.
    const pending: { settle: ((value: SmokeField) => void) | null } = {
      settle: null,
    };
    read.mockImplementationOnce(
      () =>
        new Promise<SmokeField>((resolve) => {
          pending.settle = resolve;
        }),
    );
    rerender({ valid: "2026-08-30T09:00:00Z" });
    expect(result.current.field).toBeNull();
    expect(result.current.loading).toBe(true);
    pending.settle?.(field("2026-08-30T09:00:00Z"));
    await waitFor(() =>
      expect(result.current.field?.valid).toBe("2026-08-30T09:00:00+00:00"),
    );
  });

  it("asks again when the tail moves to a newer cycle", async () => {
    // The same hour from a newer cycle is a different forecast, and the
    // legend names the cycle, so what was held under the old one is not an
    // answer any more.
    const { result, rerender } = renderHook(
      (props: { init: string }) =>
        useForecastSmoke({
          ready: true,
          enabled: true,
          valid: "2026-08-30T08:00:00Z",
          preferredInit: props.init,
        }),
      { initialProps: { init: INIT } },
    );
    await waitFor(() => expect(result.current.field).not.toBeNull());
    expect(read).toHaveBeenCalledTimes(1);

    rerender({ init: "2026-08-30T06:00:00Z" });
    expect(result.current.field).toBeNull();
    await waitFor(() =>
      expect(result.current.field?.init).toBe("2026-08-30T06:00:00Z"),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("says what went wrong for the hour that failed and nothing else", async () => {
    read.mockRejectedValueOnce("no HRRR cycle has published this hour yet");
    const { result, rerender } = renderHook(
      (props: { valid: string }) =>
        useForecastSmoke({
          ready: true,
          enabled: true,
          valid: props.valid,
          preferredInit: INIT,
        }),
      { initialProps: { valid: "2026-08-30T06:00:00Z" } },
    );
    await waitFor(() =>
      expect(result.current.error).toBe(
        "no HRRR cycle has published this hour yet",
      ),
    );
    expect(result.current.field).toBeNull();

    rerender({ valid: "2026-08-30T07:00:00Z" });
    await waitFor(() => expect(result.current.field).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("asks for nothing while the layer is off", async () => {
    renderHook(() =>
      useForecastSmoke({
        ready: true,
        enabled: false,
        valid: "2026-08-30T06:00:00Z",
        preferredInit: INIT,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(read).not.toHaveBeenCalled();
  });
});

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClassification } from "./useClassification";
import {
  CLASSIFICATION_REFRESH_MS,
  type Classification,
  type ClassificationProduct,
} from "../lib/classification";

const read =
  vi.fn<
    (station: string, product: ClassificationProduct) => Promise<Classification>
  >();

vi.mock("../lib/classification", async () => {
  const actual = await vi.importActual<typeof import("../lib/classification")>(
    "../lib/classification",
  );
  return {
    ...actual,
    fetchClassification: (station: string, product: ClassificationProduct) =>
      read(station, product),
  };
});

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  // Level III is decoded natively, and this is the switch that says there is
  // a native side to ask.
  return { ...actual, isDesktopRuntime: () => true };
});

const NOW = Date.UTC(2026, 8, 1, 18, 0, 0);

function report(overrides: Partial<Classification> = {}): Classification {
  return {
    station: "KTLX",
    observed: new Date(NOW).toISOString(),
    product: "HHC",
    features: [
      {
        class: "rain",
        fromDegrees: 0,
        toDegrees: 1,
        nearKm: 1,
        farKm: 2,
        ring: [
          [-97.3, 35.4],
          [-97.2, 35.4],
          [-97.2, 35.5],
          [-97.3, 35.4],
        ],
      },
    ],
    legend: [{ class: "rain", id: "rain", color: "#61d186" }],
    ...overrides,
  };
}

beforeEach(() => {
  read.mockReset();
  read.mockImplementation(async (station, product) =>
    report({ station, product }),
  );
});

afterEach(() => cleanup());

describe("what the map is handed", () => {
  it("never shows one site's answer, or the other product's, for what is asked now", async () => {
    // The effect does not clear state, because writing state during an effect
    // cascades a render. What makes that safe is the gate below it, and this
    // is the only thing that checks the gate is there.
    const pending: { settle: ((value: Classification) => void) | null } = {
      settle: null,
    };
    read.mockImplementation(
      (station, product) =>
        new Promise<Classification>((resolve) => {
          if (station === "KDMX" || product === "N0H") pending.settle = resolve;
          else resolve(report({ station, product }));
        }),
    );

    const { result, rerender } = renderHook(
      (props: { station: string; product: ClassificationProduct }) =>
        useClassification({
          ready: true,
          enabled: true,
          station: props.station,
          product: props.product,
          pageVisible: true,
          clock: NOW,
        }),
      {
        initialProps: {
          station: "KTLX",
          product: "HHC" as ClassificationProduct,
        },
      },
    );

    await waitFor(() => expect(result.current.report?.station).toBe("KTLX"));
    expect(result.current.features).not.toBeNull();

    // Another site. Its answer has not arrived, and the first site's must not
    // stand in for it.
    rerender({ station: "KDMX", product: "HHC" });
    expect(result.current.report).toBeNull();
    expect(result.current.features).toBeNull();
    pending.settle?.(report({ station: "KDMX" }));
    await waitFor(() => expect(result.current.report?.station).toBe("KDMX"));

    // The same site, the other product: still not an answer to this question.
    rerender({ station: "KDMX", product: "N0H" });
    expect(result.current.report).toBeNull();
    pending.settle?.(report({ station: "KDMX", product: "N0H" }));
    await waitFor(() => expect(result.current.report?.product).toBe("N0H"));
  });

  it("stops drawing a volume that has gone stale", async () => {
    const { result, rerender } = renderHook(
      (props: { clock: number }) =>
        useClassification({
          ready: true,
          enabled: true,
          station: "KTLX",
          product: "HHC",
          pageVisible: true,
          clock: props.clock,
        }),
      { initialProps: { clock: NOW } },
    );

    await waitFor(() => expect(result.current.report).not.toBeNull());

    rerender({ clock: NOW + 19 * 60_000 });
    expect(result.current.report).not.toBeNull();

    rerender({ clock: NOW + 21 * 60_000 });
    expect(result.current.report).toBeNull();
    expect(result.current.features).toBeNull();
  });

  it("takes the layer down when a later read fails, rather than leaving the last one", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useClassification({
          ready: true,
          enabled: true,
          station: "KTLX",
          product: "HHC",
          pageVisible: true,
          clock: NOW,
        }),
      );

      await vi.waitFor(() => expect(result.current.report).not.toBeNull());

      read.mockRejectedValue("the site did not answer");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLASSIFICATION_REFRESH_MS + 10);
      });

      await vi.waitFor(() =>
        expect(result.current.error).toBe("the site did not answer"),
      );
      expect(result.current.report).toBeNull();
      expect(result.current.features).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for nothing while the layer is off", async () => {
    renderHook(() =>
      useClassification({
        ready: true,
        enabled: false,
        station: "KTLX",
        product: "HHC",
        pageVisible: true,
        clock: NOW,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(read).not.toHaveBeenCalled();
  });
});

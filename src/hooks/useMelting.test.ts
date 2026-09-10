import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMelting } from "./useMelting";
import type { MeltingLayer } from "../lib/melting";

const melting = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../lib/melting", async (original) => {
  const actual = await original<typeof import("../lib/melting")>();
  return { ...actual, meltingAvailable: () => true, fetchMelting: melting.ask };
});
vi.mock("../lib/online", () => ({
  isOnline: () => true,
  noteReached: () => {},
}));

/** A layer at a stated height, so two stations' answers are told apart. */
function layer(peakKm: number): MeltingLayer {
  return {
    topKm: peakKm + 0.2,
    bottomKm: peakKm - 0.2,
    peakKm,
    elevationDegrees: 9.9,
    gates: 270,
  };
}

/** A promise this test decides when to settle. */
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => melting.ask.mockReset());
afterEach(cleanup);

describe("the melting layer the panel shows", () => {
  it("does not show one station's layer under another station's heading", async () => {
    const slow = deferred<MeltingLayer>();
    melting.ask.mockImplementation((station: string) =>
      station === "KDMX" ? Promise.resolve(layer(3.0)) : slow.promise,
    );
    const { result, rerender } = renderHook(
      (props: { station: string }) =>
        useMelting({ station: props.station, ready: true }),
      { initialProps: { station: "KDMX" } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    expect((result.current as MeltingLayer).peakKm).toBe(3.0);

    // The reader picks another radar. Its volume has not arrived yet, so
    // there is nothing to say about it: the last one's band is not an answer
    // about this one.
    rerender({ station: "KOUN" });
    expect(result.current).toBeNull();

    await act(async () => {
      slow.settle(layer(4.5));
    });
    await waitFor(() =>
      expect((result.current as MeltingLayer | null)?.peakKm).toBe(4.5),
    );
  });

  it("does not let a slow answer overwrite a newer one", async () => {
    // One volume cached and one not is enough to land the answers out of
    // order, and the loser stands for a full refresh interval.
    const slow = deferred<MeltingLayer>();
    melting.ask.mockImplementation((station: string) =>
      station === "KDMX" ? slow.promise : Promise.resolve(layer(4.5)),
    );
    const { result, rerender } = renderHook(
      (props: { station: string }) =>
        useMelting({ station: props.station, ready: true }),
      { initialProps: { station: "KDMX" } },
    );
    rerender({ station: "KOUN" });
    await waitFor(() =>
      expect((result.current as MeltingLayer | null)?.peakKm).toBe(4.5),
    );

    await act(async () => {
      slow.settle(layer(3.0));
    });
    // Still the newer station's band, not the one that took longer to arrive.
    expect((result.current as MeltingLayer).peakKm).toBe(4.5);
  });
});

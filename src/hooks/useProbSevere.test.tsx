import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProbSevere } from "./useProbSevere";
import type { ProbSevereReading } from "../lib/probsevere";

const fetchProbSevere = vi.fn<() => Promise<ProbSevereReading>>();

vi.mock("../lib/probsevere", async (original) => {
  const real = await original<typeof import("../lib/probsevere")>();
  return {
    ...real,
    probSevereAvailable: () => true,
    fetchProbSevere: () => fetchProbSevere(),
  };
});

const AT = Date.UTC(2026, 7, 30, 23, 8, 41);

function reading(observed: string): ProbSevereReading {
  return {
    observed,
    storms: [
      {
        id: "1",
        rings: [
          [
            [-97, 35],
            [-96, 35],
            [-96, 36],
            [-97, 35],
          ],
        ],
        severe: 62,
        hail: 40,
        wind: 20,
        tornado: 5,
        attributes: [],
      },
    ],
  };
}

function options(clock: number) {
  return { ready: true, enabled: true, pageVisible: true, clock };
}

beforeEach(() => {
  fetchProbSevere.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("what the severe probability layer says for itself", () => {
  it("draws a current reading and says nothing", async () => {
    fetchProbSevere.mockResolvedValue(reading("20260830_230841 UTC"));
    const { result } = renderHook(() => useProbSevere(options(AT)));
    await waitFor(() => expect(result.current.features).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("says why nothing is drawn when the reading has gone stale", async () => {
    // Switching a layer on and getting a blank map with no message is the
    // worst thing a layer somebody might act on can do: it looks exactly like
    // a quiet afternoon. The hook worked this out and App.tsx passed only the
    // features, so nothing ever read it.
    fetchProbSevere.mockResolvedValue(reading("20260830_230841 UTC"));
    const { result } = renderHook(() =>
      useProbSevere(options(AT + 40 * 60_000)),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.features).toBeNull();
    expect(String(result.current.error)).toMatch(/fifteen minutes/);
  });

  it("says why nothing is drawn when the reading could not be fetched", async () => {
    fetchProbSevere.mockRejectedValue(new Error("no reading is published"));
    const { result } = renderHook(() => useProbSevere(options(AT)));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.features).toBeNull();
    expect(result.current.error).toBe("no reading is published");
  });

  it("has nothing to say while the layer is switched off", async () => {
    fetchProbSevere.mockResolvedValue(reading("20260830_230841 UTC"));
    const { result } = renderHook(() =>
      useProbSevere({ ...options(AT), enabled: false }),
    );
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.features).toBeNull();
    expect(fetchProbSevere).not.toHaveBeenCalled();
  });

  it("refuses a stamp from the future rather than drawing it as current", async () => {
    fetchProbSevere.mockResolvedValue(reading("20990101_000000 UTC"));
    const { result } = renderHook(() => useProbSevere(options(AT)));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.features).toBeNull();
  });
});

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cameraMotion,
  reducedMotionRequested,
  useMinuteClock,
  useSecondClock,
} from "./useClock";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the clock the live legend counts on", () => {
  it("moves every second while a live sweep is on screen", async () => {
    // A piece of the volume in progress arrives every eleven or twelve
    // seconds. Read off the minute clock, the age said nought for everything
    // collected since the last tick and then jumped a minute at a time when
    // the radar stalled, which is the opposite of what the number is for.
    const { result } = renderHook(() => useSecondClock(true));
    const first = result.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current - first).toBeGreaterThanOrEqual(3_000);
    expect(result.current - first).toBeLessThan(6_000);
  });

  it("stands still on the minute anywhere else", async () => {
    // Nothing else on screen is measured in seconds, and a whole workspace
    // re-rendering every second for a picture that changes every five minutes
    // would be a cost with nothing to show for it.
    const { result } = renderHook(() => useSecondClock(false));
    const first = result.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current).toBe(first);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });

  it("leaves no timer running once nobody is watching", async () => {
    // A workspace that keeps a one-second timer alive after the live sweep has
    // gone is a wakeup a second, for ever, for nothing on screen.
    expect(vi.getTimerCount()).toBe(0);
    const { unmount } = renderHook(() => useSecondClock(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still gives the minute clock to everybody else", async () => {
    const { result } = renderHook(() => useMinuteClock());
    const first = result.current;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current).toBe(first);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });
});

describe("the current motion preference", () => {
  it("is read when an action starts rather than cached at startup", () => {
    let reduce = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: reduce,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    expect(reducedMotionRequested()).toBe(true);
    expect(cameraMotion(850)).toEqual({ duration: 0, essential: false });
    reduce = false;
    expect(reducedMotionRequested()).toBe(false);
    expect(cameraMotion(850)).toEqual({ duration: 850, essential: false });
  });
});

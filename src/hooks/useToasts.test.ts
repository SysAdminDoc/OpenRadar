import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts, UNDO_LIFETIME_MS } from "./useToasts";

/**
 * What the workspace says in passing, and how long it says it for.
 *
 * Most of these are "that worked" and can go once they have been read. One
 * kind cannot: a message carrying an undo is the only way back from something
 * destructive, and it has to outlast both the clock and whatever else the
 * workspace has to say in the meantime.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("what a toast is worth waiting for", () => {
  it("takes an ordinary message away on its own", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "Saved" }));
    expect(result.current.messages).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(5_300));
    expect(result.current.messages).toHaveLength(0);
  });

  it("keeps an undo long after an ordinary message would have gone", () => {
    const { result } = renderHook(() => useToasts());
    act(() =>
      result.current.push({
        title: "Record deleted",
        actionLabel: "Undo",
        onAction: () => undefined,
        lifetimeMs: UNDO_LIFETIME_MS,
      }),
    );
    act(() => void vi.advanceTimersByTime(6_000));
    // Five seconds is right for "that worked" and wrong for the only way
    // back from deleting a year of somebody's own weather.
    expect(result.current.messages).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(UNDO_LIFETIME_MS));
    expect(result.current.messages).toHaveLength(0);
  });

  it("does not let three later messages push an undo off the screen", () => {
    const { result } = renderHook(() => useToasts());
    act(() =>
      result.current.push({
        title: "Record deleted",
        actionLabel: "Undo",
        onAction: () => undefined,
        lifetimeMs: UNDO_LIFETIME_MS,
      }),
    );
    for (const title of ["A layer failed", "Another failed", "And another"]) {
      act(() => result.current.push({ title }));
    }
    // A layer failing to load must not take away the one control that puts
    // somebody's record back.
    expect(
      result.current.messages.some((one) => one.title === "Record deleted"),
    ).toBe(true);
    expect(result.current.messages.length).toBeLessThanOrEqual(3);
  });

  it("still gives up its timer when it is dismissed by hand", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "Saved" }));
    const id = result.current.messages[0].id;
    act(() => result.current.dismiss(id));
    expect(result.current.messages).toHaveLength(0);
    // And nothing runs later for a message that is already gone.
    expect(vi.getTimerCount()).toBe(0);
  });
});

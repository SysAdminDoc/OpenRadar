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

  it("holds two undos and still keeps to three on screen", () => {
    const { result } = renderHook(() => useToasts());
    for (const title of ["Row deleted", "Record deleted"]) {
      act(() =>
        result.current.push({
          title,
          actionLabel: "Undo",
          onAction: () => undefined,
          lifetimeMs: UNDO_LIFETIME_MS,
        }),
      );
    }
    for (const title of ["A layer failed", "Another failed", "And another"]) {
      act(() => result.current.push({ title }));
    }
    // With two undos held there is no room left, and the arithmetic that
    // works that out used a negative count: `slice(-0)` is the whole array,
    // so everything was kept and the timers of messages still on screen were
    // cancelled. They stayed for ever.
    expect(result.current.messages.length).toBeLessThanOrEqual(3);
    expect(result.current.messages.filter((one) => one.onAction)).toHaveLength(
      2,
    );

    // And whatever is left still goes on its own.
    act(() => void vi.advanceTimersByTime(6_000));
    expect(result.current.messages.every((one) => one.onAction)).toBe(true);
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

describe("a toast somebody is still reading", () => {
  it("stops the clock while it is held, and starts it again after", () => {
    // A message carrying an undo had a few seconds to be noticed, read and
    // pressed, and the host sits near the end of the tab order: somebody
    // tabbing towards the button could watch it go while they were still on
    // the way.
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "Cleared" }));
    expect(result.current.messages).toHaveLength(1);

    act(() => result.current.hold());
    expect(vi.getTimerCount()).toBe(0);

    // Well past the usual lifetime, and it is still there.
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.messages).toHaveLength(1);

    act(() => result.current.release());
    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current.messages).toHaveLength(0);
  });

  it("holds everything on screen, not only the newest", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      result.current.push({ title: "One" });
      result.current.push({ title: "Two" });
    });
    act(() => result.current.hold());
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.messages).toHaveLength(2);
    act(() => result.current.release());
    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current.messages).toHaveLength(0);
  });

  it("does nothing surprising when held or released twice", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "Saved" }));
    act(() => {
      result.current.hold();
      result.current.hold();
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.messages).toHaveLength(1);
    act(() => {
      result.current.release();
      result.current.release();
    });
    // One clock, not two: a second release must not queue a second dismissal.
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current.messages).toHaveLength(0);
  });

  it("releases with nothing held without starting a clock", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.release());
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.messages).toHaveLength(0);
  });
});

describe("a toast that arrives while somebody is reading", () => {
  it("is held too, rather than running its own clock", () => {
    // The first version of the hold returned early when it was already
    // holding, so a message pushed during the hold kept the timer `push`
    // gave it and went out from under the reader.
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "One" }));
    act(() => result.current.hold());
    act(() => result.current.push({ title: "Two" }));

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.messages.map((toast) => toast.title)).toEqual([
      "One",
      "Two",
    ]);

    act(() => result.current.release());
    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current.messages).toHaveLength(0);
  });
});

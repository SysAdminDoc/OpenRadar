import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "./useToasts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a message that takes itself away", () => {
  it("goes on its own after its time", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "One" }));
    expect(result.current.messages).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(6000));
    expect(result.current.messages).toHaveLength(0);
  });

  // Every timer used to be created and forgotten. Nothing cancelled them, so a
  // dismissed message still had one running, and it fired against a list that
  // had already moved on.
  it("takes its timer with it when it is dismissed early", () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.push({ title: "One" }));
    const [only] = result.current.messages;
    act(() => result.current.dismiss(only.id));
    expect(result.current.messages).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("takes the timer of a message pushed off the end", () => {
    const { result } = renderHook(() => useToasts());
    // Four messages, three visible: the first is gone the moment the fourth
    // arrives, and its dismissal has nothing left to do.
    act(() => {
      result.current.push({ title: "One" });
      result.current.push({ title: "Two" });
      result.current.push({ title: "Three" });
      result.current.push({ title: "Four" });
    });
    expect(result.current.messages.map((m) => m.title)).toEqual([
      "Two",
      "Three",
      "Four",
    ]);
    expect(vi.getTimerCount()).toBe(3);
  });

  it("leaves nothing pending when the workspace goes away", () => {
    const { result, unmount } = renderHook(() => useToasts());
    act(() => {
      result.current.push({ title: "One" });
      result.current.push({ title: "Two" });
    });
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

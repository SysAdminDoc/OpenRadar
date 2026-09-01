import { cleanup, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLatest, useMapSync } from "./useMapSync";

afterEach(() => cleanup());

/** The shape every call site has: a value, and a sync that holds and draws it. */
function harness<T>(initial: T, sync: (value: T) => void) {
  // Widened deliberately: every case here reruns with a different value, and
  // inferring the literal would make the second render a type error.
  type Props = { value: T; sync: (value: T) => void };
  return renderHook(
    (props: Props) => {
      const held = useRef(props.value);
      useMapSync(props.value, (next) => {
        held.current = next;
        props.sync(next);
      });
      return held;
    },
    { initialProps: { value: initial, sync } as Props },
  );
}

describe("handing a value to the map", () => {
  it("syncs once on mount, with the value it was given", () => {
    const sync = vi.fn();
    harness<string>("first", sync);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("first");
  });

  it("syncs again only when the value changes", () => {
    const sync = vi.fn();
    const { rerender } = harness<string>("a", sync);
    expect(sync).toHaveBeenCalledTimes(1);

    rerender({ value: "a", sync });
    rerender({ value: "a", sync });
    expect(sync).toHaveBeenCalledTimes(1);

    rerender({ value: "b", sync });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenLastCalledWith("b");
  });

  it("does not sync when only the sync function is rebuilt", () => {
    // The whole reason this exists. A sync closure is new on every render, and
    // depending on it rebuilt every layer on the map every time anything at
    // all changed.
    let calls = 0;
    const { rerender } = harness<string>("a", () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    for (let at = 0; at < 5; at += 1) {
      rerender({
        value: "a",
        sync: () => {
          calls += 1;
        },
      });
    }
    expect(calls).toBe(1);
  });

  it("calls the sync the render brought, with the value that render had", () => {
    // The ref the sync is read through cannot be caught by a runtime test: the
    // effect's own closure holds the same function at the same moment, so
    // reading it directly would behave identically. What the ref buys is the
    // dependency list, which honestly names only the value and so needs no
    // suppression. That is the point of the hook, and it is a property of the
    // lint rather than of a render, so it is stated here rather than asserted:
    // replacing `latest.current(value)` with `sync(value)` makes eslint ask
    // for `sync` in the dependencies again, which is the thing being removed.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = harness<string>("a", first);
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ value: "b", sync: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("b");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("holds the value where a sync called from elsewhere can read it", () => {
    // A style finishing its load calls every sync directly, and they read the
    // refs rather than being handed anything.
    const sync = vi.fn();
    const { result, rerender } = harness<string>("a", sync);
    expect(result.current.current).toBe("a");
    rerender({ value: "b", sync });
    expect(result.current.current).toBe("b");
  });
});

describe("a value the sync reads but does not redraw for", () => {
  it("follows the renders without calling anything", () => {
    const { result, rerender } = renderHook(
      (props: { value: number }) => useLatest(props.value),
      { initialProps: { value: 1 } },
    );
    expect(result.current.current).toBe(1);
    rerender({ value: 2 });
    expect(result.current.current).toBe(2);
  });
});

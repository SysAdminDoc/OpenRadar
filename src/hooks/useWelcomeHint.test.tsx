import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWelcomeHint } from "./useWelcomeHint";
import { en } from "../i18n/en";

afterEach(cleanup);

describe("the hint that says where everything is", () => {
  it("is shown once to somebody who has not seen it", async () => {
    const push = vi.fn();
    const onSeen = vi.fn();
    renderHook(() =>
      useWelcomeHint({ ready: true, seen: false, push, onSeen }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0][0].title).toBe(en["welcome.title"]);
    expect(onSeen).toHaveBeenCalledTimes(1);
  });

  it("is not shown again once it has been", async () => {
    const push = vi.fn();
    renderHook(() =>
      useWelcomeHint({ ready: true, seen: true, push, onSeen: vi.fn() }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();
  });

  it("waits for the saved settings before deciding", async () => {
    // The flag arrives with the settings. Showing the hint before they are
    // read would show it to everybody, every launch.
    const push = vi.fn();
    const { rerender } = renderHook(
      (props: { ready: boolean; seen: boolean }) =>
        useWelcomeHint({ ...props, push, onSeen: vi.fn() }),
      { initialProps: { ready: false, seen: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();

    rerender({ ready: true, seen: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows it once even while the flag is still being written", async () => {
    // Saving is asynchronous, so the hook can be rendered again with the old
    // value before the new one comes back round.
    const push = vi.fn();
    const { rerender } = renderHook(
      (props: { seen: boolean }) =>
        useWelcomeHint({ ready: true, ...props, push, onSeen: vi.fn() }),
      { initialProps: { seen: false } },
    );
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    rerender({ seen: false });
    rerender({ seen: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).toHaveBeenCalledTimes(1);
  });
});

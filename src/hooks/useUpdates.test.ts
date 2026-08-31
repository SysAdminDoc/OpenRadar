import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdates } from "./useUpdates";
import type { UpdateOffer } from "../lib/updates";

const check = vi.fn<() => Promise<UpdateOffer | null>>();
const install =
  vi.fn<(onProgress: (percent: number) => void) => Promise<void>>();
const available = vi.fn(() => true);

vi.mock("../lib/updates", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/updates")>("../lib/updates");
  return {
    ...actual,
    updatesAvailable: () => available(),
    checkForUpdate: () => check(),
    installUpdate: (onProgress: (percent: number) => void) =>
      install(onProgress),
  };
});

const offer: UpdateOffer = {
  version: "0.4.0",
  notes: "Storm cells",
  date: "2026-08-30",
};

beforeEach(() => {
  check.mockReset();
  install.mockReset();
  available.mockReset();
  available.mockReturnValue(true);
});

afterEach(() => cleanup());

/**
 * One button that does the right next thing. Nothing here happens on its own,
 * because an update that downloads itself in the middle of a storm is not much
 * use to anybody.
 */
describe("the update button", () => {
  it("checks first, then installs what the check found", async () => {
    check.mockResolvedValue(offer);
    install.mockResolvedValue();
    const toast = vi.fn();
    const { result } = renderHook(() => useUpdates({ onToast: toast }));

    expect(result.current.state.status).toBe("idle");

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    expect(install).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("0.4.0") }),
    );

    // The same button again, now that there is something to install.
    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(install).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not start a second download while one is running", async () => {
    // React runs an effect twice in a development build, and a double-click is
    // free at any time. Two of these is two downloads of the same installer.
    check.mockResolvedValue(offer);
    let settle: (() => void) | null = null;
    install.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useUpdates({ onToast: vi.fn() }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("available"));

    await act(async () => {
      result.current.act?.();
      result.current.act?.();
      result.current.act?.();
    });
    expect(install).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle?.();
    });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("reports how far a download has got", async () => {
    check.mockResolvedValue(offer);
    install.mockImplementation(async (onProgress) => {
      onProgress(10);
      onProgress(80);
    });
    const { result } = renderHook(() => useUpdates({ onToast: vi.fn() }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // The percentages went somewhere: a download with no progress reads as a
    // hung button.
    expect(install).toHaveBeenCalledWith(expect.any(Function));
  });

  it("says so when there is nothing to install", async () => {
    check.mockResolvedValue(null);
    const toast = vi.fn();
    const { result } = renderHook(() => useUpdates({ onToast: toast }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("current"));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("lets the reader try again after a failed check", async () => {
    check.mockRejectedValueOnce("the update server did not answer");
    const { result } = renderHook(() => useUpdates({ onToast: vi.fn() }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    // A failed check must not leave an offer behind, or the next press would
    // try to install something the check never found.
    check.mockResolvedValue(offer);
    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    expect(install).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps an offer the check found even when what follows it throws", async () => {
    // The check's failure path is only reached with no offer standing, so it
    // has nothing to clear, with one exception: the check found an update and
    // something after it threw. Then the offer is real and the button has to
    // still say install, rather than the reader being told the check failed
    // and losing the update that was found.
    check.mockResolvedValue(offer);
    install.mockResolvedValue(undefined);
    const toast = vi.fn(() => {
      throw new Error("the toast host went away");
    });
    const { result } = renderHook(() => useUpdates({ onToast: toast }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    // Pressing again installs what was found rather than checking afresh.
    await act(async () => result.current.act?.());
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps the offer when the install fails, so the button still installs", async () => {
    check.mockResolvedValue(offer);
    install.mockRejectedValueOnce("the installer could not be written");
    const toast = vi.fn();
    const { result } = renderHook(() => useUpdates({ onToast: toast }));

    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("available"));
    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    // A restart that never came must not leave the button stuck saying
    // restart. Pressing again tries the install, not another check.
    install.mockResolvedValue();
    await act(async () => result.current.act?.());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(check).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("offers no button at all where there is nothing to update", () => {
    // A browser preview cannot install anything, and a button that cannot
    // work is worse than no button.
    available.mockReturnValue(false);
    const { result } = renderHook(() => useUpdates({ onToast: vi.fn() }));
    expect(result.current.act).toBeNull();
  });
});

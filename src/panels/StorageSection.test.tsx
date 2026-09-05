import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageSection } from "./StorageSection";
import { en } from "../i18n/en";

/**
 * What the app is holding on disk, and the four things the row can say.
 *
 * The states are the point. "Reading" and "Not readable" are different
 * answers, and folding them together said the second for the fraction of a
 * second before every first read; a cache that is already empty is not
 * something to offer to clear; and a browser preview holds nothing at all.
 */

const tileCache = vi.hoisted(() => ({
  available: true,
  size: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../lib/tileCache", () => ({
  diskCacheAvailable: () => tileCache.available,
  diskCacheSize: () => tileCache.size(),
  clearDiskCache: () => tileCache.clear(),
}));

afterEach(() => {
  cleanup();
  tileCache.available = true;
  tileCache.size.mockReset();
  tileCache.clear.mockReset();
});

describe("what is kept on disk", () => {
  it("says nothing is, in a browser", () => {
    tileCache.available = false;
    render(<StorageSection onCleared={vi.fn()} onFailed={vi.fn()} />);
    expect(screen.getByText(en["storage.desktopOnly"])).toBeTruthy();
    expect(screen.queryByText(en["storage.clear"])).toBeNull();
  });

  it("says it is reading before it has an answer", () => {
    // Never resolves, which is the state between opening the panel and the
    // first answer.
    tileCache.size.mockReturnValue(new Promise(() => undefined));
    render(<StorageSection onCleared={vi.fn()} onFailed={vi.fn()} />);
    expect(screen.getByText(en["storage.reading"])).toBeTruthy();
    // And nothing to press over a size nobody has yet.
    expect(
      screen.getByRole("button", { name: /Clear/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says the size is not readable rather than showing a wrong one", async () => {
    tileCache.size.mockRejectedValue(new Error("no answer"));
    render(<StorageSection onCleared={vi.fn()} onFailed={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(en["storage.unknown"])).toBeTruthy(),
    );
  });

  it("offers nothing to clear over a cache that is already empty", async () => {
    tileCache.size.mockResolvedValue({ bytes: 0 });
    render(<StorageSection onCleared={vi.fn()} onFailed={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Clear/ }).hasAttribute("disabled"),
      ).toBe(true),
    );
  });

  it("says what came back, and how much", async () => {
    tileCache.size.mockResolvedValue({ bytes: 5_000_000 });
    tileCache.clear.mockResolvedValue({ freed: 5_000_000 });
    const onCleared = vi.fn();
    render(<StorageSection onCleared={onCleared} onFailed={vi.fn()} />);

    const clear = await screen.findByRole("button", { name: /Clear/ });
    await waitFor(() => expect(clear.hasAttribute("disabled")).toBe(false));
    fireEvent.click(clear);
    await waitFor(() => expect(onCleared).toHaveBeenCalled());
    // The whole line, because what it says depends on the network.
    expect(String(onCleared.mock.calls[0][0])).toMatch(/MB|KB|bytes/);
  });

  it("translates a refusal that carries no message of its own", async () => {
    // The command returns no error, so anything landing here came from the
    // bridge. Stringifying an unknown put [object Object] in a toast.
    tileCache.size.mockResolvedValue({ bytes: 5_000_000 });
    tileCache.clear.mockRejectedValue({ code: "nope" });
    const onFailed = vi.fn();
    render(<StorageSection onCleared={vi.fn()} onFailed={onFailed} />);

    const clear = await screen.findByRole("button", { name: /Clear/ });
    await waitFor(() => expect(clear.hasAttribute("disabled")).toBe(false));
    fireEvent.click(clear);
    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith(en["storage.clearFailedUnknown"]),
    );
  });

  it("passes on a refusal that does carry one", async () => {
    tileCache.size.mockResolvedValue({ bytes: 5_000_000 });
    tileCache.clear.mockRejectedValue(new Error("the disk is busy"));
    const onFailed = vi.fn();
    render(<StorageSection onCleared={vi.fn()} onFailed={onFailed} />);

    const clear = await screen.findByRole("button", { name: /Clear/ });
    await waitFor(() => expect(clear.hasAttribute("disabled")).toBe(false));
    fireEvent.click(clear);
    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith("the disk is busy"),
    );
  });
});

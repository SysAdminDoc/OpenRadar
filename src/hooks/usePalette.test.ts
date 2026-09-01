import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePalette } from "./usePalette";
import { parsePalette, type Palette } from "../lib/palette";

const applied = vi.fn<(palettes: Palette[]) => Promise<number | null>>();

vi.mock("../lib/paletteRenderer", () => ({
  applyPalettesToRenderer: (palettes: Palette[]) => applied(palettes),
}));

vi.mock("../lib/settings", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/settings")>("../lib/settings");
  return { ...actual, isDesktopRuntime: () => true };
});

const table = (name: string, units: string) =>
  parsePalette(`Units: ${units}\nColor: 5 4 233 231`, name)!;

beforeEach(() => {
  applied.mockReset();
  let generation = 0;
  applied.mockImplementation(async () => {
    generation += 1;
    return generation;
  });
});

afterEach(() => cleanup());

/**
 * Every send bumps a generation on the native side, and that generation is in
 * every radar, sweep and grid address. A send nobody asked for is not a wasted
 * IPC call, it is the whole map fetched again.
 */
describe("handing the tables to the renderer", () => {
  it("sends nothing when there is nothing to send", async () => {
    renderHook(() => usePalette({ ready: true, palettes: [] }));
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
    expect(applied.mock.calls[0][0]).toEqual([]);
  });

  it("does not send again for an equal set in a new array", async () => {
    // Normalizing the settings allocates a fresh array on every write, and the
    // camera is written on every pan. Depending on that identity meant a pan
    // re-sent the set and invalidated every tile, for readers with no colour
    // table at all.
    const { rerender } = renderHook(
      (props: { palettes: Palette[] }) =>
        usePalette({ ready: true, palettes: props.palettes }),
      { initialProps: { palettes: [] as Palette[] } },
    );
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));

    for (let at = 0; at < 5; at += 1) rerender({ palettes: [] });
    expect(applied).toHaveBeenCalledTimes(1);

    const one = table("a.pal", "dBZ");
    rerender({ palettes: [one] });
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(2));

    // The same table, read again from the same text, is the same table.
    for (let at = 0; at < 5; at += 1) {
      rerender({ palettes: [table("a.pal", "dBZ")] });
    }
    expect(applied).toHaveBeenCalledTimes(2);
  });

  it("sends again when the set actually changes", async () => {
    const { rerender } = renderHook(
      (props: { palettes: Palette[] }) =>
        usePalette({ ready: true, palettes: props.palettes }),
      { initialProps: { palettes: [table("a.pal", "dBZ")] } },
    );
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));

    rerender({ palettes: [table("a.pal", "dBZ"), table("v.pal", "kt")] });
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(2));
    // And it is handed the set it was last given, not the one it started with.
    expect(applied.mock.calls[1][0].map((one) => one.name)).toEqual([
      "a.pal",
      "v.pal",
    ]);

    rerender({ palettes: [] });
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(3));
    expect(applied.mock.calls[2][0]).toEqual([]);
  });

  it("waits until the workspace is ready", async () => {
    const { rerender } = renderHook(
      (props: { ready: boolean }) =>
        usePalette({ ready: props.ready, palettes: [] }),
      { initialProps: { ready: false } },
    );
    expect(applied).not.toHaveBeenCalled();
    rerender({ ready: true });
    await vi.waitFor(() => expect(applied).toHaveBeenCalledTimes(1));
  });
});

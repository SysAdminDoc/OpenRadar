import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePalette } from "./palette";
import { applyPalettesToRenderer } from "./paletteRenderer";

const { invoke, setGeneration } = vi.hoisted(() => ({
  invoke: vi.fn(),
  setGeneration: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./providers/mrms", () => ({
  setMrmsPaletteGeneration: setGeneration,
}));

const palette = parsePalette("Units: dBZ\nColor: 5 4 233 231", "storm.pal")!;

describe("native palette acknowledgement", () => {
  beforeEach(() => {
    invoke.mockReset();
    setGeneration.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("resolves only after the native renderer accepts the table", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockResolvedValue(7);

    await expect(applyPalettesToRenderer([palette])).resolves.toBe(7);
    // `solid` travels with every stop. It used to be dropped here, which is
    // how every SolidColor line in a reader's table was drawn as a blend.
    expect(invoke).toHaveBeenCalledWith("set_palettes", {
      tables: [
        {
          units: "dBZ",
          rangeFolded: null,
          stops: [{ value: 5, color: "#04e9e7", toColor: null, solid: false }],
        },
      ],
    });
    expect(setGeneration).toHaveBeenCalledWith(7);
  });

  it("propagates a native rejection so the caller cannot report success", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    invoke.mockRejectedValue(new Error("renderer refused the table"));
    await expect(applyPalettesToRenderer([palette])).rejects.toThrow(
      "renderer refused the table",
    );
    expect(setGeneration).not.toHaveBeenCalled();
  });

  it("does not call a native command in the browser preview", async () => {
    await expect(applyPalettesToRenderer([palette])).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

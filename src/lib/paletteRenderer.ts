import { paletteForRenderer, type Palette } from "./palette";
import { setMrmsPaletteGeneration } from "./providers/mrms";
import { isDesktopRuntime } from "./settings";

/** Applies a table to the native renderer and resolves only after it accepts it. */
export async function applyPaletteToRenderer(
  palette: Palette | null,
): Promise<number | null> {
  if (!isDesktopRuntime()) return null;

  const { invoke } = await import("@tauri-apps/api/core");
  const stops = (palette ? paletteForRenderer(palette) : []).map(
    ([value, color, toColor]) => ({ value, color, toColor }),
  );
  const generation = await invoke<number>("set_palette", {
    units: palette?.units ?? null,
    rangeFolded: palette?.rangeFolded ?? null,
    stops,
  });
  setMrmsPaletteGeneration(generation);
  return generation;
}

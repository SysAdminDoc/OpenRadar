import { paletteForRenderer, type Palette } from "./palette";
import { setMrmsPaletteGeneration } from "./providers/mrms";
import { isDesktopRuntime } from "./settings";

/**
 * Applies the tables in force to the native renderer and resolves only after
 * it accepts them.
 *
 * The whole set goes over at once rather than one call per table, so there is
 * never a moment where the renderer holds a reflectivity scale the reader has
 * removed beside a velocity scale they have just added. One call, one
 * generation, one round of tiles.
 */
export async function applyPalettesToRenderer(
  palettes: Palette[],
): Promise<number | null> {
  if (!isDesktopRuntime()) return null;

  const { invoke } = await import("@tauri-apps/api/core");
  const tables = palettes.map((palette) => ({
    units: palette.units ?? null,
    rangeFolded: palette.rangeFolded ?? null,
    // Whether a stop is solid has to travel with it. Without it the native
    // side cannot tell a SolidColor line from a Color line with one colour,
    // and every solid stop in somebody's table is drawn as a blend.
    stops: paletteForRenderer(palette).map(
      ([value, color, toColor, solid]) => ({
        value,
        color,
        toColor,
        solid,
      }),
    ),
  }));
  const generation = await invoke<number>("set_palettes", { tables });
  setMrmsPaletteGeneration(generation);
  return generation;
}

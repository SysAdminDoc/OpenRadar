import { useEffect, useState } from "react";
import { log } from "../lib/log";
import { paletteForRenderer, type Palette } from "../lib/palette";
import { applyPalettesToRenderer } from "../lib/paletteRenderer";
import { isDesktopRuntime } from "../lib/settings";

/**
 * Hands a loaded colour table to the native renderers and reports back the
 * generation they answered with.
 *
 * The table is held there rather than sent with every request, because a tile
 * is fetched by URL and a whole colour table will not fit in one. The
 * generation goes in the tile address instead, so a new table makes every
 * cached tile a different address and nothing drawn with the old one survives.
 */
export function usePalette(options: {
  ready: boolean;
  /** Every table in force, at most one per unit. */
  palettes: Palette[];
}): number {
  const { ready, palettes } = options;
  const [generation, setGeneration] = useState(0);

  // The set is only sent when it changes, and its own contents are the key,
  // so re-importing a table that reads identically re-renders nothing.
  const sent = JSON.stringify(
    palettes.map((palette) => [
      palette.units,
      palette.rangeFolded,
      paletteForRenderer(palette),
    ]),
  );

  useEffect(() => {
    if (!ready || !isDesktopRuntime()) return;
    let open = true;

    void (async () => {
      try {
        const next = await applyPalettesToRenderer(palettes);
        if (!open) return;
        if (next !== null) setGeneration(next);
      } catch (failure: unknown) {
        if (!open) return;
        log.warn(
          "app",
          failure instanceof Error
            ? failure.message
            : "The colour tables could not be applied.",
        );
      }
    })();

    return () => {
      open = false;
    };
  }, [palettes, ready, sent]);

  return generation;
}

import { useEffect, useState } from "react";
import { log } from "../lib/log";
import { paletteForRenderer, type Palette } from "../lib/palette";
import { applyPaletteToRenderer } from "../lib/paletteRenderer";
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
  palette: Palette | null;
}): number {
  const { ready, palette } = options;
  const [generation, setGeneration] = useState(0);

  // A table is only sent when it changes, and its own contents are the key.
  const sent = palette
    ? JSON.stringify([
        palette.units,
        palette.rangeFolded,
        paletteForRenderer(palette),
      ])
    : "";

  useEffect(() => {
    if (!ready || !isDesktopRuntime()) return;
    let open = true;

    void (async () => {
      try {
        const next = await applyPaletteToRenderer(palette);
        if (!open) return;
        if (next !== null) setGeneration(next);
      } catch (failure: unknown) {
        if (!open) return;
        log.warn(
          "app",
          failure instanceof Error
            ? failure.message
            : "The colour table could not be applied.",
        );
      }
    })();

    return () => {
      open = false;
    };
  }, [palette, ready, sent]);

  return generation;
}

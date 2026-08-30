import { useEffect, useState } from "react";
import { log } from "../lib/log";
import { paletteForRenderer, type Palette } from "../lib/palette";
import { setMrmsPaletteGeneration } from "../lib/providers/mrms";
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
    ? JSON.stringify([palette.units, paletteForRenderer(palette)])
    : "";

  useEffect(() => {
    if (!ready || !isDesktopRuntime()) return;
    let open = true;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const [units, stops] = sent
          ? (JSON.parse(sent) as [
              string | null,
              Array<[number, string, string | null]>,
            ])
          : [null, []];
        const next = await invoke<number>("set_palette", {
          units,
          stops: stops.map(([value, color, toColor]) => ({
            value,
            color,
            toColor,
          })),
        });
        if (!open) return;
        // The provider builds its tile addresses from this, so it has to know
        // before the timeline is asked for frames again.
        setMrmsPaletteGeneration(next);
        setGeneration(next);
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
  }, [ready, sent]);

  return generation;
}

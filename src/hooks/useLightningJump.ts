import { useMemo } from "react";
import { rememberJumps, type CellJump } from "../lib/lightningJump";
import type { CellReport } from "../lib/cells";
import type { FlashWindow } from "./useLightning";

/**
 * Watches each tracked storm's flash rate for a sudden rise.
 *
 * The two halves are already on the map and nothing joined them: the radar's
 * own cell tracker, and the satellite's flashes. This counts the flashes
 * inside each cell as the windows arrive, keeps a two-minute series per cell,
 * and reads the published jump statistic off it.
 *
 * Driven by the flash window the map already holds rather than by a poll of
 * its own, like the lightning notice beside it. Nothing here announces
 * anything: a jump is a signal that a storm is intensifying, and the surface
 * that shows it says so.
 */
export function useLightningJump(options: {
  report: CellReport | null;
  window: FlashWindow | null;
}): Map<string, CellJump> {
  const { report, window: flashes } = options;
  // The window's own moment rather than the clock, so two arrivals of the
  // same window land in the same bin. `observed` is in seconds, like every
  // time the native side hands over.
  const observed = flashes?.observed ?? null;
  const cells = report?.cells;
  return useMemo(() => {
    if (!cells || !flashes || observed === null)
      return new Map<string, CellJump>();
    return rememberJumps(cells, flashes.flashes, observed * 1000);
    // Folding the same window twice is idempotent, which is what makes it
    // safe to do here rather than in an effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, observed]);
}

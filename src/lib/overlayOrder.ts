import { OVERLAY_ADAPTERS, type OverlayId } from "./overlays";

/**
 * Where each overlay was designed to sit, bottom first.
 *
 * Guidance about what might happen goes under what is happening, what happened
 * goes under what is being warned about, and the warning goes on top.
 */
export const OVERLAY_DEPTH: Record<OverlayId, number> = {
  spcOutlooks: 0,
  // The two Weather Prediction Center outlooks sit with the SPC one: they are
  // the same kind of statement about the same day, and a reader with two of
  // them on is comparing them rather than stacking them.
  wpcExcessiveRain: 1,
  wpcWinterSeverity: 2,
  spcDiscussions: 3,
  stormReports: 4,
  tropical: 5,
  // Under the fire it came from, because a perimeter is where something is
  // burning and the plume is where the smoke went.
  smoke: 6,
  wildfires: 7,
  earthquakes: 8,
  // Over the areas, because a station plot is a handful of marks and anything
  // filled underneath would swallow it.
  metar: 9,
  // Over the plots for the same reason they are over the areas: a gauge is a
  // single dot and the thing a reader is looking for when they turned it on.
  riverGauges: 10,
  alerts: 11,
};

/**
 * Which overlays cannot be moved.
 *
 * A warning is somebody telling you to take cover. Nothing should be able to
 * put a wildfire perimeter on top of one, so it is not in the arrangement at
 * all rather than being an arrangement somebody could get wrong.
 */
export const PINNED_OVERLAYS: OverlayId[] = ["alerts"];

/** The overlays bottom first, in whatever order the reader has arranged. */
export function overlayBandOrder(chosen: string[]): OverlayId[] {
  const movable = OVERLAY_ADAPTERS.map((adapter) => adapter.id)
    .filter((id) => !PINNED_OVERLAYS.includes(id))
    .sort((left, right) => OVERLAY_DEPTH[left] - OVERLAY_DEPTH[right]);

  // What the reader arranged, then anything they have never touched, in the
  // order it was designed to sit in.
  const arranged = chosen.filter((id): id is OverlayId =>
    movable.includes(id as OverlayId),
  );
  const rest = movable.filter((id) => !arranged.includes(id));
  return [...arranged, ...rest, ...PINNED_OVERLAYS];
}

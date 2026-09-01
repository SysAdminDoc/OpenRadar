import { OVERLAY_ADAPTERS, type OverlayId } from "./overlays";

/**
 * Where each overlay was designed to sit, bottom first.
 *
 * Guidance about what might happen goes under what is happening, what happened
 * goes under what is being warned about, and the warning goes on top.
 */
export const OVERLAY_DEPTH: Record<OverlayId, number> = {
  spcOutlooks: 0,
  spcDiscussions: 1,
  stormReports: 2,
  tropical: 3,
  // Under the fire it came from, because a perimeter is where something is
  // burning and the plume is where the smoke went.
  smoke: 4,
  wildfires: 5,
  earthquakes: 6,
  alerts: 7,
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

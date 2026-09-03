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

  // What the reader arranged, with anything they have never touched put back
  // at the depth it was designed for rather than on top of everything.
  //
  // Appended, a layer added in a later build landed above every layer the
  // reader had ever moved: a reader who had arranged their overlays once got
  // the next release's thirty-per-cent fill painted over their station plots
  // and gauge dots. A new id has no place in the reader's arrangement, and the
  // honest answer to where it goes is where the table says.
  //
  // Deduplicated on the way in, because a stored arrangement is a settings
  // file: one that named a layer twice added that layer's source and its
  // layers twice, under the same ids.
  const arranged = [...new Set(chosen)].filter((id): id is OverlayId =>
    movable.includes(id as OverlayId),
  );
  const rest = movable.filter((id) => !arranged.includes(id));
  const placed = [...arranged];
  for (const id of rest) {
    // In front of the first layer that was designed to sit above it, or on
    // the end when nothing was.
    const at = placed.findIndex(
      (held) => OVERLAY_DEPTH[held] > OVERLAY_DEPTH[id],
    );
    if (at < 0) placed.push(id);
    else placed.splice(at, 0, id);
  }
  return [...placed, ...PINNED_OVERLAYS];
}

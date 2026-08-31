/**
 * The layers OpenRadar puts on the map, and the order they belong in.
 *
 * The order the map draws in and the order a click is resolved in are the same
 * question, and they must not be two lists. Written out twice they drift: the
 * severe probability layer is drawn under the warnings on purpose, because
 * guidance belongs under a decision somebody has taken responsibility for, and
 * the click handler asked it first anyway. A tornado warning was unreachable
 * by click anywhere the model had drawn a polygon over the same storm, which
 * is every storm that carries one.
 *
 * This lives beside the map rather than inside it so the order can be read and
 * checked without standing a whole map up.
 */

/** Every overlay names its source and its layers from this. */
export const OVERLAY_SOURCE_PREFIX = "openradar-overlay-";

export const SATELLITE_LAYER_ID = "openradar-satellite-layer";
export const SURGE_LAYER_ID = "openradar-surge-layer";
export const MRMS_SOURCE_PREFIX = "openradar-mrms-";
export const WIND_LAYER_ID = "openradar-wind";
export const FLASH_LAYER_ID = "openradar-flash-points";
export const PROBSEVERE_FILL_LAYER_ID = "openradar-probsevere-fill";
export const PROBSEVERE_LINE_LAYER_ID = "openradar-probsevere-line";
export const SWEEP_LAYER_ID = "openradar-sweep-layer";
export const RADAR_LAYER_ID = "openradar-radar-layer";
export const ROUTE_LAYER_ID = "openradar-route-line";
export const TOOL_LINE_LAYER_ID = "openradar-tool-line";
export const TOOL_POINT_LAYER_ID = "openradar-tool-points";
export const TRACK_LINE_LAYER_ID = "openradar-track-line";
export const TRACK_POINT_LAYER_ID = "openradar-track-points";
export const CUSTOM_FILL_LAYER_ID = "openradar-custom-fill";
export const CUSTOM_LINE_LAYER_ID = "openradar-custom-line";
export const CUSTOM_POINT_LAYER_ID = "openradar-custom-points";
export const CELL_TRACK_LAYER_ID = "openradar-cell-tracks";
export const CELL_FORECAST_LAYER_ID = "openradar-cell-forecast";
export const CELL_POINT_LAYER_ID = "openradar-cell-points";
export const CELL_LABEL_LAYER_ID = "openradar-cell-labels";

export const PROBSEVERE_LAYER_IDS = [
  PROBSEVERE_FILL_LAYER_ID,
  PROBSEVERE_LINE_LAYER_ID,
];

export const CELL_LAYER_IDS = [
  CELL_TRACK_LAYER_ID,
  CELL_FORECAST_LAYER_ID,
  CELL_POINT_LAYER_ID,
  CELL_LABEL_LAYER_ID,
];

/** Hail sits over rotation, because a hail core is the smaller target. */
export const MRMS_LAYER_IDS = [
  `${MRMS_SOURCE_PREFIX}rotation`,
  `${MRMS_SOURCE_PREFIX}mesh`,
  `${MRMS_SOURCE_PREFIX}lightning`,
  FLASH_LAYER_ID,
  WIND_LAYER_ID,
];

export const TRACK_LAYER_IDS = [TRACK_LINE_LAYER_ID, TRACK_POINT_LAYER_ID];

export const CUSTOM_LAYER_IDS = [
  CUSTOM_FILL_LAYER_ID,
  CUSTOM_LINE_LAYER_ID,
  CUSTOM_POINT_LAYER_ID,
];

export const TOOL_LAYER_IDS = [TOOL_LINE_LAYER_ID, TOOL_POINT_LAYER_ID];

export const RADAR_LANE_LAYER_IDS = [
  `${RADAR_LAYER_ID}-observed`,
  `${RADAR_LAYER_ID}-forecast`,
];

/**
 * Bottom to top, the order every OpenRadar layer belongs in. A layer is added
 * before the first of these that is already on the map, which keeps the stack
 * right no matter which data arrives first.
 *
 * `overlays` is the overlay layers in the arrangement the reader chose, which
 * is the one band of this that moves.
 */
export function layerStackOrder(overlays: readonly string[]): string[] {
  return [
    SATELLITE_LAYER_ID,
    // Surge sits above the satellite and under the radar: it is the ground
    // the weather is happening over, not weather itself.
    SURGE_LAYER_ID,
    ...RADAR_LANE_LAYER_IDS,
    SWEEP_LAYER_ID,
    ...MRMS_LAYER_IDS,
    // What a model expects goes over the pictures it was worked out from and
    // under the warnings a person issued, because guidance belongs under a
    // decision somebody has taken responsibility for.
    ...PROBSEVERE_LAYER_IDS,
    // Shapes the reader imported sit under everything a service published,
    // warnings included. They used to sit above the whole overlay band, which
    // meant a placefile could cover a tornado warning: the one arrangement the
    // panel refuses to let anybody make by hand, reachable by dropping a file
    // on the window.
    ...CUSTOM_LAYER_IDS,
    ...overlays,
    ...TRACK_LAYER_IDS,
    // Cells sit above the pictures they were found in and under the tools the
    // reader draws with: they are the radar's own reading of the storm, and
    // nothing should hide them.
    ...CELL_LAYER_IDS,
    ROUTE_LAYER_ID,
    ...TOOL_LAYER_IDS,
  ];
}

/** Anything a hit test hands back that can be placed in the stack. */
export interface Placed {
  layer: { id: string };
}

/**
 * How high a layer sits, for an order running bottom to top.
 *
 * A layer the order has never heard of counts as being above everything. That
 * is the same miss the insertion anchor makes and the safer one: a layer added
 * without being placed answers clicks rather than being unreachable.
 */
export function stackHeight(order: readonly string[], id: string): number {
  const at = order.indexOf(id);
  return at < 0 ? order.length : at;
}

/**
 * Of everything under the pointer, the one drawn on top.
 *
 * Ties go to the earlier hit, because that is already the topmost one: a hit
 * test hands its results back in draw order, nearest the viewer first. Every
 * alert in the country is drawn by one fill layer, so a tornado warning inside
 * a flood watch is two hits at the same height, and taking the later of them
 * opened the watch.
 */
export function topmost<T extends Placed>(
  hits: readonly T[],
  order: readonly string[],
): T | null {
  let best: T | null = null;
  for (const hit of hits) {
    if (
      !best ||
      stackHeight(order, hit.layer.id) > stackHeight(order, best.layer.id)
    ) {
      best = hit;
    }
  }
  return best;
}

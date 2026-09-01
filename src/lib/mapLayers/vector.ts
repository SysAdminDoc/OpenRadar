import type { MapLike } from "./raster";

/**
 * The layers that are one GeoJSON source and whatever is drawn from it.
 *
 * The route, the imported shapes and a hurricane's track are the same shape
 * three times: a nullable collection decides whether anything is on the map,
 * new data re-fills the source rather than rebuilding it, and switching off
 * takes the layers and the source together. Written out three times they had
 * drifted in the way this kind of code always does. One of them republished
 * the layer list even when it had changed nothing, and one of them did not
 * publish it at all on the way out.
 */

export interface GeoJsonSourceLike {
  setData?: (data: unknown) => void;
}

export interface VectorLane {
  sourceId: string;
  /**
   * What is drawn from the source, bottom first.
   *
   * A function rather than a list, because several of these read a preference
   * that can change under them: a heavier stroke when the reader asks for
   * more contrast, a label in the units they are reading in.
   */
  layers: () => Array<{ id: string } & Record<string, unknown>>;
}

/**
 * Puts one vector lane on the map, refills it, or takes it off.
 *
 * Answers whether the set of layers changed, so the caller republishes the
 * stack when it means something and not when a source was only refilled.
 */
export function syncVectorLane(
  map: MapLike,
  lane: VectorLane,
  data: unknown,
  /** What the lane's first layer goes underneath, which the caller owns. */
  before: (layerId: string) => string | undefined,
): boolean {
  const source = map.getSource(lane.sourceId) as GeoJsonSourceLike | undefined;

  if (!data) {
    if (!source) return false;
    for (const layer of lane.layers()) {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    }
    map.removeSource(lane.sourceId);
    return true;
  }

  if (source) {
    source.setData?.(data);
    return false;
  }

  map.addSource(lane.sourceId, {
    type: "geojson",
    data,
  } as never);
  // Every layer of a lane is placed against the same neighbour, so the lane's
  // own order is the order they are listed in. Asking per layer would let the
  // arrangement decide the order within one lane, which is not its business.
  const beneath = before(lane.layers()[0]?.id ?? lane.sourceId);
  for (const layer of lane.layers()) {
    map.addLayer(layer as never, beneath);
  }
  return true;
}

/**
 * The layers that are one raster source and one layer over it.
 *
 * Satellite and the surge picture are the same shape twice: a nullable value
 * decides whether the layer is on the map at all, a function turns that value
 * into a tile address, and changing the value re-points the source rather
 * than rebuilding it. Written out twice in the viewport they had already
 * drifted, one carrying a maximum zoom and the other not, and each was
 * eighty lines of the component that nothing could test.
 *
 * This takes the smallest part of MapLibre's `Map` the work actually needs,
 * so the whole lifecycle can be exercised against a stand-in.
 */

export interface RasterSourceLike {
  setTiles?: (tiles: string[]) => void;
}

/**
 * The part of MapLibre's `Map` this needs.
 *
 * The real signatures are far more specific and return the map for chaining,
 * so the parameters are widened to `never` here: a structural type has to
 * accept anything the caller will hand it, and this file builds its own
 * arguments rather than passing any through. The point is that a stand-in
 * with six methods satisfies it.
 */
export interface MapLike {
  getSource: (id: string) => unknown;
  addSource: (id: string, source: never) => unknown;
  removeSource: (id: string) => unknown;
  getLayer: (id: string) => unknown;
  addLayer: (layer: never, before?: string) => unknown;
  removeLayer: (id: string) => unknown;
}

export interface RasterLane<T> {
  sourceId: string;
  layerId: string;
  attribution: string;
  /** How opaque the layer is drawn before the reader's own slider. */
  opacity: number;
  /** Past this zoom the service has no tiles and the last ones are stretched. */
  maxZoom?: number;
  /** Where this value's tiles are. */
  tileUrl: (value: NonNullable<T>) => string;
}

/**
 * Puts one raster lane on the map, moves it, or takes it off.
 *
 * Answers whether the set of layers changed, because the caller publishes the
 * stack for the tests and the panel and there is no reason to do that when a
 * source was only re-pointed.
 */
export function syncRasterLane<T>(
  map: MapLike,
  lane: RasterLane<T>,
  value: T | null | undefined,
  /** What this lane goes underneath, which the caller owns. */
  before: (layerId: string) => string | undefined,
): boolean {
  if (value === null || value === undefined) {
    // Switching it off has to take the source with the layer, or the next
    // time it comes on the old tiles are still there behind the new ones.
    if (!map.getSource(lane.sourceId)) return false;
    if (map.getLayer(lane.layerId)) map.removeLayer(lane.layerId);
    map.removeSource(lane.sourceId);
    return true;
  }

  const url = lane.tileUrl(value);
  const source = map.getSource(lane.sourceId) as RasterSourceLike | undefined;
  if (source) {
    // A new time or category is the same lane pointed somewhere else. Building
    // it again would flash the map through empty and lose whatever the reader
    // had arranged above it.
    source.setTiles?.([url]);
    return false;
  }

  map.addSource(lane.sourceId, {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    ...(lane.maxZoom === undefined ? {} : { maxzoom: lane.maxZoom }),
    attribution: lane.attribution,
  } as never);
  map.addLayer(
    {
      id: lane.layerId,
      type: "raster",
      source: lane.sourceId,
      paint: { "raster-opacity": lane.opacity },
    } as never,
    before(lane.layerId),
  );
  return true;
}

import type { MapLike, RasterSourceLike } from "./raster";

/**
 * The two radar lanes, which are kept warm rather than switched off.
 *
 * Every other layer here comes off the map when it has nothing to draw. The
 * radar cannot: the reader is scrubbing a loop, and a lane that removed its
 * source each time the playhead crossed into the other one would refetch
 * every tile of both. So a lane with no frame is faded to nothing and left
 * where it is, and the two hand over by opacity.
 *
 * What does force a new source is a change of provider, tile size or native
 * zoom, because those belong to the source rather than to the address. The
 * key is remembered by the caller, since it is the caller that owns both
 * lanes and knows which is which.
 */

export interface RadarTiles {
  tileUrl: string;
  tileSize: number;
  maxZoom: number;
  attribution: string;
  /** What makes one source a different source rather than a new address. */
  key: string;
}

export interface RadarLanePlan {
  sourceId: string;
  layerId: string;
}

export interface RadarLaneResult {
  /** True when a layer was added, so the caller republishes the stack. */
  added: boolean;
  /** What the lane is drawn at, which the caller reports for the mosaic. */
  opacity: number;
}

/**
 * Puts one radar lane on the map, or fades it out of the way.
 *
 * `tiles` is what the lane should be showing, or null when the other lane has
 * the playhead. `opacity` is what it should be drawn at when it does have
 * something: zero hands the map to the other lane or to a single site's own
 * sweep without taking anything down.
 */
export function syncRadarLane(
  map: MapLike & {
    // Widened the same way the rest of `MapLike` is: the real signature keys
    // the value off the property name, and this file only ever sets two.
    setPaintProperty: (layer: string, property: never, value: never) => unknown;
  },
  plan: RadarLanePlan,
  tiles: RadarTiles | null,
  opacity: number,
  /** The key this lane's source was last built for, or null. */
  heldKey: string | null,
  before: (layerId: string) => string | undefined,
): RadarLaneResult & { key: string | null } {
  let added = false;
  let key = heldKey;

  if (tiles) {
    // Tile size, native zoom and credit belong to the source, so a change of
    // provider inside one lane still means a fresh source.
    if (map.getSource(plan.sourceId) && heldKey !== tiles.key) {
      if (map.getLayer(plan.layerId)) map.removeLayer(plan.layerId);
      map.removeSource(plan.sourceId);
    }
    key = tiles.key;

    const source = map.getSource(plan.sourceId) as RasterSourceLike | undefined;
    if (source) {
      source.setTiles?.([tiles.tileUrl]);
    } else {
      map.addSource(plan.sourceId, {
        type: "raster",
        tiles: [tiles.tileUrl],
        tileSize: tiles.tileSize,
        maxzoom: tiles.maxZoom,
        attribution: tiles.attribution,
      } as never);
      map.addLayer(
        {
          id: plan.layerId,
          type: "raster",
          source: plan.sourceId,
          // Added at nothing and faded up below, so a lane never appears at
          // full for the frame between being added and being told.
          paint: { "raster-opacity": 0 },
        } as never,
        before(plan.layerId),
      );
      added = true;
    }
  }

  const shown = tiles ? opacity : 0;
  if (map.getLayer(plan.layerId)) {
    map.setPaintProperty(
      plan.layerId,
      "raster-opacity" as never,
      shown as never,
    );
    map.setPaintProperty(
      plan.layerId,
      "raster-fade-duration" as never,
      150 as never,
    );
  }
  return { added, opacity: shown, key };
}

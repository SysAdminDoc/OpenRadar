import type { MapLike } from "./raster";

/**
 * A picture pinned to four corners, which is how a single site's sweep is
 * drawn.
 *
 * Not a tile lane: the sweep is one image decoded here, and where it sits
 * moves with the radar it came from. The corners and the image change
 * together, which is the whole reason this is worth stating in one place: a
 * new volume drawn over the previous one's footprint, even for a frame, puts
 * a storm somewhere it was not.
 */

export interface ImageSourceLike {
  updateImage?: (options: {
    url: string;
    coordinates: Array<[number, number]>;
  }) => void;
}

export interface ImageLane {
  sourceId: string;
  layerId: string;
  /** Paint the layer arrives with, before the opacity it is told. */
  paint: Record<string, unknown>;
}

export interface PinnedImage {
  url: string;
  /** Clockwise from the top left, as MapLibre takes them. */
  coordinates: Array<[number, number]>;
  opacity: number;
}

/**
 * Puts one pinned image on the map, moves it, or takes it off.
 *
 * Answers whether the set of layers changed, so the caller republishes the
 * stack when it means something.
 */
export function syncImageLane(
  map: MapLike & {
    setPaintProperty: (layer: string, property: never, value: never) => unknown;
  },
  lane: ImageLane,
  picture: PinnedImage | null,
  /** What the picture goes underneath, which the caller owns. */
  before: (layerId: string) => string | undefined,
): boolean {
  const source = map.getSource(lane.sourceId) as ImageSourceLike | undefined;

  if (!picture) {
    if (!source) return false;
    if (map.getLayer(lane.layerId)) map.removeLayer(lane.layerId);
    map.removeSource(lane.sourceId);
    return true;
  }

  if (source) {
    // Both together, which is what keeps a new volume from being drawn over
    // the previous one's footprint for a frame.
    source.updateImage?.({
      url: picture.url,
      coordinates: picture.coordinates,
    });
    map.setPaintProperty(
      lane.layerId,
      "raster-opacity" as never,
      picture.opacity as never,
    );
    return false;
  }

  map.addSource(lane.sourceId, {
    type: "image",
    url: picture.url,
    coordinates: picture.coordinates,
  } as never);
  map.addLayer(
    {
      id: lane.layerId,
      type: "raster",
      source: lane.sourceId,
      paint: { ...lane.paint, "raster-opacity": picture.opacity },
    } as never,
    before(lane.layerId),
  );
  return true;
}

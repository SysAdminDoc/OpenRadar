import {
  SATELLITE_ATTRIBUTION,
  satelliteProduct,
  satelliteTileUrl,
  type SatelliteProductId,
} from "../providers/satellite";
import { syncRasterLane, type MapLike, type RasterLane } from "./raster";

/**
 * The satellite lane, for whichever GOES-East view is chosen.
 *
 * A lane per product rather than one lane with a switch inside it, because
 * the two are published at different maximum zooms and that is a property of
 * the source rather than of the address.
 */
export function satelliteLane(
  id: SatelliteProductId,
  layerId: string,
): RasterLane<number> {
  const product = satelliteProduct(id);
  return {
    sourceId: "openradar-satellite-source",
    layerId,
    attribution: SATELLITE_ATTRIBUTION,
    opacity: 0.85,
    // MapLibre's own default, which is what this lane has always drawn at: a
    // continuous picture where a short cross-fade between two tiles is a fade
    // between two shades of the same cloud.
    fadeMs: 300,
    maxZoom: product.maxZoom,
    tileUrl: (time) => satelliteTileUrl(time, id),
  };
}

/**
 * Puts the chosen satellite view on the map, moves it, or takes it off.
 *
 * A change of time is the same source pointed at another slot. A change of
 * product is not: a raster source carries its maximum zoom from the moment it
 * is added, so re-pointing a GeoColor source at the infrared band would leave
 * the map asking for a zoom 7 tile the infrared band does not publish, and
 * every one of those comes back 400 and paints nothing. So the source is
 * taken off and put back.
 *
 * Answers which product is now on the map, and whether the set of layers
 * changed, because the caller publishes the stack and there is no reason to
 * do that when a source was only re-pointed.
 */
export function syncSatelliteLane(
  map: MapLike,
  layerId: string,
  drawn: SatelliteProductId,
  wanted: SatelliteProductId,
  time: number | null | undefined,
  before: (layerId: string) => string | undefined,
): { drawn: SatelliteProductId; changed: boolean } {
  let changed = false;
  if (wanted !== drawn) {
    changed = syncRasterLane(map, satelliteLane(drawn, layerId), null, before);
  }
  const added = syncRasterLane(
    map,
    satelliteLane(wanted, layerId),
    time,
    before,
  );
  return { drawn: wanted, changed: changed || added };
}

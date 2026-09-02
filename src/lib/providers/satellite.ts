import type { StringKey } from "../../i18n";

export const SATELLITE_HOST = "gibs.earthdata.nasa.gov";

const WMTS_BASE = `https://${SATELLITE_HOST}/wmts/epsg3857/best`;

/** GIBS publishes both of these on ten-minute boundaries. */
export const SATELLITE_STEP_SECONDS = 600;
/**
 * How far behind real time the newest published image runs. Measured at roughly
 * thirty-five to forty minutes on 2026-08-30, with the hold-back set well past
 * that: asking for a slot that does not exist yet answers 404, which paints
 * nothing and says nothing.
 */
export const SATELLITE_LATENCY_SECONDS = 55 * 60;

export const SATELLITE_ATTRIBUTION =
  '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api">NASA GIBS</a> GOES-East, NOAA NESDIS';

export type SatelliteProductId = "geocolor" | "clean-ir";

export interface SatelliteProduct {
  id: SatelliteProductId;
  /** The GIBS layer, which is also what the address is built from. */
  layer: string;
  /**
   * The matrix set the layer is published in, which is not the same for both:
   * GeoColor goes one zoom deeper than the infrared band does.
   */
  matrixSet: string;
  /** Past this the service has no tiles and the last ones are stretched. */
  maxZoom: number;
  key: StringKey;
  detailKey: StringKey;
  /**
   * What the picture is a picture of, for the legend. GeoColor is a rendering
   * meant to look like the eye sees; the infrared band is a measurement with
   * a scale, and saying which is which is the difference between a pretty
   * image and one somebody can read a storm top off.
   */
  legendKey: StringKey;
}

/**
 * The two GOES-East views this draws.
 *
 * GeoColor is the daytime picture everybody knows and goes effectively dark
 * over storm tops at night, which is exactly when a convective forecast wants
 * to look at them. Band 13 is the 10.3 micron clean infrared window: it
 * measures the temperature of whatever the satellite can see the top of, so a
 * cold anvil reads at night as well as it does at noon. Both come from the
 * same service under the same terms at the same cadence.
 */
export const SATELLITE_PRODUCTS: SatelliteProduct[] = [
  {
    id: "geocolor",
    layer: "GOES-East_ABI_GeoColor",
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
    key: "satellite.geocolor",
    detailKey: "satellite.geocolorDetail",
    legendKey: "satellite.geocolorLegend",
  },
  {
    id: "clean-ir",
    layer: "GOES-East_ABI_Band13_Clean_Infrared",
    // Published one level shallower than GeoColor, so the source has to be
    // rebuilt on a switch rather than pointed somewhere else.
    matrixSet: "GoogleMapsCompatible_Level6",
    maxZoom: 6,
    key: "satellite.cleanIr",
    detailKey: "satellite.cleanIrDetail",
    legendKey: "satellite.cleanIrLegend",
  },
];

export function satelliteProduct(id: SatelliteProductId): SatelliteProduct {
  return (
    SATELLITE_PRODUCTS.find((held) => held.id === id) ?? SATELLITE_PRODUCTS[0]
  );
}

/** The deepest zoom any of them publishes, for a caller sizing one lane. */
export const SATELLITE_MAX_ZOOM = 7;

/**
 * The image that stands for a radar frame: the same instant snapped back to a
 * published slot, and never newer than what GIBS has.
 */
export function satelliteFrameTime(frameTime: number, now: number): number {
  const snap = (value: number) =>
    Math.floor(value / SATELLITE_STEP_SECONDS) * SATELLITE_STEP_SECONDS;
  const newest = snap(now - SATELLITE_LATENCY_SECONDS);
  return Math.min(snap(frameTime), newest);
}

export function satelliteTileUrl(
  time: number,
  id: SatelliteProductId = "geocolor",
): string {
  const stamp = new Date(time * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const product = satelliteProduct(id);
  return `${WMTS_BASE}/${product.layer}/default/${stamp}/${product.matrixSet}/{z}/{y}/{x}.png`;
}

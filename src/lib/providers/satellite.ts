export const SATELLITE_HOST = "gibs.earthdata.nasa.gov";

const TEMPLATE_BASE = `https://${SATELLITE_HOST}/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default`;
const MATRIX_SET = "GoogleMapsCompatible_Level7";

/** GIBS publishes GeoColor on ten-minute boundaries. */
export const SATELLITE_STEP_SECONDS = 600;
/**
 * How far behind real time the newest published image runs. Measured at roughly
 * thirty-five to forty minutes on 2026-08-30, with the hold-back set well past
 * that: asking for a slot that does not exist yet answers 404, which paints
 * nothing and says nothing.
 */
export const SATELLITE_LATENCY_SECONDS = 55 * 60;

export const SATELLITE_ATTRIBUTION =
  '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api">NASA GIBS</a> GOES-East GeoColor, NOAA NESDIS';

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

export function satelliteTileUrl(time: number): string {
  const stamp = new Date(time * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  return `${TEMPLATE_BASE}/${stamp}/${MATRIX_SET}/{z}/{y}/{x}.png`;
}

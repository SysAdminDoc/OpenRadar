import type { StringKey } from "../../i18n";

export const SATELLITE_HOST = "gibs.earthdata.nasa.gov";

const WMTS_BASE = `https://${SATELLITE_HOST}/wmts/epsg3857/best`;

/** GIBS publishes all of these on ten-minute boundaries. */
export const SATELLITE_STEP_SECONDS = 600;
/**
 * How far behind real time the newest published image runs. Measured at roughly
 * thirty-five to forty minutes on 2026-08-30, with the hold-back set well past
 * that: asking for a slot that does not exist yet answers 404, which paints
 * nothing and says nothing.
 */
export const SATELLITE_LATENCY_SECONDS = 55 * 60;

export const SATELLITE_ATTRIBUTION =
  '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api">NASA GIBS</a>, NOAA NESDIS and JMA';

/**
 * The three geostationary satellites GIBS publishes on this endpoint, and
 * where each one hangs.
 *
 * The longitude is the whole reason there are three: a satellite sees the half
 * of the planet under it and looks at everything else edge on, so a reader in
 * Seattle watching the Pacific through GOES-East is looking at a picture taken
 * from over Brazil.
 */
export const SPACECRAFT = ["east", "west", "himawari"] as const;

export type Spacecraft = (typeof SPACECRAFT)[number];

/** Where each one is parked, in degrees east. */
export const SUB_SATELLITE_LONGITUDE: Record<Spacecraft, number> = {
  east: -75.2,
  west: -137.2,
  himawari: 140.7,
};

/** What a reader chooses. Not every satellite carries every one. */
export const SATELLITE_BANDS = [
  "geocolor",
  "clean-ir",
  "red-visible",
  "air-mass",
  "dust",
  "fire-temp",
] as const;

export type SatelliteBandId = (typeof SATELLITE_BANDS)[number];

export function isSatelliteBand(value: unknown): value is SatelliteBandId {
  return SATELLITE_BANDS.includes(value as SatelliteBandId);
}

/** A satellite and a band together, which is what one lane draws. */
export type SatelliteProductId = `${Spacecraft}:${SatelliteBandId}`;

export interface SatelliteProduct {
  id: SatelliteProductId;
  spacecraft: Spacecraft;
  band: SatelliteBandId;
  /** The GIBS layer, which is also what the address is built from. */
  layer: string;
  /**
   * The matrix set the layer is published in, which is not the same for all of
   * them: GeoColor goes one zoom deeper than the infrared band does.
   */
  matrixSet: string;
  /** Past this the service has no tiles and the last ones are stretched. */
  maxZoom: number;
}

interface BandDescription {
  id: SatelliteBandId;
  key: StringKey;
  detailKey: StringKey;
  /**
   * What the picture is a picture of, for the legend. GeoColor is a rendering
   * meant to look like the eye sees; the infrared band is a measurement with
   * a scale, and saying which is which is the difference between a pretty
   * image and one somebody can read a storm top off.
   */
  legendKey: StringKey;
  /** How the GIBS layer name spells this band, per satellite family. */
  goes: string;
  /**
   * Himawari's own spelling, or null where it does not publish this band on
   * this endpoint. Its visible band is 3 rather than 2, and it publishes no
   * GeoColor, dust or fire temperature here.
   */
  ahi: string | null;
  matrixSet: string;
  maxZoom: number;
}

/**
 * The bands, with what each satellite calls them.
 *
 * Verified against the GIBS WMTS capabilities on 2026-09-03, matrix set and
 * all: a layer asked for in a matrix set it is not published in answers 400
 * for every tile, which draws nothing and says nothing.
 */
const BANDS: BandDescription[] = [
  {
    id: "geocolor",
    key: "satellite.geocolor",
    detailKey: "satellite.geocolorDetail",
    legendKey: "satellite.geocolorLegend",
    goes: "GeoColor",
    ahi: null,
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
  },
  {
    id: "clean-ir",
    key: "satellite.cleanIr",
    detailKey: "satellite.cleanIrDetail",
    legendKey: "satellite.cleanIrLegend",
    goes: "Band13_Clean_Infrared",
    ahi: "Band13_Clean_Infrared",
    matrixSet: "GoogleMapsCompatible_Level6",
    maxZoom: 6,
  },
  {
    id: "red-visible",
    key: "satellite.redVisible",
    detailKey: "satellite.redVisibleDetail",
    legendKey: "satellite.redVisibleLegend",
    goes: "Band2_Red_Visible_1km",
    // Himawari's visible band is 3, not 2. Named per family rather than
    // patched at the call site, because the difference is the whole reason
    // this table has two columns.
    ahi: "Band3_Red_Visible_1km",
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
  },
  {
    id: "air-mass",
    key: "satellite.airMass",
    detailKey: "satellite.airMassDetail",
    legendKey: "satellite.airMassLegend",
    goes: "Air_Mass",
    ahi: "Air_Mass",
    matrixSet: "GoogleMapsCompatible_Level6",
    maxZoom: 6,
  },
  {
    id: "dust",
    key: "satellite.dust",
    detailKey: "satellite.dustDetail",
    legendKey: "satellite.dustLegend",
    goes: "Dust",
    ahi: null,
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
  },
  {
    id: "fire-temp",
    key: "satellite.fireTemp",
    detailKey: "satellite.fireTempDetail",
    legendKey: "satellite.fireTempLegend",
    goes: "FireTemp",
    ahi: null,
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
  },
];

export function satelliteBands(): BandDescription[] {
  return BANDS;
}

export function satelliteBand(id: SatelliteBandId): BandDescription {
  return BANDS.find((band) => band.id === id) ?? BANDS[0];
}

/** Whether a satellite publishes a band at all. */
export function publishes(
  spacecraft: Spacecraft,
  id: SatelliteBandId,
): boolean {
  const band = satelliteBand(id);
  return spacecraft === "himawari" ? band.ahi !== null : true;
}

/**
 * The band a satellite will actually draw for a reader's choice.
 *
 * Himawari carries three of the six, so a reader who chose GeoColor over the
 * Gulf and then panned to Japan has asked for something that is not there.
 * Clean infrared is what they get instead: it is the one band every satellite
 * has, it works at night, and the legend says which band is on screen rather
 * than leaving the panel and the map disagreeing.
 */
export function bandFor(
  spacecraft: Spacecraft,
  wanted: SatelliteBandId,
): SatelliteBandId {
  return publishes(spacecraft, wanted) ? wanted : "clean-ir";
}

/**
 * Which satellite is looking most nearly straight down at a longitude.
 *
 * Nearest sub-satellite point, wrapped, which puts the GOES-East and GOES-West
 * boundary at 106.2 degrees west and the GOES-West and Himawari one just short
 * of the date line. A reader over a disk's edge gets a picture taken at a
 * glancing angle whatever this chooses; a reader off every disk gets nothing,
 * which is the truth about what these three can see.
 */
export function spacecraftFor(longitude: number): Spacecraft {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  let best: Spacecraft = "east";
  let nearest = Number.POSITIVE_INFINITY;
  for (const spacecraft of SPACECRAFT) {
    const apart = Math.abs(
      ((((wrapped - SUB_SATELLITE_LONGITUDE[spacecraft] + 180) % 360) + 360) %
        360) -
        180,
    );
    if (apart < nearest) {
      nearest = apart;
      best = spacecraft;
    }
  }
  return best;
}

export function satelliteProductId(
  spacecraft: Spacecraft,
  band: SatelliteBandId,
): SatelliteProductId {
  return `${spacecraft}:${bandFor(spacecraft, band)}`;
}

/** The lane's product, taken apart again. */
export function satelliteProduct(id: SatelliteProductId): SatelliteProduct {
  const [held, wanted] = id.split(":");
  const spacecraft = (SPACECRAFT as readonly string[]).includes(held)
    ? (held as Spacecraft)
    : "east";
  const chosen = bandFor(
    spacecraft,
    isSatelliteBand(wanted) ? wanted : "geocolor",
  );
  const band = satelliteBand(chosen);
  return {
    id: `${spacecraft}:${chosen}`,
    spacecraft,
    band: chosen,
    layer:
      spacecraft === "himawari"
        ? `Himawari_AHI_${band.ahi}`
        : `GOES-${spacecraft === "west" ? "West" : "East"}_ABI_${band.goes}`,
    matrixSet: band.matrixSet,
    maxZoom: band.maxZoom,
  };
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
  id: SatelliteProductId = "east:geocolor",
): string {
  const stamp = new Date(time * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const product = satelliteProduct(id);
  return `${WMTS_BASE}/${product.layer}/default/${stamp}/${product.matrixSet}/{z}/{y}/{x}.png`;
}

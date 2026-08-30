import { createWmsProvider } from "./wms";
import type { BoundingBox } from "./types";

export const GEOMET_HOST = "geo.weather.gc.ca";

/**
 * Environment and Climate Change Canada's radar, through GeoMet.
 *
 * The NOAA mosaics stop at the border and RainViewer is personal-use only, so
 * Canada had no radar at all. GeoMet is keyless, publishes a one kilometre
 * composite every six minutes, and keeps three hours of it.
 *
 * It reports precipitation rate in millimetres an hour rather than
 * reflectivity in dBZ, which is a different quantity: the legend has to change
 * with it rather than keep showing a dBZ scale over a rain-rate picture.
 */
export const geometProvider = createWmsProvider({
  id: "geomet",
  label: "ECCC GeoMet",
  attribution:
    '<a href="https://eccc-msc.github.io/open-data/licence/readme_en/">Environment and Climate Change Canada</a>',
  attributionUrl: "https://eccc-msc.github.io/open-data/licence/readme_en/",
  host: GEOMET_HOST,
  owsUrl: "https://geo.weather.gc.ca/geomet",
  layer: "RADAR_1KM_RRAI",
  // Canada and its approaches, stopping short of the NOAA mosaics rather than
  // overlapping them: the chain reaches here only where they do not cover.
  coverage: [{ west: -141, south: 41.5, east: -52, north: 70 }],
  tileBudgetLimit: 2000,
  discoveryBudgetLimit: 20,
  budgetWindowMs: 60_000,
  maxZoom: 11,
  // Three hours at six minutes, which is everything GeoMet keeps.
  maxFrames: 30,
  // GeoMet refuses an instant carrying milliseconds, and answers with a
  // service exception rather than a tile.
  timeFormat: "seconds",
});

/**
 * Where GeoMet is the right answer even though a NOAA mosaic also reaches.
 *
 * The mosaics are drawn over a rectangle that takes in a good deal of Canada,
 * so a fallback alone would leave Vancouver and Winnipeg on American radar.
 * The border is not a rectangle, though, and a box drawn generously enough to
 * hold southern Ontario also holds Michigan and Ohio.
 *
 * So the rule is the other way round: every box below has to be provably
 * Canadian, and the border does not make that easy. It is not the forty-ninth
 * parallel all the way: the Alaska Panhandle reaches down the coast to
 * fifty-four and a half, well east of the hundred and forty-first meridian,
 * and Minnesota's Northwest Angle pokes north of forty-nine at ninety-five
 * degrees west. A box drawn to the parallel takes both.
 *
 * What that leaves out is the outer British Columbia coast, the populated
 * strip along the lakes, and the lower Saint Lawrence. Those fall through to
 * the ordinary chain, which reaches them: the NOAA mosaics cover the lakes and
 * the Pacific Northwest, and past the mosaics' eastern edge GeoMet is picked
 * up as the coverage fallback anyway.
 */
const CANADA: BoundingBox[] = [
  // Yukon, the Northwest Territories, and Nunavut. Alaska's mainland is west
  // of the hundred and forty-first meridian, and its Panhandle stops short of
  // sixty, so nothing here is American.
  { west: -141, south: 60.0, east: -95, north: 84 },
  // The interior west, from the coast range to Lake of the Woods. The eastern
  // edge stops short of Minnesota's Northwest Angle, which is the one piece of
  // the lower forty-eight north of the forty-ninth parallel, and the western
  // edge stops short of the Alaska Panhandle, which costs the outer coast.
  { west: -130, south: 49.0, east: -95.2, north: 60 },
  // Northern Ontario and Quebec, above the Angle and well clear of Michigan
  // and New York.
  { west: -95.2, south: 49.4, east: -66.9, north: 84 },
  // East of Maine, which is the easternmost American land there is, so this
  // one can run all the way down.
  { west: -66.9, south: 41, east: -52, north: 84 },
];

/** True where GeoMet should lead rather than merely fill a gap. */
export function isCanadianViewport(lon: number, lat: number): boolean {
  return CANADA.some(
    (box) =>
      lat >= box.south &&
      lat <= box.north &&
      lon >= box.west &&
      lon <= box.east,
  );
}

/**
 * The scale ECCC draws its own tiles with, read off the legend the service
 * publishes at
 * `geo.weather.gc.ca/geomet?request=GetLegendGraphic&layer=RADAR_1KM_RRAI`.
 * Sampled rather than invented, so the legend on screen describes the picture
 * rather than a guess at it. Resample it if ECCC restyles the layer.
 */
export const RAIN_RATE_RAMP: Array<[number, string]> = [
  [0.1, "#98cbfe"],
  [1, "#00a5eb"],
  [2, "#00f14c"],
  [4, "#00ba00"],
  [8, "#008100"],
  [12, "#8ab800"],
  [16, "#fedc00"],
  [24, "#fea500"],
  [32, "#fe6c00"],
  [50, "#fe0400"],
  [64, "#fa049b"],
  [100, "#922cc5"],
  [125, "#590085"],
  [200, "#31004a"],
];

/** The stops the legend labels, which is fewer than the ramp has. */
export const RAIN_RATE_STOPS = [1, 8, 24, 64, 200];

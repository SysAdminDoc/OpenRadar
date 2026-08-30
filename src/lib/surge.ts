/**
 * How far storm surge could reach, for a hurricane of a given strength.
 *
 * This is not a forecast. NOAA built these maps by running tens of thousands
 * of simulated hurricanes at every stretch of coast and keeping the worst
 * water each one produced, so what they show is what a category could do at
 * high tide, not what any particular storm will do. That distinction is the
 * whole point of the layer, and the legend says it in as many words.
 *
 * They come from the National Hurricane Center's map service as a picture per
 * category, drawn per region, which is why one category names several layers.
 */
import { translate, type StringKey } from "../i18n";
import { formatHeight } from "./units";

const SERVICE =
  "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/StormSurgeRisk/MapServer/export";

export const SURGE_ATTRIBUTION =
  '<a href="https://www.nhc.noaa.gov/nationalsurge/">NOAA National Hurricane Center</a>';

export type SurgeCategory = 1 | 2 | 3 | 4 | 5;

export const SURGE_CATEGORIES: SurgeCategory[] = [1, 2, 3, 4, 5];

/**
 * The image layers behind each category, taken from the service's own tree.
 *
 * A category is mapped separately for every coast NOAA covers, and the coasts
 * do not all go to five: Southern California stops at two and Hawaii at four,
 * because a stronger hurricane has never been simulated as reaching them.
 */
const IMAGE_LAYERS: Record<SurgeCategory, number[]> = {
  1: [5, 26, 47, 68, 90, 107, 116, 137],
  2: [9, 30, 51, 72, 94, 111, 120, 141],
  3: [13, 34, 55, 76, 98, 124, 145],
  4: [17, 38, 59, 80, 102, 128, 149],
  5: [21, 42, 63, 84, 132, 153],
};

/**
 * What the colours on the picture mean, which is depth of water on the ground.
 *
 * The depth is held in feet, because that is what the National Hurricane
 * Center publishes the picture in, and written out in the reader's own units
 * when the legend is drawn.
 */
export const SURGE_RAMP: Array<[colour: string, feet: number, over: boolean]> =
  [
    ["#c6dbef", 3, false],
    ["#6baed6", 3, true],
    ["#2171b5", 6, true],
    ["#08306b", 9, true],
  ];

/** One line of that legend, in the units the reader asked for. */
export function surgeDepthLabel(feet: number, over: boolean): string {
  return translate(over ? "surge.over" : "surge.upTo", {
    depth: formatHeight(feet),
  });
}

export function surgeCategoryKey(category: SurgeCategory): StringKey {
  return `surge.category${category}` as StringKey;
}

export function isSurgeCategory(value: unknown): value is SurgeCategory {
  return (
    value === 1 || value === 2 || value === 3 || value === 4 || value === 5
  );
}

/**
 * The address the map asks for one screenful of the picture.
 *
 * MapLibre fills in `{bbox-epsg-3857}` per tile, and the ArcGIS export
 * endpoint takes the same four numbers in the same order, so a map service
 * with no tile cache behind it still behaves like an ordinary raster source.
 */
export function surgeTileUrl(category: SurgeCategory): string {
  const layers = IMAGE_LAYERS[category];
  const query = new URLSearchParams({
    bbox: "{bbox-epsg-3857}",
    bboxSR: "3857",
    imageSR: "3857",
    size: "256,256",
    dpi: "96",
    format: "png32",
    transparent: "true",
    layers: `show:${layers.join(",")}`,
    f: "image",
  });
  // The braces are what MapLibre substitutes, and encoding them would leave it
  // asking the service for a bounding box called "{bbox-epsg-3857}".
  return `${SERVICE}?${query.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

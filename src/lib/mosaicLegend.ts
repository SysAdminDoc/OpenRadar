import type { StringKey } from "../i18n";
import type { LegendScaleId } from "./legend";
import type { ProviderId } from "./providers/types";

/** What the bar beside the map says, for a mosaic rather than a sweep. */
export interface MosaicLegend {
  scale: LegendScaleId;
  /** The quantity being drawn, which decides whether a colour table applies. */
  unit: string;
  labelKey: StringKey;
}

/**
 * Which scale describes the picture a given source draws.
 *
 * Not every mosaic is reflectivity in dBZ, and not every reflectivity mosaic
 * is painted with the same ramp. Canada's is a rain rate in millimetres an
 * hour, which is a different quantity: a dBZ scale over it would be describing
 * something the picture does not show. Germany's is reflectivity but on its
 * own colours, blue and then magenta past fifty decibels for hail, so the
 * American ramp beside it would be a bar that does not match the map.
 *
 * Written as a lookup rather than as conditions inside the chrome, because a
 * source added later has to have somewhere to say what it draws, and because
 * the answer is worth being able to check.
 */
export function mosaicLegend(providerId: ProviderId | undefined): MosaicLegend {
  switch (providerId) {
    case "geomet":
      return { scale: "rain-rate", unit: "mm/h", labelKey: "chrome.rainRate" };
    case "dwd":
      return {
        scale: "dwd-reflectivity",
        unit: "dBZ",
        labelKey: "chrome.dwdComposite",
      };
    default:
      return {
        scale: "reflectivity",
        unit: "dBZ",
        labelKey: "chrome.composite",
      };
  }
}

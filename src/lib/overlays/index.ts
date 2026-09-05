import { alertsOverlay } from "./alerts";
import { spcDiscussionsOverlay, spcOutlooksOverlay } from "./spc";
import { stormReportsOverlay } from "./reports";
import { earthquakesOverlay } from "./earthquakes";
import { tropicalOverlay } from "./tropical";
import { wildfiresOverlay } from "./wildfires";
import { smokeOverlay } from "./smoke";
import { metarOverlay } from "./metar";
import { riverGaugesOverlay } from "./rivers";
import { wpcExcessiveRainOverlay, wpcWinterSeverityOverlay } from "./wpc";
import type {
  OverlayAdapter,
  OverlayChoices,
  OverlayData,
  OverlayId,
  OverlayLegend,
} from "./registry";

export const OVERLAY_ADAPTERS: OverlayAdapter[] = [
  alertsOverlay,
  spcOutlooksOverlay,
  spcDiscussionsOverlay,
  stormReportsOverlay,
  earthquakesOverlay,
  wildfiresOverlay,
  smokeOverlay,
  metarOverlay,
  riverGaugesOverlay,
  tropicalOverlay,
  wpcExcessiveRainOverlay,
  wpcWinterSeverityOverlay,
];

export function overlayAdapter(id: OverlayId): OverlayAdapter {
  const adapter = OVERLAY_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`overlayAdapter has no adapter for ${id}.`);
  return adapter;
}

export { alertSeverity, SEVERITY_COLOR, SEVERITY_RANK } from "./alerts";
export { stormCategory, type TropicalKind } from "./tropical";
export { parseDiscussions, parseOutlooks, outlookTime } from "./spc";
export { parseReports, REPORT_HOURS } from "./reports";
export { parseSmoke, smokeUrl, type SmokeDensity } from "./smoke";
export {
  parseGauges,
  gaugeUrl,
  FLOOD_CATEGORIES,
  FLOOD_COLOR,
  GAUGE_MIN_ZOOM,
  type FloodCategory,
} from "./rivers";
export {
  parseMetars,
  thinStations,
  METAR_SPACING,
  METAR_MIN_ZOOM,
} from "./metar";
export { ERO_DAYS, WSSI_DAYS, band, wpcTime } from "./wpc";
export {
  DEFAULT_OVERLAY_CHOICES,
  EMPTY_OVERLAY,
  boundsContain,
  boundsOverlap,
  featureBounds,
  padBounds,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayChoices,
  type OverlayData,
  type OverlayDescription,
  type OverlayBand,
  type OverlayFeature,
  type OverlayId,
  type OverlayLegend,
} from "./registry";

/**
 * The keys for every layer on screen that has bands, in the order the layers
 * are drawn.
 *
 * A reader with three banded layers on has three sets of colours and, until
 * this, nothing naming any of them. Built from what is actually drawn rather
 * than from the switches: a layer that is on but whose snapshot has not
 * arrived, or covers somewhere else, has no bands on screen and so no key.
 */
export function overlayLegends(
  states: Record<OverlayId, { data: OverlayData }>,
  choices: OverlayChoices,
): OverlayLegend[] {
  const keys: OverlayLegend[] = [];
  for (const adapter of OVERLAY_ADAPTERS) {
    const legend = adapter.legend?.(states[adapter.id].data, choices);
    if (legend && legend.bands.length > 0) keys.push(legend);
  }
  return keys;
}

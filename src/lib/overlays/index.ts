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
import type { OverlayAdapter, OverlayId } from "./registry";

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
  type OverlayFeature,
  type OverlayId,
} from "./registry";

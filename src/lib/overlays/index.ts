import { alertsOverlay } from "./alerts";
import { spcDiscussionsOverlay, spcOutlooksOverlay } from "./spc";
import { stormReportsOverlay } from "./reports";
import { earthquakesOverlay } from "./earthquakes";
import { tropicalOverlay } from "./tropical";
import { wildfiresOverlay } from "./wildfires";
import { smokeOverlay } from "./smoke";
import { metarOverlay } from "./metar";
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
  tropicalOverlay,
];

export function overlayAdapter(id: OverlayId): OverlayAdapter {
  const adapter = OVERLAY_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`No overlay adapter for ${id}.`);
  return adapter;
}

export type OverlaySnapshot = {
  id: OverlayId;
  data: import("./registry").OverlayData;
  fetchedAt: number;
  bounds: import("./registry").OverlayBounds;
  stale: boolean;
};

export { alertSeverity, SEVERITY_COLOR, SEVERITY_RANK } from "./alerts";
export { stormCategory, type TropicalKind } from "./tropical";
export { parseDiscussions, parseOutlooks, outlookTime } from "./spc";
export { parseReports, REPORT_HOURS } from "./reports";
export { parseSmoke, smokeUrl, type SmokeDensity } from "./smoke";
export { parseMetars, METAR_LIMIT, METAR_MIN_ZOOM } from "./metar";
export {
  EMPTY_OVERLAY,
  boundsContain,
  boundsOverlap,
  featureBounds,
  padBounds,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayDescription,
  type OverlayFeature,
  type OverlayId,
} from "./registry";

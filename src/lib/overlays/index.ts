import { alertsOverlay } from "./alerts";
import { earthquakesOverlay } from "./earthquakes";
import { wildfiresOverlay } from "./wildfires";
import type { OverlayAdapter, OverlayId } from "./registry";

export const OVERLAY_ADAPTERS: OverlayAdapter[] = [
  alertsOverlay,
  earthquakesOverlay,
  wildfiresOverlay,
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

import { useMemo } from "react";
import type { SurfaceId } from "../components/CommandBar";
import type { ToastMessage } from "../components/ToastHost";
import type { OverlayBounds, OverlayData, OverlayId } from "../lib/overlays";
import type { AppSettings } from "../lib/settings";
import { watchAlertBody } from "../lib/watch";
import { useAlertWatch } from "./useAlertWatch";
import { useOverlays, type OverlayStates } from "./useOverlays";

export interface WorkspaceOverlays {
  /** Fetch state per layer, including the ones that are switched off. */
  states: OverlayStates;
  /** What the map should draw: null for a layer the user has switched off. */
  data: Partial<Record<OverlayId, OverlayData | null>>;
}

/**
 * Ties the layer switches to the fetchers and to the watched area, so the
 * workspace only has to hand over settings and the current viewport.
 */
export function useWorkspaceOverlays(options: {
  settings: AppSettings;
  viewport: OverlayBounds | null;
  pushToast: (message: Omit<ToastMessage, "id">) => void;
  setActiveSurface: (surface: SurfaceId) => void;
}): WorkspaceOverlays {
  const { settings, viewport, pushToast, setActiveSurface } = options;
  const { weatherAlerts, earthquakes, wildfires, tropical } = settings.layers;
  const { spcOutlooks, spcDiscussions } = settings.layers;

  const toggles = useMemo(
    () => ({
      alerts: weatherAlerts,
      earthquakes,
      wildfires,
      tropical,
      spcOutlooks,
      spcDiscussions,
    }),
    [
      earthquakes,
      spcDiscussions,
      spcOutlooks,
      tropical,
      weatherAlerts,
      wildfires,
    ],
  );

  const states = useOverlays(toggles, viewport);

  useAlertWatch(settings.watch, (alert) =>
    pushToast({
      title: alert.headline,
      detail: watchAlertBody(alert),
      actionLabel: "Show",
      onAction: () => setActiveSurface("alerts"),
    }),
  );

  const data = useMemo(
    () => ({
      alerts: toggles.alerts ? states.alerts.data : null,
      earthquakes: toggles.earthquakes ? states.earthquakes.data : null,
      wildfires: toggles.wildfires ? states.wildfires.data : null,
      tropical: toggles.tropical ? states.tropical.data : null,
      spcOutlooks: toggles.spcOutlooks ? states.spcOutlooks.data : null,
      spcDiscussions: toggles.spcDiscussions
        ? states.spcDiscussions.data
        : null,
    }),
    [states, toggles],
  );

  return { states, data };
}

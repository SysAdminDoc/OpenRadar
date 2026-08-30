import { useMemo } from "react";
import type { SurfaceId } from "../components/CommandBar";
import type { ToastMessage } from "../components/ToastHost";
import type { OverlayBounds, OverlayData, OverlayId } from "../lib/overlays";
import type { AppSettings } from "../lib/settings";
import { watchAlertBody } from "../lib/watch";
import { useAlertWatch } from "./useAlertWatch";
import { useOverlays, type OverlayStates } from "./useOverlays";
import { alertsOfKind } from "../lib/overlays/alerts";

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
  /** True while archive radar from another day is on the map. */
  replaying: boolean;
  pushToast: (message: Omit<ToastMessage, "id">) => void;
  setActiveSurface: (surface: SurfaceId) => void;
}): WorkspaceOverlays {
  const { settings, viewport, pushToast, setActiveSurface, replaying } =
    options;
  const { weatherAlerts, earthquakes, wildfires, tropical } = settings.layers;
  const { spcOutlooks, spcDiscussions, stormReports } = settings.layers;

  const toggles = useMemo(
    () => ({
      alerts: weatherAlerts,
      earthquakes,
      wildfires,
      tropical,
      // The Storm Prediction Center publishes what it thinks about today, and
      // a replay is showing some other day's weather. Painting this morning's
      // risk over Katrina would be worse than showing nothing.
      spcOutlooks: spcOutlooks && !replaying,
      spcDiscussions: spcDiscussions && !replaying,
      stormReports: stormReports && !replaying,
    }),
    [
      earthquakes,
      spcDiscussions,
      replaying,
      spcOutlooks,
      stormReports,
      tropical,
      weatherAlerts,
      wildfires,
    ],
  );

  const states = useOverlays(toggles, viewport);

  // The kinds the reader switched off are switched off everywhere. The panel
  // lists what the map draws, and the notification's own action opens that
  // panel: announcing a kind the panel will not show sends somebody to an
  // empty list, and the switch says it takes the kind off the map and out of
  // the list.
  useAlertWatch(settings.watch, settings.alertTypes, (alert) =>
    pushToast({
      title: alert.headline,
      detail: watchAlertBody(alert),
      actionLabel: "Show",
      onAction: () => setActiveSurface("alerts"),
    }),
  );

  // The kinds a reader has switched off, taken out here rather than in the
  // fetch, so turning one back on redraws rather than waiting on the service.
  const shown = useMemo(
    () =>
      states.alerts.data
        ? alertsOfKind(states.alerts.data, settings.alertTypes)
        : null,
    [settings.alertTypes, states.alerts.data],
  );

  const data = useMemo(
    () => ({
      alerts: toggles.alerts ? shown : null,
      earthquakes: toggles.earthquakes ? states.earthquakes.data : null,
      wildfires: toggles.wildfires ? states.wildfires.data : null,
      tropical: toggles.tropical ? states.tropical.data : null,
      spcOutlooks: toggles.spcOutlooks ? states.spcOutlooks.data : null,
      spcDiscussions: toggles.spcDiscussions
        ? states.spcDiscussions.data
        : null,
      stormReports: toggles.stormReports ? states.stormReports.data : null,
    }),
    [shown, states, toggles],
  );

  // The panel lists what the map draws, so it reads the filtered set too.
  const states_ = useMemo(
    () => ({
      ...states,
      alerts: { ...states.alerts, data: shown ?? states.alerts.data },
    }),
    [shown, states],
  );

  return { states: states_, data };
}

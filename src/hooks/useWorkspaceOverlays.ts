import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceId } from "../components/CommandBar";
import type { ToastMessage } from "../components/ToastHost";
import type { OverlayBounds, OverlayData, OverlayId } from "../lib/overlays";
import { watchedPlaces, type AppSettings } from "../lib/settings";
import { watchAlertBody, type WatchAlert } from "../lib/watch";
import { useAlertWatch } from "./useAlertWatch";
import { useOverlays, type OverlayStates } from "./useOverlays";
import { alertsOfKind } from "../lib/overlays/alerts";
import { METAR_MIN_ZOOM } from "../lib/overlays/metar";
import { GAUGE_MIN_ZOOM } from "../lib/overlays/rivers";
import { translate } from "../i18n";

export interface WorkspaceOverlays {
  /** Fetch state per layer, including the ones that are switched off. */
  states: OverlayStates;
  /** What the map should draw: null for a layer the user has switched off. */
  data: Partial<Record<OverlayId, OverlayData | null>>;
  /** Raises one harmless alert, so the reader can see the path works. */
  sendWatchTest: () => Promise<boolean>;
  /**
   * The last alert the watch announced, as one sentence for a live region,
   * with a count so that two identical sentences are still two announcements.
   *
   * A toast is a picture. This is the same news for somebody who is not
   * looking at one, and it is fed from the same decision so the two cannot
   * disagree about what was worth interrupting for.
   */
  announcement: { said: number; text: string };
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
  /**
   * Every alert the watch decided was worth saying, for a caller that wants
   * to do something with the map about it.
   *
   * The same decision the toast and the live region are made from, so a
   * followed warning is a warning the reader was told about rather than a
   * second, quieter rule about which ones matter.
   */
  onAnnounced?: (alert: WatchAlert) => void;
}): WorkspaceOverlays {
  const { settings, viewport, pushToast, setActiveSurface, replaying } =
    options;
  const {
    weatherAlerts,
    earthquakes,
    wildfires,
    tropical,
    smoke,
    metar,
    riverGauges,
  } = settings.layers;
  const zoom = settings.camera.zoom;
  const { spcOutlooks, spcDiscussions, stormReports } = settings.layers;

  const toggles = useMemo(
    () => ({
      // A current warning over an old radar volume is a false historical
      // claim. The switch stays as the reader left it and returns with live.
      alerts: weatherAlerts && !replaying,
      earthquakes,
      wildfires,
      tropical,
      // Today's smoke analysis over a replay of some other day is the same
      // false claim the warnings and the outlooks are held back for.
      smoke: smoke && !replaying,
      // And a surface observation from ten minutes ago over a picture of
      // 2011 is the same claim again. The zoom is in it too, because this is
      // the one feed that answers per station: a continent's worth at once is
      // both unreadable and a request nobody wanted.
      metar: metar && !replaying && zoom >= METAR_MIN_ZOOM,
      // A river reading is current the same way a surface observation is, so
      // it is held back over a replay for the same reason, and it answers per
      // gauge rather than per area so it waits for a view close enough to
      // read as well.
      riverGauges: riverGauges && !replaying && zoom >= GAUGE_MIN_ZOOM,
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
      metar,
      riverGauges,
      smoke,
      spcOutlooks,
      zoom,
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
  /**
   * The last announcement, with a number nobody reads.
   *
   * A live region announces a change, and two different alerts can produce
   * the same sentence: `watchAlertBody` rounds the distance to a whole mile,
   * so two tornado warnings from the same storm complex over the same watched
   * place read identically. React would bail out of the identical setState,
   * the text node would not change, and the second warning would be heard
   * zero times while the sighted reader got a second toast. The count makes
   * every announcement its own value; the region is keyed on it and reads
   * only the sentence.
   */
  const [announcement, setAnnouncement] = useState({ said: 0, text: "" });
  const announcedRef = useRef(options.onAnnounced);
  useEffect(() => {
    announcedRef.current = options.onAnnounced;
  }, [options.onAnnounced]);

  const announce = useCallback((alert: WatchAlert) => {
    const text = translate("nearby.announcement", {
      headline: alert.headline,
      body: watchAlertBody(alert),
    });
    setAnnouncement((was) => ({ said: was.said + 1, text }));
    announcedRef.current?.(alert);
  }, []);

  const watch = useAlertWatch(
    watchedPlaces(settings),
    settings.alertTypes,
    (alert) =>
      pushToast({
        title: alert.headline,
        detail: watchAlertBody(alert),
        actionLabel: translate("toast.show"),
        onAction: () => setActiveSurface("alerts"),
      }),
    announce,
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
      smoke: toggles.smoke ? states.smoke.data : null,
      metar: toggles.metar ? states.metar.data : null,
      riverGauges: toggles.riverGauges ? states.riverGauges.data : null,
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

  return { states: states_, data, sendWatchTest: watch.sendTest, announcement };
}

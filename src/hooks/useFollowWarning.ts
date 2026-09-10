import type { OverlayData } from "../lib/overlays";
import type { RefObject } from "react";
import type { ToastMessage } from "../components/ToastHost";
import type { AppSettings } from "../lib/settings";
import type { MapViewportHandle } from "../components/MapViewport";
import type { OverlayBounds } from "../lib/overlays";
import { alertId, type WatchAlert } from "../lib/watch";
import { featureBounds } from "../lib/overlays";
import { translate } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long the map is left alone after the reader last moved it.
 *
 * Long enough that a warning does not interrupt somebody mid-look, short
 * enough that the next one still finds them.
 */
const FOLLOW_QUIET_MS = 20_000;

/**
 * The announcement, held until the polygon it is about has arrived.
 *
 * Two halves because of when each can run: the watch that announces a
 * warning is inside the hook that produces the alerts, so the callback has
 * to exist before that hook is called, and the flight needs the polygon,
 * which reaches the workspace on the render after. So this is declared
 * first and the effect below is called last.
 *
 * The alert is held in a ref and the effect is woken by a counter, because
 * the effect consumes it: clearing a piece of state from inside the effect
 * that reads it is a cascading render, and clearing a ref is not.
 */
export function useFollowSignal() {
  const pending = useRef<WatchAlert | null>(null);
  const [signal, setSignal] = useState(0);
  const remember = useCallback((alert: WatchAlert) => {
    pending.current = alert;
    setSignal((was) => was + 1);
  }, []);
  /**
   * The announcement, spent. One flight per announcement, whatever happens.
   *
   * Cleared here rather than by the caller, because the effect that reads this
   * is woken by more than the signal that fills it: an export finishing is
   * enough to run it again, and an announcement left sitting would fly the map
   * back to a warning minutes after it was announced, with nothing new having
   * happened. Spent even when the flight cannot be made, for the same reason.
   */
  const take = useCallback(() => {
    const held = pending.current;
    pending.current = null;
    return held;
  }, []);
  return { signal, remember, take };
}

export interface FollowWarningOptions {
  /** Bumped once per announcement, which is what wakes this. */
  signal: number;
  /** Takes the announcement and spends it. */
  take: () => WatchAlert | null;
  /** The warnings on the map now, which is where the polygon is found. */
  alerts: OverlayData | null | undefined;
  exportBusy: string | null;
  settingsRef: { current: AppSettings };
  onSettings: (next: AppSettings) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  mapRef: RefObject<MapViewportHandle | null>;
}

/**
 * Takes the map to a warning as it arrives, when the reader asked for that.
 *
 * Called last in the workspace, because the polygon it flies to reaches the
 * page on the render after the watch announced the warning.
 */
export function useFollowWarning({
  signal,
  take,
  alerts,
  exportBusy,
  settingsRef,
  onSettings: applySettings,
  pushToast,
  mapRef,
}: FollowWarningOptions): void {
  // The flight happens here rather than where the alert is announced, because
  // the watch speaks the moment it sees a warning and the polygon it is about
  // reaches this component on the render after that.
  useEffect(() => {
    const alert = take();
    if (!alert) return;
    // One attempt per announcement, and the announcement is spent here
    // whatever happens next. Holding it until the alerts layer has something
    // to search flies to a warning minutes later out of nowhere, and the
    // layer is empty for the whole of a replay and any time the reader has
    // warnings switched off, which is exactly when the watch is still
    // announcing.
    const drawn = alerts;
    if (!drawn) return;
    if (!settingsRef.current.followNewWarnings) return;
    // Not while a picture or a loop is being written: the export walks the
    // camera itself, and a warning arriving mid-recording would put a flight
    // in the middle of somebody's video.
    if (exportBusy) return;
    // And not off somebody who is using the map. MapLibre stops a flight the
    // moment a gesture starts, which covers an interruption; this is the
    // other half, which is not starting one over a reader's shoulder.
    const touched = mapRef.current?.interactedAt() ?? null;
    if (touched !== null && Date.now() - touched < FOLLOW_QUIET_MS) return;

    // The same identity the watch decided by, from the same function, so a
    // warning it announced is the warning that is flown to.
    let box: OverlayBounds | null = null;
    for (const feature of drawn.features) {
      const bounds = featureBounds(feature.geometry);
      if (!bounds) continue;
      if (alertId(feature.properties, bounds) === alert.id) {
        box = bounds;
        break;
      }
    }
    if (!box) return;
    mapRef.current?.fitBounds(box);
    pushToast({
      title: translate("follow.went", { headline: alert.headline }),
      detail: translate("follow.wentBody"),
      actionLabel: translate("follow.stop"),
      onAction: () =>
        applySettings({ ...settingsRef.current, followNewWarnings: false }),
    });
    // Deliberately not depending on the drawn alerts: this runs when a
    // warning is announced and reads whatever the layer holds at that moment.
    // Waking it again when the layer changes is how a spent announcement came
    // back to life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySettings, exportBusy, mapRef, pushToast, settingsRef, signal, take]);
}

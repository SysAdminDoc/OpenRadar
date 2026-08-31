import { useEffect, useRef } from "react";
import { log } from "../lib/log";
import { alertsOfKind, alertsOverlay } from "../lib/overlays/alerts";
import type { AlertType } from "../lib/alertTypes";
import { isDesktopRuntime } from "../lib/settings";
import {
  alertsToAnnounce,
  watchAlertBody,
  watchBounds,
  type WatchAlert,
  type WatchSettings,
} from "../lib/watch";
import { translate } from "../i18n";
import { playAlertTone } from "../lib/sound";

/** Often enough to matter for a warning, rarely enough to be a good citizen. */
const POLL_MS = 45_000;

async function announceOnDesktop(
  alert: WatchAlert,
  isCurrent: () => boolean,
): Promise<boolean> {
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification");
  if (!isCurrent()) return false;

  let granted = await isPermissionGranted();
  if (!isCurrent()) return false;
  if (!granted) {
    granted = (await requestPermission()) === "granted";
    if (!isCurrent()) return false;
  }
  if (!granted) return false;

  sendNotification({
    title: alert.headline,
    body: watchAlertBody(alert),
  });
  return true;
}

/**
 * Watches one point for new alerts and says so, whether or not the map is
 * looking that way. The desktop build raises a system notification; a browser
 * preview falls back to the in-app toast.
 */
export function useAlertWatch(
  watch: WatchSettings,
  /** The kinds the reader has left switched on. */
  kinds: Partial<Record<AlertType, boolean>>,
  onFallback: (alert: WatchAlert) => void,
): void {
  // What has been announced, and how bad it was when it was: an upgrade is
  // worth saying again, a downgrade is not.
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  // Read through a ref so switching the sound on or off does not restart the
  // watch and re-announce everything already announced.
  const soundRef = useRef(watch.sound);
  useEffect(() => {
    soundRef.current = watch.sound;
  }, [watch.sound]);

  // The same, for the kinds. Switching one back on should not replay every
  // alert the watch has already mentioned.
  const kindsRef = useRef(kinds);
  useEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);

  const key = watch.enabled
    ? `${watch.center[0].toFixed(3)},${watch.center[1].toFixed(3)},${watch.radiusMiles},${watch.minSeverity}`
    : "";

  useEffect(() => {
    if (!watch.enabled) return;
    const controller = new AbortController();
    let mounted = true;
    let checking = false;
    // A different point or radius is a different watch, so what was already
    // said about the old one must not silence the new one.
    const announced = new Map<string, number>();

    const check = async () => {
      // A slow request must not have a second one running over the top of it,
      // which is how the same alert gets announced twice.
      if (checking) return;
      checking = true;
      try {
        const alerts = await alertsOverlay.fetchData(
          watchBounds(watch),
          controller.signal,
        );
        if (!mounted) return;
        const found = alertsToAnnounce(
          alertsOfKind(alerts, kindsRef.current),
          watch,
          announced,
          Date.now(),
        );
        for (const alert of found) {
          if (!mounted) return;
          // One tone for the batch rather than one per alert: three warnings
          // arriving together should not sound like an alarm going off.
          if (soundRef.current && alert === found[0]) {
            void playAlertTone();
          }
          let delivered = false;
          if (isDesktopRuntime()) {
            try {
              delivered = await announceOnDesktop(alert, () => mounted);
            } catch (failure) {
              log.warn(
                "watch",
                failure instanceof Error
                  ? failure.message
                  : "The desktop notification could not be sent.",
              );
            }
          }
          if (!mounted) return;
          if (!delivered) {
            fallbackRef.current(alert);
          }
          announced.set(alert.id, alert.rank);
          log.info("watch", `Announced ${alert.headline}`);
        }
      } catch (failure) {
        if (
          !mounted ||
          (failure instanceof DOMException && failure.name === "AbortError")
        ) {
          return;
        }
        log.warn(
          "watch",
          failure instanceof Error
            ? failure.message
            : translate("watch.failed"),
        );
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(timer);
    };
    // The key stands in for the watch settings, which are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

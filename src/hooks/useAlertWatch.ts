import { useCallback, useEffect, useRef } from "react";
import { log } from "../lib/log";
import { alertsOfKind, alertsOverlay } from "../lib/overlays/alerts";
import type { AlertType } from "../lib/alertTypes";
import { isDesktopRuntime } from "../lib/settings";
import {
  alertsToAnnounce,
  silencedByQuietHours,
  testWatchAlert,
  watchAlertBody,
  watchBounds,
  watchReasonLines,
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
export interface AlertWatchState {
  /**
   * Raises one harmless alert through the real delivery path.
   *
   * A notification nobody has ever seen work is a notification nobody trusts,
   * and on Windows there are several quiet ways for one to go nowhere: a
   * permission never granted, focus assist holding it, a build without the
   * right shortcut identity. This is how a reader finds that out on a calm
   * afternoon rather than during a tornado warning.
   */
  sendTest: () => Promise<boolean>;
}

export function useAlertWatch(
  watch: WatchSettings,
  /** The kinds the reader has left switched on. */
  kinds: Partial<Record<AlertType, boolean>>,
  onFallback: (alert: WatchAlert) => void,
): AlertWatchState {
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

  // Quiet hours are read at the moment an alert arrives rather than when the
  // watch started, because a watch left running crosses into and out of them.
  const watchRef = useRef(watch);
  useEffect(() => {
    watchRef.current = watch;
  }, [watch]);

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
        let spoken = 0;
        for (const alert of found) {
          if (!mounted) return;
          // Quiet hours hold the ordinary run back and let the serious ones
          // through. Held back, and deliberately not recorded as announced: an
          // alert this skips is still unannounced, so the next poll after the
          // window ends says it, and one that expires overnight is dropped by
          // the expiry check rather than by this.
          //
          // Recording it here instead looked tidier and was a way of losing
          // warnings. A flash flood warning issued at three in the morning is
          // below the default override, and marking it announced meant it was
          // filtered out of every later poll: still in force at nine, and never
          // mentioned once.
          if (
            silencedByQuietHours(watchRef.current, alert.severity, Date.now())
          ) {
            log.info(
              "watch",
              `Held back during quiet hours: ${alert.headline}`,
            );
            continue;
          }
          // One tone for the batch rather than one per alert: three warnings
          // arriving together should not sound like an alarm going off.
          if (soundRef.current && spoken === 0) {
            void playAlertTone();
          }
          spoken += 1;
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
          // Why it fired, beside the fact that it did, so the log can answer
          // the question somebody actually asks the next morning.
          log.info(
            "watch",
            `Announced ${alert.headline}. ${watchReasonLines(alert.reason).join(" ")}`,
          );
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

  const sendTest = useCallback(async () => {
    const alert = testWatchAlert(watchRef.current);
    // The tone goes with it, because "does the sound work" is half of what
    // somebody pressing this wants to know. Quiet hours are deliberately not
    // consulted: a test asked for now is answered now.
    if (watchRef.current.sound) void playAlertTone();
    let delivered = false;
    if (isDesktopRuntime()) {
      try {
        delivered = await announceOnDesktop(alert, () => true);
      } catch (failure) {
        log.warn(
          "watch",
          failure instanceof Error
            ? failure.message
            : "The test notification could not be sent.",
        );
      }
    }
    if (!delivered) fallbackRef.current(alert);
    return delivered;
  }, []);

  return { sendTest };
}

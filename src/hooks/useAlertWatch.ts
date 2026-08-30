import { useEffect, useRef } from "react";
import { log } from "../lib/log";
import { alertsOverlay } from "../lib/overlays/alerts";
import { isDesktopRuntime } from "../lib/settings";
import {
  alertsToAnnounce,
  watchAlertBody,
  watchBounds,
  type WatchAlert,
  type WatchSettings,
} from "../lib/watch";

/** Often enough to matter for a warning, rarely enough to be a good citizen. */
const POLL_MS = 45_000;

async function announceOnDesktop(alert: WatchAlert): Promise<boolean> {
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification");

  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
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
  onFallback: (alert: WatchAlert) => void,
): void {
  const announcedRef = useRef(new Set<string>());
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  const key = watch.enabled
    ? `${watch.center[0].toFixed(3)},${watch.center[1].toFixed(3)},${watch.radiusMiles},${watch.minSeverity}`
    : "";

  useEffect(() => {
    if (!watch.enabled) return;
    const controller = new AbortController();
    let mounted = true;

    const check = async () => {
      try {
        const alerts = await alertsOverlay.fetchData(
          watchBounds(watch),
          controller.signal,
        );
        if (!mounted) return;
        const found = alertsToAnnounce(
          alerts,
          watch,
          announcedRef.current,
          Date.now(),
        );
        for (const alert of found) {
          announcedRef.current.add(alert.id);
          if (isDesktopRuntime()) {
            const sent = await announceOnDesktop(alert);
            if (!sent) fallbackRef.current(alert);
          } else {
            fallbackRef.current(alert);
          }
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
          failure instanceof Error ? failure.message : "The watch check failed",
        );
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

import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "../lib/log";
import { alertsOfKind, alertsOverlay } from "../lib/overlays/alerts";
import type { AlertType } from "../lib/alertTypes";
import { isDesktopRuntime } from "../lib/settings";
import {
  alertsToAnnounceAcross,
  silencedByQuietHours,
  testWatchAlert,
  watchAlertBody,
  watchesBounds,
  watchReasonLines,
  type WatchAlert,
  type WatchPlace,
} from "../lib/watch";
import { translate } from "../i18n";
import { playAlertTone } from "../lib/sound";
import { appendJournalRow } from "../lib/journal";

/** Often enough to matter for a warning, rarely enough to be a good citizen. */
const POLL_MS = 45_000;

/** Nothing announced, for asking what stands rather than what is new. */
const EMPTY = new Map<string, ReadonlyMap<string, number>>();

/**
 * What a place is, for the purpose of forgetting what it has been told.
 *
 * Deliberately not the name: renaming a place does not make its warnings new
 * again. Moving it, resizing it, or changing what it wants to hear about does.
 */
function placeKey(place: WatchPlace): string {
  return `${place.center[0].toFixed(3)},${place.center[1].toFixed(3)},${place.radiusMiles},${place.minSeverity}`;
}

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
   * True while a warning the reader asked to hear about stands over a place
   * they watch.
   *
   * Read off the same poll the announcements come from rather than a second
   * request: the alerts are already in hand, and the only new thing is asking
   * what is in force rather than what is new. It is what the workspace uses
   * to stand its decorative parts down: a map with a warning on it is a
   * serious instrument and nothing arrives on it uninvited.
   */
  alertActive: boolean;
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
  /** Every place being watched, home first. */
  places: WatchPlace[],
  /** The kinds the reader has left switched on. */
  kinds: Partial<Record<AlertType, boolean>>,
  onFallback: (alert: WatchAlert) => void,
  /**
   * Every alert this decides to announce, whichever way it was delivered.
   *
   * Separate from `onFallback`, which fires only when the desktop
   * notification did not land. A screen reader has to hear the ones that did
   * too, and it has to hear them on the same terms: once each, after quiet
   * hours and the severity override have had their say.
   */
  onAnnounce?: (alert: WatchAlert) => void,
): AlertWatchState {
  // What has been announced, and how bad it was when it was: an upgrade is
  // worth saying again, a downgrade is not.
  // Kept with the watch it was read for, so it cannot outlive it. A reader
  // who stops watching a place, or moves one, is not still being told a
  // warning stands there, and deriving that beats resetting it: a setState in
  // the body of an effect is a cascading render.
  const [standing, setStanding] = useState({ key: "", active: false });
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  const announceRef = useRef(onAnnounce);
  useEffect(() => {
    announceRef.current = onAnnounce;
  }, [onAnnounce]);

  // Read through a ref so switching the sound on or off does not restart the
  // watch and re-announce everything already announced.
  const soundRef = useRef(places.some((place) => place.sound));
  useEffect(() => {
    soundRef.current = places.some((place) => place.sound);
  }, [places]);

  // The same, for the kinds. Switching one back on should not replay every
  // alert the watch has already mentioned.
  const kindsRef = useRef(kinds);
  useEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);

  // Quiet hours are read at the moment an alert arrives rather than when the
  // watch started, because a watch left running crosses into and out of them.
  const placesRef = useRef(places);
  // What each place has heard, and what each place was when it heard it.
  // Outside the effect so a restart does not lose either.
  const announcedRef = useRef(new Map<string, Map<string, number>>());
  const placeKeysRef = useRef(new Map<string, string>());
  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  // What the watch is watching, as a string, so adding a place or moving one
  // restarts it and changing something that does not affect what is asked for
  // does not. A restart clears what has already been announced.
  const key = places
    .filter((place) => place.enabled)
    .map((place) => `${place.id}:${placeKey(place)}`)
    .join("|");

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let mounted = true;
    let checking = false;
    // What each place has already been told, kept across restarts. A place
    // that moved is a different place and forgets what it heard; the others
    // keep theirs, so adding somewhere new does not re-announce every warning
    // the rest of the list has already mentioned.
    const announced = announcedRef.current;
    const watching = new Map(
      placesRef.current
        .filter((place) => place.enabled)
        .map((place) => [place.id, placeKey(place)] as const),
    );
    for (const [id, was] of placeKeysRef.current) {
      if (watching.get(id) !== was) announced.delete(id);
    }
    placeKeysRef.current = watching;

    const check = async () => {
      // A slow request must not have a second one running over the top of it,
      // which is how the same alert gets announced twice.
      if (checking) return;
      checking = true;
      try {
        // One box covering every place, so ten places is one request rather
        // than ten. Each place is then judged on its own terms against what
        // came back.
        const live = placesRef.current.filter((place) => place.enabled);
        const bounds = watchesBounds(live);
        if (!bounds) return;
        const alerts = await alertsOverlay.fetchData(bounds, controller.signal);
        if (!mounted) return;
        const wanted = alertsOfKind(alerts, kindsRef.current);
        // What stands, not what is new: the same predicate with nothing yet
        // announced. This is one pass over a list already in memory.
        setStanding({
          key,
          active:
            alertsToAnnounceAcross(wanted, live, EMPTY, Date.now()).length > 0,
        });
        const found = alertsToAnnounceAcross(
          wanted,
          live,
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
          // Quiet hours are the reader's, not a place's: an alert that any
          // watched place would speak through the night is spoken. A place
          // whose own window is closed does not silence one whose is open.
          const reached = new Set(
            (alert.places ?? []).map((place) => place.id),
          );
          const speaks = placesRef.current.some(
            (place) =>
              place.enabled &&
              reached.has(place.id) &&
              !silencedByQuietHours(place, alert.severity, Date.now()),
          );
          if (!speaks) {
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
          // After delivery rather than instead of it, so the reader hears the
          // same alert the notification carried and hears it exactly when the
          // sighted reader sees it.
          announceRef.current?.(alert);
          // Recorded against each place it was news for, so the next poll
          // says nothing about it and a place added later still hears it.
          for (const place of alert.places ?? []) {
            const told = announced.get(place.id) ?? new Map<string, number>();
            told.set(alert.id, alert.rank);
            announced.set(place.id, told);
          }
          // Why it fired, beside the fact that it did, so the log can answer
          // the question somebody actually asks the next morning.
          const claimed = (alert.places ?? []).filter(
            (place) => place.named !== false,
          );
          const named = claimed.map((place) => place.name).join(", ");
          // And into the reader's own record, one row per named place. Only
          // named ones: a coordinate somebody never called anything is not a
          // place they have claimed, and nothing about how the app was used
          // goes anywhere near this file.
          for (const place of claimed) {
            void appendJournalRow({
              at: new Date().toISOString(),
              place: place.name,
              kind: "alert",
              source: translate("journal.sourceNws"),
              observed: new Date().toISOString(),
              obtained: translate("journal.obtainedWatch"),
              text: alert.headline,
            });
          }
          log.info(
            "watch",
            `Announced ${alert.headline}${named ? ` at ${named}` : ""}. ${watchReasonLines(
              alert.reason,
            ).join(" ")}`,
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
    // The key stands in for the places, which are read through a ref inside so
    // that renaming one does not restart the watch and re-announce everything.
  }, [key]);

  const sendTest = useCallback(async () => {
    const first = placesRef.current[0];
    if (!first) return false;
    const alert = testWatchAlert(first);
    // The tone goes with it, because "does the sound work" is half of what
    // somebody pressing this wants to know. Quiet hours are deliberately not
    // consulted: a test asked for now is answered now.
    if (first.sound) void playAlertTone();
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

  return {
    sendTest,
    // Only for the watch it was read for. Nothing being watched is nothing
    // standing over a watched place, whatever the last poll found.
    alertActive: standing.key === key && standing.active,
  };
}

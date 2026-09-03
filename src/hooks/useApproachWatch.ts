import { useEffect, useRef } from "react";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/settings";
import { playAlertTone } from "../lib/sound";
import { translate } from "../i18n";
import {
  approachKey,
  approachesFor,
  approachesToAnnounce,
  type Approach,
  type ApproachSettings,
} from "../lib/approach";
import type { CellReport } from "../lib/cells";
import type { WatchPlace } from "../lib/watch";

/** What a notice about an approaching storm says, in the reader's language. */
export function approachTitle(approach: Approach): string {
  return approach.named
    ? translate("approach.title", { place: approach.placeName })
    : translate("approach.titleHome");
}

export function approachBody(approach: Approach): string {
  return translate("approach.body", {
    id: approach.cellId,
    count: Math.max(1, Math.round(approach.minutes)),
  });
}

async function announceOnDesktop(
  approach: Approach,
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
    title: approachTitle(approach),
    body: approachBody(approach),
  });
  return true;
}

/**
 * Says when the radar's own tracker has a storm heading for a watched place.
 *
 * Driven by the cell report rather than by a poll of its own: the tracker is
 * already being read for the map, and a second timer asking the same service
 * the same question would be a request nobody wanted.
 *
 * Nothing here is a warning and nothing here pretends to be. It is off until
 * asked for, silent unless asked, quiet during quiet hours, said once per
 * storm per place, and worded as the radar's tracking. The warning watch
 * remains the thing that interrupts somebody.
 */
export function useApproachWatch(options: {
  report: CellReport | null;
  places: WatchPlace[];
  settings: ApproachSettings;
  /** Ticks, so a storm that gets closer between scans is still noticed. */
  clock: number;
  /** Shown in the workspace when the desktop notification did not land. */
  onFallback: (approach: Approach) => void;
  /** Every one announced, so a screen reader hears what the desktop said. */
  onAnnounce?: (approach: Approach) => void;
}): void {
  const { report, places, settings, clock, onFallback, onAnnounce } = options;
  // Said once per storm per place, and forgotten when the reader changes what
  // is being watched: a place that was moved is a different place, and one
  // that was switched off should not have a storm waiting to be re-announced
  // when it comes back.
  const toldRef = useRef(new Set<string>());
  const watchedRef = useRef("");
  const fallbackRef = useRef(onFallback);
  const announceRef = useRef(onAnnounce);
  useEffect(() => {
    fallbackRef.current = onFallback;
    announceRef.current = onAnnounce;
  }, [onAnnounce, onFallback]);

  const watched = places
    .filter((place) => place.enabled)
    .map((place) => `${place.id}@${place.center.join(",")}`)
    .join("|");

  useEffect(() => {
    if (watchedRef.current !== watched) {
      watchedRef.current = watched;
      toldRef.current.clear();
    }
    if (!settings.enabled || !report) return;
    let mounted = true;
    const coming = approachesFor(report, places, clock);
    const worth = approachesToAnnounce(
      coming,
      settings,
      places,
      toldRef.current,
      clock,
    );
    if (!worth.length) return;

    void (async () => {
      let spoken = 0;
      for (const approach of worth) {
        if (!mounted) return;
        // Recorded before delivery, not after: an await between the decision
        // and the record is a window where the next tick decides the same
        // thing again and says it twice.
        toldRef.current.add(approachKey(approach));
        // One tone for a batch, when the reader asked for one at all. Three
        // storms crossing three places at once must not sound like an alarm.
        if (settings.sound && spoken === 0) {
          void playAlertTone("minor");
        }
        spoken += 1;
        let delivered = false;
        if (isDesktopRuntime()) {
          try {
            delivered = await announceOnDesktop(approach, () => mounted);
          } catch (failure) {
            log.warn(
              "approach",
              failure instanceof Error
                ? failure.message
                : "The desktop notification could not be sent.",
            );
          }
        }
        if (!mounted) return;
        if (!delivered) fallbackRef.current(approach);
        announceRef.current?.(approach);
      }
    })();

    return () => {
      mounted = false;
    };
    // `places` is read inside and is a new array every render; `watched` is
    // the part of it that matters, and the report and the clock are what
    // actually move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clock,
    report,
    settings.enabled,
    settings.minutes,
    settings.sound,
    watched,
  ]);
}

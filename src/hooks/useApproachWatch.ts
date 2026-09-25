import { announceOnDesktop } from "../lib/notify";
import { useEffect, useRef } from "react";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/runtime";
import { playAlertTone } from "../lib/sound";
import { translate } from "../i18n";
import {
  approachRound,
  type Approach,
  type ApproachSettings,
  type ApproachTold,
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
  /**
   * How the workspace shows one, when the desktop notification did not land.
   *
   * The same shape the warning watch uses. A notification that did land is
   * already announced by a screen reader, and a toast beside it would be the
   * app saying a thing that is not a warning twice.
   */
  onFallback: (approach: Approach) => void;
}): void {
  const { report, places, settings, clock, onFallback } = options;
  // Said once per storm per place. Kept per place, so switching one place off
  // forgets that place and nobody else's.
  const toldRef = useRef<ApproachTold>(new Map());
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);
  // Only true unmounting stops a delivery. This effect re-runs every minute
  // with the clock, and a per-run flag meant a notification permission prompt
  // that outlived one minute swallowed the notice it was asked for: the key
  // was already recorded, so it was never said again.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const watched = places
    .filter((place) => place.enabled)
    .map((place) => `${place.id}@${place.center.join(",")}`)
    .join("|");

  useEffect(() => {
    // Recorded as said before the await below, so two ticks a minute apart
    // cannot both decide to say the same thing. Delivery is not allowed to be
    // abandoned by anything short of unmounting, which is what makes that
    // safe: the record and the saying cannot come apart.
    const worth = approachRound(
      toldRef.current,
      report,
      places,
      settings,
      clock,
    );
    if (!worth.length) return;

    void (async () => {
      let spoken = 0;
      for (const approach of worth) {
        if (!mountedRef.current) return;
        // One tone for a batch, when the reader asked for one at all. Three
        // storms crossing three places at once must not sound like an alarm.
        if (settings.sound && spoken === 0) {
          void playAlertTone("minor");
        }
        spoken += 1;
        let delivered = false;
        if (isDesktopRuntime()) {
          try {
            delivered = await announceOnDesktop(
              approachTitle(approach),
              approachBody(approach),
              () => mountedRef.current,
            );
          } catch (failure) {
            log.warn(
              "approach",
              failure instanceof Error
                ? failure.message
                : "The desktop notification could not be sent.",
            );
          }
        }
        if (!mountedRef.current) return;
        if (!delivered) fallbackRef.current(approach);
      }
    })();
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

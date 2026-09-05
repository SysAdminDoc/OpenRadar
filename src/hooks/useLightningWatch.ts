import { announceOnDesktop } from "../lib/notify";
import { useEffect, useMemo, useRef } from "react";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/settings";
import { playAlertTone } from "../lib/sound";
import { distanceUnit, distanceValue } from "../lib/units";
import { translate } from "../i18n";
import {
  lightningAfter,
  lightningNear,
  lightningToAnnounce,
  rememberLightning,
  type LightningNotice,
  type LightningRule,
  type LightningSaid,
  type PlaceLightning,
} from "../lib/lightningWatch";
import type { FlashWindow } from "./useLightning";
import type { WatchPlace } from "../lib/watch";

/** What a lightning notice says, in the reader's own language. */
export function lightningTitle(notice: LightningNotice): string {
  const place = notice.place;
  if (notice.kind === "quiet") {
    return place.named
      ? translate("lightningWatch.quietTitle", { place: place.placeName })
      : translate("lightningWatch.quietTitleHome");
  }
  return place.named
    ? translate("lightningWatch.title", { place: place.placeName })
    : translate("lightningWatch.titleHome");
}

export function lightningBody(notice: LightningNotice): string {
  if (notice.kind === "quiet") {
    return translate("lightningWatch.quietBody");
  }
  return translate("lightningWatch.body", {
    count: notice.place.flashes,
    // In whichever units the reader chose, like every other distance the
    // app says out loud. This one was handed raw miles and a catalogue
    // string that wrote "mi" into all three languages.
    miles: distanceValue(notice.place.radiusMiles),
    unit: distanceUnit(),
  });
}

/**
 * Says when lightning is falling near a place somebody watches, and when it
 * has stopped.
 *
 * Driven by the flash window the map already holds rather than by a poll of
 * its own. Two notices per storm and no more: come in, and half an hour after
 * the last flash, it is over. Everything it says carries what these flashes
 * are, which is an instrument seeing light above the cloud rather than a
 * report of what reached the ground.
 *
 * Returns what it counted, one entry per watched place, so the panels can
 * show the same figures the notice is decided from rather than counting the
 * window a second time and disagreeing with it. Counted whether or not the
 * notice is switched on: a reader who never wants a notification still wants
 * to know how long it has been since the last flash.
 */
export function useLightningWatch(options: {
  window: FlashWindow | null;
  places: WatchPlace[];
  rule: LightningRule;
  /** Ticks, so the half hour of quiet is noticed without a new window. */
  clock: number;
  /** How the workspace shows one, when a desktop notification did not land. */
  onFallback: (notice: LightningNotice) => void;
}): PlaceLightning[] {
  const { window: flashes, places, rule, clock, onFallback } = options;
  const saidRef = useRef(new Map<string, LightningSaid>());
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);
  // Only a real unmount stops a delivery. This effect re-runs on the clock,
  // so a per-run flag would abandon a notice halfway through a permission
  // prompt, having already recorded that the place was told.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The name is in the key because the answer carries it: a place renamed
  // between two windows would otherwise be announced, and drawn, under the
  // name it had before.
  const watched = places
    .filter((place) => place.enabled)
    .map(
      (place) =>
        `${place.id}@${place.center.join(",")}:${place.named === false ? "" : place.name}`,
    )
    .join("|");

  // Forgetting a place that is no longer watched cannot wait for the feed.
  // The prune lives in `lightningAfter`, which only runs on a real window, so
  // through an outage or with the lightning layer switched off a place turned
  // off and back on kept its record: it was still marked as told, and a storm
  // that was still going over it went unannounced. Missing a notice is the
  // direction that matters, so this runs on the watched set alone.
  useEffect(() => {
    const live = new Set(
      places.filter((place) => place.enabled).map((place) => place.id),
    );
    for (const id of [...saidRef.current.keys()]) {
      if (!live.has(id)) saidRef.current.delete(id);
    }
    // `places` is a new array every render; `watched` is the part of it that
    // decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  // What each place has had, counted once and read by both the notice below
  // and whatever is on screen. A window that has not arrived is not an empty
  // one, so nothing is claimed about a place until a real answer comes back.
  // The feed carries five minutes, so a reading is folded into what the app
  // already had: read from the window alone the age of the last flash could
  // never pass about six minutes, and the age is most of what a reader is
  // reading.
  const near = useMemo(
    () => rememberLightning(lightningNear(flashes, places, rule)),
    // `places` is a new array every render; `watched` is the part of it that
    // decides this, and the radius is the only part of the rule that changes
    // what is counted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flashes, watched, rule.radiusMiles],
  );

  useEffect(() => {
    if (!rule.enabled) return;
    // No window is not an empty window. The feed answers with nothing when
    // the bucket listing fails, when the newest file it found is older than
    // the window it was asked for, and whenever the reader switches the
    // lightning layer off. Treating any of those as "no flashes anywhere"
    // let `lightningAfter` prune every place it had already told, so a storm
    // still in progress was announced a second time and the all-clear, which
    // is measured from the newest flash this map remembers, could never be
    // said at all. What is held is only replaced by a real answer.
    if (!flashes) return;
    const notices = lightningToAnnounce(
      near,
      rule,
      places,
      saidRef.current,
      clock,
    );
    // Recorded before anything is delivered, so two ticks cannot both decide
    // to say the same thing. What is not allowed after this point is
    // abandoning the delivery: the record and the saying stay together.
    saidRef.current = lightningAfter(near, saidRef.current, notices);
    if (!notices.length) return;

    void (async () => {
      let spoken = 0;
      for (const notice of notices) {
        if (!mountedRef.current) return;
        // One tone for a batch, and never for the all-clear: that one is good
        // news and does not need to interrupt anybody.
        if (rule.sound && spoken === 0 && notice.kind === "started") {
          void playAlertTone("minor");
        }
        spoken += 1;
        let delivered = false;
        if (isDesktopRuntime()) {
          try {
            delivered = await announceOnDesktop(
              lightningTitle(notice),
              lightningBody(notice),
              () => mountedRef.current,
            );
          } catch (failure) {
            log.warn(
              "lightning",
              failure instanceof Error
                ? failure.message
                : "The desktop notification could not be sent.",
            );
          }
        }
        if (!mountedRef.current) return;
        if (!delivered) fallbackRef.current(notice);
      }
    })();
    // `places` is read inside and is a new array every render; `watched` is
    // the part of it that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clock,
    flashes,
    rule.count,
    rule.enabled,
    rule.radiusMiles,
    rule.sound,
    watched,
  ]);

  return near;
}

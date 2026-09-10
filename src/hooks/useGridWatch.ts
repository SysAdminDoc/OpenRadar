import { announceOnDesktop } from "../lib/notify";
import { useEffect, useRef } from "react";
import { log } from "../lib/log";
import { isDesktopRuntime } from "../lib/runtime";
import { playAlertTone } from "../lib/sound";
import { pollWhileOnline } from "../lib/poll";
import { distanceUnit, distanceValue, isMetric } from "../lib/units";
import { formatNumber, translate } from "../i18n";
import {
  GRID_RULE_SOURCES,
  gridAfter,
  gridToAnnounce,
  type GridNotice,
  type GridRule,
  type GridRuleId,
  type GridSaid,
  type PlaceReading,
} from "../lib/gridWatch";
import { domainFor, mrmsAvailable, mrmsPeakNear } from "../lib/providers/mrms";
import type { WatchPlace } from "../lib/watch";

/**
 * How often the grid is asked about.
 *
 * The network publishes these every two minutes and the notice is about a
 * storm reaching a place, so anything slower is a notice that arrives after
 * the hail has. It is one small answer per watched place, not a grid: the
 * decode is shared with whatever the map is already drawing.
 */
export const GRID_WATCH_REFRESH_MS = 2 * 60_000;

/** The reading in the reader's own words, in the unit the rule is set in. */
export function gridReadingLabel(rule: GridRuleId, value: number): string {
  if (rule === "rotation") {
    // Thousandths of a second, which is what a forecaster says and what the
    // weather service's own training is written in. Not a length, so it does
    // not follow the units setting.
    // The number itself, not a formatted string: the plural block picks its
    // arm from the value and writes it in the reader's own notation, which is
    // what a string handed in would have thrown away.
    return translate("gridWatch.shear", { shear: value });
  }
  return isMetric()
    ? `${formatNumber(value * 2.54, 1)} cm`
    : `${formatNumber(value, 2)} ${translate("units.inches")}`;
}

/** What a notice says, in the reader's own language. */
export function gridTitle(notice: GridNotice): string {
  const named = notice.reading.named;
  const place = notice.reading.place;
  if (notice.kind === "quiet") {
    return named
      ? translate(
          notice.rule === "hail"
            ? "gridWatch.hailQuietTitle"
            : "gridWatch.rotationQuietTitle",
          { place },
        )
      : translate(
          notice.rule === "hail"
            ? "gridWatch.hailQuietTitleHome"
            : "gridWatch.rotationQuietTitleHome",
        );
  }
  return named
    ? translate(
        notice.rule === "hail"
          ? "gridWatch.hailTitle"
          : "gridWatch.rotationTitle",
        { place },
      )
    : translate(
        notice.rule === "hail"
          ? "gridWatch.hailTitleHome"
          : "gridWatch.rotationTitleHome",
      );
}

export function gridBody(notice: GridNotice): string {
  if (notice.kind === "quiet") {
    return translate(
      notice.rule === "hail"
        ? "gridWatch.hailQuietBody"
        : "gridWatch.rotationQuietBody",
    );
  }
  const reading = notice.reading;
  const size =
    reading.value === null ? "" : gridReadingLabel(notice.rule, reading.value);
  return translate(
    notice.rule === "hail" ? "gridWatch.hailBody" : "gridWatch.rotationBody",
    {
      reading: size,
      miles: distanceValue(reading.miles ?? 0),
      unit: distanceUnit(),
    },
  );
}

/**
 * Says when the network's own estimate near a watched place crosses a line
 * the reader drew, and when it has been under it for half an hour.
 *
 * Two notices per storm and no more, which is the shape the lightning rule
 * already taught: come in, and half an hour later it is over. Everything it
 * says carries what these numbers are. Hail size is worked out from the
 * energy in a column rather than from anybody standing under it; rotation is
 * shear the network merged, not a tornado and not a claim that one is on the
 * ground.
 *
 * It asks the native side for one number per place rather than reading a
 * grid: the decode is the one the map is already doing, and nothing about
 * where the reader is looking goes into the question. Each place is read
 * against the national grid that covers it rather than always the lower
 * forty-eight, because the five grids do not overlap.
 *
 * Nothing comes back. The rule is the notice: a reading on its way to no
 * surface was state kept for nobody.
 */
export function useGridWatch(options: {
  rule: GridRuleId;
  settings: GridRule;
  places: WatchPlace[];
  ready: boolean;
  /** How the workspace shows one, when a desktop notification did not land. */
  onFallback: (notice: GridNotice) => void;
}): void {
  const { rule, settings, places, ready, onFallback } = options;
  const saidRef = useRef(new Map<string, GridSaid>());
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);
  // Only a real unmount stops a delivery. A per-run flag would abandon a
  // notice halfway through a permission prompt, having already recorded that
  // the place was told.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The name is in the key because the notice carries it: a place renamed
  // between two passes would otherwise be announced under its old name. The
  // quiet hours are in it for a harder reason: the poll runs inside the
  // effect, so the `places` array it reads is the one captured when the
  // effect was established. Without them here, quiet hours set after a rule
  // was switched on never reached the pass that honours them, and somebody
  // who asked for silence at two in the morning got a notification anyway.
  // The lightning rule is safe from this by accident, because its effect
  // re-runs on every flash window.
  const watched = places
    .filter((place) => place.enabled)
    .map((place) => {
      const quiet = place.quietHours;
      const silence = quiet
        ? `${quiet.enabled}/${quiet.startMinute}-${quiet.endMinute}`
        : "";
      return `${place.id}@${place.center.join(",")}:${place.named === false ? "" : place.name}:${silence}`;
    })
    .join("|");

  const wanted = ready && settings.enabled && mrmsAvailable();

  useEffect(() => {
    if (!wanted) return;
    const watching = places.filter((place) => place.enabled);
    if (watching.length === 0) return;

    const ask = async () => {
      const source = GRID_RULE_SOURCES[rule];
      const answers = await Promise.all(
        watching.map(async (place): Promise<PlaceReading> => {
          const bare: PlaceReading = {
            placeId: place.id,
            place: place.name,
            named: place.named !== false,
            value: null,
            miles: null,
            observed: null,
          };
          // The five national grids do not overlap, so a place is read
          // against the one that covers it. A place in none of them has no
          // grid to read at all, which is a reading of nothing rather than a
          // reading of zero.
          const domain = domainFor(place.center);
          if (!domain) return bare;
          try {
            const peak = await mrmsPeakNear(
              source.product,
              place.center[1],
              place.center[0],
              settings.radiusMiles,
              domain.id,
            );
            if (!peak) return bare;
            return {
              ...bare,
              value: source.fromGrid(peak.value),
              miles: peak.miles,
              // The grid answers in seconds, like every frame time the native
              // side hands over.
              observed: peak.time * 1000,
            };
          } catch (failure) {
            // A grid that would not answer is not a grid saying nothing
            // happened, so the reading stays null and nothing is announced
            // either way.
            log.warn(
              "gridWatch",
              `${rule} at ${place.id}: ${
                failure instanceof Error ? failure.message : String(failure)
              }`,
            );
            return bare;
          }
        }),
      );
      if (!mountedRef.current) return;

      const at = Date.now();
      const notices = gridToAnnounce(
        rule,
        settings,
        answers,
        watching,
        saidRef.current,
        at,
      );
      // Recorded before anything is delivered, so two passes cannot both
      // decide to say the same thing. What is not allowed after this point is
      // abandoning the delivery: the record and the saying stay together.
      saidRef.current = gridAfter(
        settings,
        answers,
        saidRef.current,
        notices,
        at,
      );
      if (notices.length === 0) return;

      let spoken = 0;
      for (const notice of notices) {
        if (!mountedRef.current) return;
        // One tone for a batch, and never for the all-clear: that one is good
        // news and does not need to interrupt anybody.
        if (settings.sound && spoken === 0 && notice.kind === "over") {
          void playAlertTone("minor");
        }
        spoken += 1;
        let delivered = false;
        if (isDesktopRuntime()) {
          try {
            delivered = await announceOnDesktop(
              gridTitle(notice),
              gridBody(notice),
              () => mountedRef.current,
            );
          } catch (failure) {
            log.warn(
              "gridWatch",
              failure instanceof Error
                ? failure.message
                : "the notice could not be shown",
            );
          }
        }
        if (!mountedRef.current) return;
        if (!delivered) fallbackRef.current(notice);
      }
    };

    return pollWhileOnline(() => void ask(), GRID_WATCH_REFRESH_MS);
    // `places` is a new array every render; `watched` is the part of it that
    // decides this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rule,
    settings.enabled,
    settings.radiusMiles,
    settings.sound,
    settings.threshold,
    wanted,
    watched,
  ]);

  // Forgetting a place that is no longer watched cannot wait for the next
  // pass: with the rule switched off for a while, a place turned off and back
  // on would still be marked as told and a storm over it would go unsaid.
  useEffect(() => {
    const live = new Set(
      places.filter((place) => place.enabled).map((place) => place.id),
    );
    for (const id of [...saidRef.current.keys()]) {
      if (!live.has(id)) saidRef.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);
}

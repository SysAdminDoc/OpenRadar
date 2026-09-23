import type { AlertType } from "./alertTypes";
import { archiveWarningsAt } from "./archiveWarnings";
import type { OverlayData } from "./overlays";
import { alertsOfKind } from "./overlays/alerts";
import {
  alertsToAnnounceAcross,
  silencedByQuietHours,
  WATCH_POLL_MS,
  type WatchAlert,
  type WatchPlace,
} from "./watch";

/** One thing the warning watch would have said at one place. */
export interface BacktestLine {
  alert: WatchAlert;
  /**
   * When it would have been said, or null when quiet hours held it back
   * until it was no longer in force or the replay ran out.
   */
  said: number | null;
  /** When quiet hours first held it back, or null when they never did. */
  heldFrom: number | null;
}

export interface PlaceBacktest {
  placeId: string;
  name: string;
  lines: BacktestLine[];
}

/**
 * What the warning watch would have said over a replayed window, place by
 * place.
 *
 * The watch's own rules rather than a model of them: the archive's polygons
 * in force at each moment go through the same `alertsToAnnounceAcross` and
 * the same `silencedByQuietHours` the live watch calls, at the pace it polls,
 * with the same memory of what each place has been told. Nothing is
 * delivered. There is no notification, tone, voice or row in the record here,
 * because none of those are reachable from this module, which is what makes
 * "nothing was notified" something a test can hold rather than a promise.
 *
 * Quiet hours are applied, not skipped: an alert they hold back is kept
 * unannounced, exactly as the watch keeps it, so the line says both when it
 * was first held and when it was finally said, or that it never was.
 */
export function backtestWarnings(
  archived: OverlayData,
  places: readonly WatchPlace[],
  kinds: Partial<Record<AlertType, boolean>>,
  from: number,
  to: number,
): PlaceBacktest[] {
  const live = places.filter((place) => place.enabled);
  // The archive names one warning across every polygon it held by its VTEC
  // event, and the live feed calls the same thing `eventKey`, which is what
  // the watch knows an alert by. Without it every trim of a polygon arrives
  // under a new product id and reads as a new warning, and a backtest says a
  // storm was announced five times that the watch would have said once.
  const keyed: OverlayData = {
    ...archived,
    features: archived.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, eventKey: feature.properties.event },
    })),
  };
  const announced = new Map<string, Map<string, number>>();
  const held = new Map<string, { since: number; alert: WatchAlert }>();
  const lines = new Map<string, BacktestLine[]>(
    live.map((place) => [place.id, []]),
  );
  const write = (alert: WatchAlert, when: Omit<BacktestLine, "alert">) => {
    for (const place of alert.places ?? []) {
      lines.get(place.id)?.push({ alert, ...when });
    }
  };

  for (let now = from; now <= to; now += WATCH_POLL_MS) {
    const inForce = archiveWarningsAt(keyed, now);
    if (!inForce) continue;
    const found = alertsToAnnounceAcross(
      alertsOfKind(inForce, kinds),
      live,
      announced,
      now,
    );
    for (const alert of found) {
      // The reader's rule, not a place's: an alert any place it reached would
      // speak is spoken, which is how the watch decides it.
      const reached = new Set((alert.places ?? []).map((place) => place.id));
      const speaks = live.some(
        (place) =>
          reached.has(place.id) &&
          !silencedByQuietHours(place, alert.severity, now),
      );
      if (!speaks) {
        if (!held.has(alert.id)) held.set(alert.id, { since: now, alert });
        continue;
      }
      write(alert, { said: now, heldFrom: held.get(alert.id)?.since ?? null });
      held.delete(alert.id);
      for (const place of alert.places ?? []) {
        const told = announced.get(place.id) ?? new Map<string, number>();
        told.set(alert.id, alert.rank);
        announced.set(place.id, told);
      }
    }
  }
  for (const { since, alert } of held.values()) {
    write(alert, { said: null, heldFrom: since });
  }

  const when = (line: BacktestLine) => line.said ?? line.heldFrom ?? 0;
  return live.map((place) => ({
    placeId: place.id,
    name: place.name,
    lines: (lines.get(place.id) ?? []).sort(
      (left, right) => when(left) - when(right),
    ),
  }));
}

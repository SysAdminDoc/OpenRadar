import type { AlertType } from "./alertTypes";
import {
  approachesFor,
  approachesToAnnounce,
  approachKey,
  approachRound,
  toldPairs,
  type Approach,
  type ApproachSettings,
  type ApproachTold,
} from "./approach";
import { archiveWarningsAt } from "./archiveWarnings";
import {
  CELLS_REFRESH_MS,
  cellsPublishedBy,
  type CellReport,
  type CellsReplay,
} from "./cells";
import { replayWindowAt, type FlashReplay } from "./lightningReplay";
import {
  lightningAfter,
  lightningNear,
  lightningToAnnounce,
  LIGHTNING_REFRESH_MS,
  QUIET_AFTER_MS,
  rememberLightningIn,
  type LightningNotice,
  type LightningRule,
  type LightningSaid,
  type PlaceLightning,
} from "./lightningWatch";
import type { OverlayData } from "./overlays";
import { alertsOfKind } from "./overlays/alerts";
import {
  alertsToAnnounceAcross,
  CLOCK_TICK_MS,
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

/** One lightning or storm-approach notice a replayed watch would have given. */
export interface NoticeLine<T> {
  notice: T;
  /** When it would have been said, or null when quiet hours held it back. */
  said: number | null;
  /** When quiet hours first held it back, or null when they never did. */
  heldFrom: number | null;
}

/** Each watched place's lines, by place id, soonest first. */
export type NoticeLines<T> = Map<string, NoticeLine<T>[]>;

function linesFor<T>(places: readonly WatchPlace[]): NoticeLines<T> {
  return new Map(places.map((place) => [place.id, []]));
}

function sortLines<T>(lines: NoticeLines<T>): NoticeLines<T> {
  const when = (line: NoticeLine<T>) => line.said ?? line.heldFrom ?? 0;
  for (const each of lines.values()) {
    each.sort((left, right) => when(left) - when(right));
  }
  return lines;
}

/**
 * The same places with their quiet hours taken away.
 *
 * Each rule is run over both, and what it would have said to these and did
 * not say to the real ones is exactly what quiet hours held back. That keeps
 * the rules' own quiet-hour handling the only one there is, rather than a
 * second copy of it here that could drift.
 */
function withoutQuietHours(places: readonly WatchPlace[]): WatchPlace[] {
  return places.map((place) => ({ ...place, quietHours: undefined }));
}

/**
 * What the lightning notice would have said over a replayed window, place by
 * place.
 *
 * At each minute the live feed would have asked, the window it would have been
 * holding is built out of the archive's files, and the watch's own functions
 * decide what to say with the same memory of what each place was told. A
 * minute with no readable file in its window is skipped, as the live watch
 * skips a window that did not come. Quiet hours hold back the first notice and
 * never the all-clear, which is the rule's own handling; a storm they held
 * back entirely is listed as not said once the place has gone half an hour
 * without a flash.
 */
export function backtestLightning(
  replay: FlashReplay,
  places: readonly WatchPlace[],
  rule: LightningRule,
  from: number,
  to: number,
): NoticeLines<LightningNotice> {
  const live = places.filter((place) => place.enabled);
  const lines = linesFor<LightningNotice>(live);
  if (!rule.enabled) return lines;
  const unquiet = withoutQuietHours(live);
  const memory = new Map<string, PlaceLightning>();
  let told = new Map<string, LightningSaid>();
  const held = new Map<string, { since: number; notice: LightningNotice }>();

  for (let now = from; now <= to; now += LIGHTNING_REFRESH_MS) {
    const window = replayWindowAt(replay, now);
    if (!window) continue;
    const near = rememberLightningIn(memory, lightningNear(window, live, rule));
    const notices = lightningToAnnounce(near, rule, live, told, now);
    const unheld = lightningToAnnounce(near, rule, unquiet, told, now);
    told = lightningAfter(near, told, notices);

    for (const notice of notices) {
      const id = notice.place.placeId;
      const waited =
        notice.kind === "started" ? (held.get(id)?.since ?? null) : null;
      if (notice.kind === "started") held.delete(id);
      lines.get(id)?.push({ notice, said: now, heldFrom: waited });
    }
    for (const notice of unheld) {
      const id = notice.place.placeId;
      if (notice.kind !== "started") continue;
      if (notices.some((said) => said.place.placeId === id)) continue;
      if (!held.has(id)) held.set(id, { since: now, notice });
    }
    // A storm quiet hours held back from start to finish: over, by the
    // rule's own measure, before they ended.
    for (const [id, waiting] of held) {
      const last = near.find((place) => place.placeId === id)?.newest ?? null;
      if (last === null || now - last < QUIET_AFTER_MS) continue;
      lines.get(id)?.push({
        notice: waiting.notice,
        said: null,
        heldFrom: waiting.since,
      });
      held.delete(id);
    }
  }
  for (const [id, waiting] of held) {
    lines
      .get(id)
      ?.push({ notice: waiting.notice, said: null, heldFrom: waiting.since });
  }
  return sortLines(lines);
}

/**
 * What the storm-approach notice would have said over a replayed window,
 * place by place.
 *
 * The clock moves a minute at a time, as the app's does, and the tracker is
 * asked at the pace the live reader asks it, each time answered with the
 * newest product the site had published by then. The watch's own round
 * decides what to say and remembers it, so a storm is said once per place
 * however long it sits inside the threshold.
 */
export function backtestApproaches(
  replay: CellsReplay,
  places: readonly WatchPlace[],
  settings: ApproachSettings,
  from: number,
  to: number,
): NoticeLines<Approach> {
  const live = places.filter((place) => place.enabled);
  const lines = linesFor<Approach>(live);
  if (!settings.enabled) return lines;
  const unquiet = withoutQuietHours(live);
  const told: ApproachTold = new Map();
  const held = new Map<string, { since: number; notice: Approach }>();
  let report: CellReport | null = null;
  let asked = -Infinity;

  for (let now = from; now <= to; now += CLOCK_TICK_MS) {
    if (now - asked >= CELLS_REFRESH_MS) {
      report = cellsPublishedBy(replay, now);
      asked = now;
    }
    for (const approach of approachRound(told, report, live, settings, now)) {
      const key = approachKey(approach);
      lines.get(approach.placeId)?.push({
        notice: approach,
        said: now,
        heldFrom: held.get(key)?.since ?? null,
      });
      held.delete(key);
    }
    if (!report) continue;
    const waiting = approachesToAnnounce(
      approachesFor(report, unquiet, now),
      settings,
      unquiet,
      toldPairs(told),
      now,
    );
    for (const approach of waiting) {
      const key = approachKey(approach);
      if (!held.has(key)) held.set(key, { since: now, notice: approach });
    }
  }
  for (const { since, notice } of held.values()) {
    lines.get(notice.placeId)?.push({ notice, said: null, heldFrom: since });
  }
  return sortLines(lines);
}

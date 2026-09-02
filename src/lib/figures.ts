import { translate } from "../i18n";
import { formatClock } from "./units";
import type { JournalRow } from "./journal";

/**
 * How much weather you have actually watched, as facts rather than as a game.
 *
 * People do like knowing they have a year of their own weather written down.
 * They do not like being nudged about a streak, and a weather app that
 * manufactured engagement pressure around severe weather would be genuinely
 * distasteful. So these are figures, in the place somebody goes to look at
 * the record, and nothing else:
 *
 * - Nothing is notified, badged or celebrated. There is no path from here to
 *   a toast, a sound or a notification, and a test reads this file to hold
 *   that.
 * - There is no streak, no level, no target and no comparison with a previous
 *   period. A figure that says "fewer than last month" is a target wearing a
 *   fact's clothes.
 * - Every figure names the period it covers and where it came from, which is
 *   the record on this machine and nothing else.
 * - With the record switched off there are no figures. Unavailable, not
 *   estimated: a guess about somebody's own weather is worth less than
 *   nothing.
 */
export interface Figures {
  /** How many rows the record holds. */
  rows: number;
  /** Warnings and observations, which are the two kinds of row. */
  alerts: number;
  observations: number;
  /** How many places the reader has named that the record knows about. */
  places: number;
  /** The oldest and newest observed times the record still holds. */
  from: number | null;
  to: number | null;
  /** Days with something on them, which is not the same as days elapsed. */
  days: number;
}

/** The figures, or null when the record holds nothing to count. */
export function figuresFrom(rows: readonly JournalRow[]): Figures | null {
  if (!rows.length) return null;

  const places = new Set<string>();
  const days = new Set<string>();
  let alerts = 0;
  let observations = 0;
  let from: number | null = null;
  let to: number | null = null;

  for (const row of rows) {
    if (row.place) places.add(row.place);
    if (row.kind === "alert") alerts += 1;
    else observations += 1;
    const at = Date.parse(row.observed);
    if (!Number.isFinite(at)) continue;
    // Grouped by the day the reader would call it, by asking the same
    // formatter that writes the dates on screen rather than by a calculation
    // beside it.
    days.add(
      formatClock(at, { year: "numeric", month: "2-digit", day: "2-digit" }),
    );
    if (from === null || at < from) from = at;
    if (to === null || at > to) to = at;
  }

  return {
    rows: rows.length,
    alerts,
    observations,
    places: places.size,
    from,
    to,
    days: days.size,
  };
}

/**
 * The figures as sentences, each naming what it covers.
 *
 * A number on its own invites a comparison. A number that says what it counts
 * and over what period is a fact about a file.
 */
export function figureLines(figures: Figures): string[] {
  const lines = [
    translate("figures.rows", {
      rows: figures.rows,
      alerts: figures.alerts,
      observations: figures.observations,
    }),
    translate("figures.places", { places: figures.places }),
  ];
  if (figures.from !== null && figures.to !== null) {
    lines.push(
      translate("figures.period", {
        from: formatClock(figures.from, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        to: formatClock(figures.to, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        days: figures.days,
      }),
    );
  }
  return lines;
}

import { translate } from "../i18n";
import { formatClock } from "./units";
import type { JournalRow } from "./journal";

/**
 * What the weather did at your places while the app was closed.
 *
 * The one thing a weather app can say on a launch that is about the weather
 * rather than about itself. Four rules hold it to that:
 *
 * - It is read out of the record, never fetched. Every line was written down
 *   at the time by something that was watching; nothing here asks a service
 *   what it thinks happened last Tuesday, so nothing here can say a warning
 *   stood somewhere it did not.
 * - Only places the reader named, which is already true of every row in the
 *   record and is stated here because it is the reason the record is worth
 *   keeping at all.
 * - Nothing is presented as current. Every line carries its own time, in the
 *   past tense, because a warning that reached somewhere on Tuesday is not a
 *   warning now and a summary that reads like one is dangerous.
 * - It is capped. The rest is in the record, one press away, and a wall of
 *   forty lines on a launch is not a summary.
 */
export interface CatchUp {
  /** The lines to show, newest first, already capped. */
  lines: CatchUpLine[];
  /** How many rows the gap held in total, so the cap can say what it hid. */
  total: number;
  /** When the app was last running, which is what the gap is measured from. */
  since: number;
  /**
   * When this was worked out, which is the other end of the gap.
   *
   * Held rather than read from the clock when the card draws. The card can
   * sit on screen for hours, and it can be held back for hours while a
   * warning stands, so measuring against the current time turned a five-hour
   * absence into an eight-hour one while the lines below it still covered
   * five.
   */
  at: number;
}

export interface CatchUpLine {
  id: string;
  place: string;
  text: string;
  /** The row's own observed time, formatted, or a plain word when it has none. */
  when: string;
  kind: string;
}

/** More than this on a launch is a wall of text rather than a summary. */
export const CATCH_UP_LINES = 5;

/**
 * How long the app has to have been away before there is anything to catch up on.
 *
 * A restart to change a setting is not an absence. Four hours is long enough
 * that a reader has been doing something else and short enough to cover a
 * night's sleep, which is the gap this is actually for.
 */
export const CATCH_UP_GAP_MS = 4 * 60 * 60_000;

/**
 * The summary, or null when there is no gap worth summarising.
 *
 * Null and an empty summary are different answers: null means the app was not
 * away, and an empty one means it was away and nothing happened, which is
 * worth a line of its own.
 */
export function catchUpFrom(
  rows: readonly JournalRow[],
  since: number,
  now: number,
): CatchUp | null {
  if (!Number.isFinite(since) || since <= 0) return null;
  if (now - since < CATCH_UP_GAP_MS) return null;

  const during = rows.filter((row) => {
    const at = Date.parse(row.observed);
    // A row whose time cannot be read cannot be placed inside the gap, and
    // guessing would be the one thing this must not do.
    if (!Number.isFinite(at)) return false;
    return at > since && at <= now;
  });

  const lines = during
    .slice()
    .reverse()
    .slice(0, CATCH_UP_LINES)
    .map((row) => ({
      id: row.id,
      place: row.place,
      text: row.text,
      when: formatClock(Date.parse(row.observed), {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
      kind: row.kind,
    }));

  return { lines, total: during.length, since, at: now };
}

/** How long the app was away, in the reader's own words. */
export function awayFor(since: number, now: number): string {
  const hours = Math.floor((now - since) / 3_600_000);
  if (hours < 48) return translate("catchUp.awayHours", { hours });
  return translate("catchUp.awayDays", { days: Math.floor(hours / 24) });
}

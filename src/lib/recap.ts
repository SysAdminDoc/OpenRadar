import { formatNumber, translate } from "../i18n";
import { formatClock } from "./units";
import type { JournalRow } from "./journal";

/**
 * A year at your own places, assembled on your machine from your own record.
 *
 * The rules are the whole of it, because this is the sort of feature that is
 * normally built on data collected about somebody:
 *
 * - Every figure comes from the record on this disk. Nothing is fetched, no
 *   figure is estimated, and a recap of a record that has been turned off is
 *   unavailable rather than guessed at.
 * - It says how much of the period it can actually speak for. A record that
 *   started in March cannot describe January, and a recap that quietly counts
 *   ten months as a year is a lie told with true numbers.
 * - Missing coverage is missing, never zero. "No warnings in January" and
 *   "the record did not exist in January" are different statements.
 * - Nothing is compared, ranked or scored. There is no other person's year in
 *   here and no target to beat.
 * - It is available on any date. Somebody who installed the app in March
 *   should not have to wait until December to look at their own record.
 */
export interface Recap {
  /** The window asked for, in milliseconds. */
  from: number;
  to: number;
  /** The first row the record holds, or null when it holds none. */
  recordBegan: number | null;
  /**
   * How far back into the window the record reaches, in days.
   *
   * The window, clipped to the moment the record begins. Deliberately not
   * called coverage: a reader who ran the app in January and again in
   * December has a record reaching back eleven months with nothing in the
   * middle, and calling that eleven months of coverage would be the exact lie
   * this figure exists to prevent. What is actually known is on the next line
   * down, and the copy says the record cannot tell a quiet day from a day it
   * was closed.
   */
  daysReachingBack: number;
  /** How many days the window is, so the two can be shown side by side. */
  daysInPeriod: number;
  /** Days that actually have a row on them, which is not the same thing. */
  daysWithSomething: number;
  /** One entry per named place, in the order they first appear. */
  places: RecapPlace[];
  /** How many rows of each kind, over the whole window. */
  alerts: number;
  observations: number;
  /**
   * The busiest day, held as a real observed time rather than a day number.
   *
   * A day number built as a UTC midnight and then formatted in the reader's
   * own zone printed the day before for everybody west of Greenwich, which is
   * most of this app's readers. Keeping an instant that actually falls on the
   * day means the formatter cannot disagree with the grouping.
   */
  busiest: { at: number; rows: number } | null;
  /**
   * Everyone whose reading is counted here, named.
   *
   * Taken from the rows rather than from a list somebody wrote, so a picture
   * of this credits exactly what it was built from. A recap is a derived work
   * of the offices and stations that made the observations.
   */
  sources: string[];
}

export interface RecapPlace {
  name: string;
  alerts: number;
  observations: number;
}

const DAY_MS = 86_400_000;

/**
 * Which day a time falls on, in the reader's own words.
 *
 * The formatter's own answer, not a calculation beside it. Days here are
 * counted and displayed by the same rule, so a reader whose clock is set to
 * UTC and a reader in Chicago each get their own day boundaries and each get
 * a date that matches the rows they can see.
 */
function dayOf(at: number): string {
  return formatClock(at, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * The recap for a window, or null when the record cannot speak for it at all.
 *
 * Null rather than a recap of zeroes: a record that holds nothing inside the
 * window has no year to show, and drawing one made of noughts would present
 * an absence of records as an absence of weather.
 */
export function recapFrom(
  rows: readonly JournalRow[],
  from: number,
  to: number,
): Recap | null {
  const dated = rows
    .map((row) => ({ row, at: Date.parse(row.observed) }))
    .filter((one) => Number.isFinite(one.at));
  if (!dated.length) return null;

  const recordBegan = Math.min(...dated.map((one) => one.at));
  const inside = dated.filter((one) => one.at >= from && one.at <= to);
  if (!inside.length) return null;

  const places: RecapPlace[] = [];
  const byName = new Map<string, RecapPlace>();
  const days = new Map<string, { at: number; rows: number }>();
  const sources = new Set<string>();
  let alerts = 0;
  let observations = 0;

  for (const { row, at } of inside) {
    let place = byName.get(row.place);
    if (!place) {
      place = { name: row.place, alerts: 0, observations: 0 };
      byName.set(row.place, place);
      places.push(place);
    }
    if (row.kind === "alert") {
      place.alerts += 1;
      alerts += 1;
    } else {
      place.observations += 1;
      observations += 1;
    }
    if (row.source) sources.add(row.source);
    const day = dayOf(at);
    const held = days.get(day);
    if (held) held.rows += 1;
    else days.set(day, { at, rows: 1 });
  }

  let busiest: { at: number; rows: number } | null = null;
  for (const day of days.values()) {
    if (!busiest || day.rows > busiest.rows) busiest = day;
  }

  // The window, clipped to the moment the record begins. Rounded down, not to
  // nearest: a record that began ten hours into the year rounded to a full
  // three hundred and sixty-five days and then read as complete.
  const reach = Math.max(0, to - Math.max(from, recordBegan));

  return {
    from,
    to,
    recordBegan,
    daysReachingBack: Math.floor(reach / DAY_MS),
    daysInPeriod: Math.round((to - from) / DAY_MS),
    daysWithSomething: days.size,
    places,
    alerts,
    observations,
    busiest,
    sources: [...sources].sort(),
  };
}

/** The line a picture of the recap carries along its foot. */
export function recapCredits(recap: Recap): string {
  return translate("recap.credits", { sources: recap.sources.join(", ") });
}

/**
 * Whether the record begins after the window does.
 *
 * Compared as instants rather than as day counts. Rounding the two counts and
 * comparing those called a record that began ten hours into the year a full
 * year, which is exactly the reading this is here to prevent.
 */
export function partial(recap: Recap): boolean {
  return recap.recordBegan !== null && recap.recordBegan > recap.from;
}

/**
 * The recap as the lines a card carries, in the reader's own language.
 *
 * Separate from the drawing, so what a picture says can be tested without a
 * canvas, and so the panel and the picture cannot drift into saying different
 * things about the same record.
 */
export function recapLines(
  recap: Recap,
  options: { places: boolean },
): string[] {
  const lines = [
    // With the year on both ends. Without it a year-long window read "Sep 2
    // to Sep 2", which says nothing about which year either end is in.
    translate("recap.period", {
      from: formatClock(recap.from, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      to: formatClock(recap.to, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    }),
    // The honesty lines, first among the figures rather than in a footnote.
    partial(recap) && recap.recordBegan !== null
      ? translate("recap.began", {
          when: formatClock(recap.recordBegan, {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          days: formatNumber(recap.daysReachingBack),
          period: formatNumber(recap.daysInPeriod),
        })
      : translate("recap.coveredWhole", {
          period: formatNumber(recap.daysInPeriod),
        }),
    // Raw numbers, not formatted ones: these sentences choose their words by
    // the count, and a plural block cannot read "1,024" as a number.
    translate("recap.counted", {
      alerts: recap.alerts,
      observations: recap.observations,
    }),
    // And what a day with nothing on it means, which is two different things
    // the record genuinely cannot tell apart.
    translate("recap.days", {
      days: recap.daysWithSomething,
    }),
  ];

  if (recap.busiest) {
    lines.push(
      translate("recap.busiest", {
        when: formatClock(recap.busiest.at, {
          month: "long",
          day: "numeric",
        }),
        rows: recap.busiest.rows,
      }),
    );
  }

  // The place names are the reader's own words for where they live, so they
  // go on a picture only when the reader puts them there.
  if (options.places) {
    for (const place of recap.places) {
      lines.push(
        translate("recap.place", {
          place: place.name,
          alerts: place.alerts,
          observations: place.observations,
        }),
      );
    }
  } else if (recap.places.length) {
    lines.push(
      translate("recap.placesHidden", {
        count: recap.places.length,
      }),
    );
  }

  return lines;
}

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
   * How many days of the window the record can speak for.
   *
   * The window, clipped to the day the record began. This is the figure that
   * keeps a partial year from reading as a full one.
   */
  daysCovered: number;
  /** How many days the window is, so the two can be shown side by side. */
  daysInPeriod: number;
  /** Days that actually have a row on them, which is not the same thing. */
  daysWithSomething: number;
  /** One entry per named place, in the order they first appear. */
  places: RecapPlace[];
  /** How many rows of each kind, over the whole window. */
  alerts: number;
  observations: number;
  /** The day with the most rows, or null when the record has none. */
  busiest: { day: number; rows: number } | null;
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

/** The local day a time falls on, as a number, so days can be counted. */
function dayOf(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
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
  const days = new Map<number, number>();
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
    days.set(day, (days.get(day) ?? 0) + 1);
  }

  let busiest: { day: number; rows: number } | null = null;
  for (const [day, rows] of days) {
    if (!busiest || rows > busiest.rows) busiest = { day, rows };
  }

  // The window, clipped to the day the record began. A record that started in
  // March cannot describe January, and this is the figure that says so.
  const covered = Math.max(0, to - Math.max(from, recordBegan));

  return {
    from,
    to,
    recordBegan,
    daysCovered: Math.round(covered / DAY_MS),
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

/** Whether the record covers less of the window than the window is. */
export function partial(recap: Recap): boolean {
  return recap.daysCovered < recap.daysInPeriod;
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
    translate("recap.period", {
      from: formatClock(recap.from, { month: "short", day: "numeric" }),
      to: formatClock(recap.to, { month: "short", day: "numeric" }),
    }),
    // The honesty line, first among the figures rather than in a footnote.
    partial(recap)
      ? translate("recap.covered", {
          days: formatNumber(recap.daysCovered),
          period: formatNumber(recap.daysInPeriod),
        })
      : translate("recap.coveredWhole", {
          period: formatNumber(recap.daysInPeriod),
        }),
    translate("recap.counted", {
      alerts: formatNumber(recap.alerts),
      observations: formatNumber(recap.observations),
    }),
    translate("recap.days", {
      days: formatNumber(recap.daysWithSomething),
    }),
  ];

  if (recap.busiest) {
    lines.push(
      translate("recap.busiest", {
        when: formatClock(recap.busiest.day, {
          month: "long",
          day: "numeric",
        }),
        rows: formatNumber(recap.busiest.rows),
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
          alerts: formatNumber(place.alerts),
          observations: formatNumber(place.observations),
        }),
      );
    }
  } else if (recap.places.length) {
    lines.push(
      translate("recap.placesHidden", {
        count: formatNumber(recap.places.length),
      }),
    );
  }

  return lines;
}

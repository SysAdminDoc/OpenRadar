import type { StormSummary } from "./hurdat";

/**
 * What happened on this date, out of what is already on the disk.
 *
 * The best track record back to 1851 ships with the app and does nothing on
 * the three hundred days a year when the weather is boring. A card that says
 * what was happening on this date in other years is a reason to open a radar
 * app on a calm afternoon, and it costs one file that is already there and no
 * network at all.
 *
 * Two kinds of entry, and they are never mixed up:
 *
 * - A **track** entry is a storm the best track record says was in progress
 *   on this date. It is a fact from a dataset, and it says which dataset.
 * - A **note** is something a person wrote down, out of `public/almanac.json`.
 *   Every one carries a citation, and an entry without one is dropped rather
 *   than shown: an uncited claim about the weather in an app that draws
 *   warnings is worse than an empty card.
 *
 * Nothing here editorialises. A note says what happened and where to read
 * about it; it does not count casualties, rank disasters, or reach for a
 * superlative.
 */
export type AlmanacEntry =
  | {
      kind: "track";
      /** The storm, so the card can fly to it and offer the replay. */
      storm: StormSummary;
    }
  | {
      kind: "note";
      note: AlmanacNote;
    };

export interface AlmanacNote {
  /** Stable, so a note can be recognised across rebuilds of the file. */
  id: string;
  /** The date it is about, in the calendar rather than in any time zone. */
  year: number;
  month: number;
  day: number;
  /** One line. What happened, in plain words. */
  title: string;
  /** Who says so. A publication, an office, a dataset. */
  source: string;
  /** Where to read it. Required: an entry without one is not shown. */
  url: string;
  /** Where it happened, for the card to fly to. Absent for a note with no one place. */
  place?: { lon: number; lat: number };
}

/** The most entries a card carries, so it stays a card rather than a list. */
export const ALMANAC_MAX = 4;

function isNote(value: unknown): value is AlmanacNote {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<AlmanacNote>;
  const numbers = [raw.year, raw.month, raw.day];
  if (
    numbers.some((one) => typeof one !== "number" || !Number.isInteger(one))
  ) {
    return false;
  }
  if ((raw.month ?? 0) < 1 || (raw.month ?? 0) > 12) return false;
  if ((raw.day ?? 0) < 1 || (raw.day ?? 0) > 31) return false;
  for (const key of ["id", "title", "source", "url"] as const) {
    if (typeof raw[key] !== "string" || !raw[key]?.trim()) return false;
  }
  // The citation has to be one, not a sentence saying there is one.
  return /^https:\/\//.test(raw.url ?? "");
}

/** The notes in a file, with anything uncited or malformed left out. */
export function readNotes(value: unknown): AlmanacNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: AlmanacNote[] = [];
  for (const entry of value) {
    if (!isNote(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Whether a storm's track covers this month and day in its own year. */
function coversDate(storm: StormSummary, month: number, day: number): boolean {
  // Walked a day at a time in UTC, because the record is a UTC record and a
  // storm that ran for a week covers seven dates rather than two.
  const start = new Date(storm.start * 1000);
  const end = new Date(storm.end * 1000);
  for (
    let at = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    at <= end.getTime();
    at += 86_400_000
  ) {
    const on = new Date(at);
    if (on.getUTCMonth() + 1 === month && on.getUTCDate() === day) return true;
  }
  return false;
}

/**
 * The card for one date: the notes first, then the strongest storms.
 *
 * The notes come first because somebody wrote them down on purpose. The
 * storms are ordered by how strong they got, which is the only ordering the
 * dataset supports without an opinion in it.
 */
export function almanacFor(
  at: Date,
  storms: readonly StormSummary[],
  notes: readonly AlmanacNote[],
): AlmanacEntry[] {
  const month = at.getMonth() + 1;
  const day = at.getDate();
  const onDay = notes
    .filter((note) => note.month === month && note.day === day)
    .sort((left, right) => right.year - left.year)
    .map((note): AlmanacEntry => ({ kind: "note", note }));

  const tracks = storms
    .filter((storm) => coversDate(storm, month, day))
    .sort(
      (left, right) =>
        right.peakWindKt - left.peakWindKt || right.year - left.year,
    )
    .map((storm): AlmanacEntry => ({ kind: "track", storm }));

  return [...onDay, ...tracks].slice(0, ALMANAC_MAX);
}

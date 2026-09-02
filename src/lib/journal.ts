import { isDesktopRuntime } from "./settings";
import { log } from "./log";

/**
 * A bounded local record of what the weather did at the reader's own places.
 *
 * The rules live with the file itself, in `src-tauri/src/journal.rs`. What
 * matters on this side is which rows are ever offered to it:
 *
 * - Only a place the reader named. A coordinate they never called anything is
 *   not a place they have claimed.
 * - Only the weather. Nothing about how the app was used goes anywhere near
 *   this: no panel opened, no command run, no launch, no session. If a change
 *   here ever needs a row about the reader rather than about the sky, the
 *   change is wrong.
 * - Only with a source and a time. A row that cannot say where it came from
 *   or when the thing happened is not worth keeping.
 */
export interface JournalRow {
  /**
   * This row and no other.
   *
   * Written by the file, not by the caller: a row is offered without one and
   * comes back with one. It is what a note is attached to and what a delete
   * finds, so it has to survive a restart, and a row written by an older build
   * is given one derived from its own content rather than left unreachable.
   */
  id: string;
  /** When the row was written, which is not when the weather happened. */
  at: string;
  /** The reader's own name for the place. Never a coordinate. */
  place: string;
  kind: "alert" | "observation";
  /** Who said it: a station, an office, a service. */
  source: string;
  /** When the thing being recorded was observed or issued. */
  observed: string;
  /** How it was obtained, in the reader's own words rather than a URL. */
  obtained: string;
  /** What was recorded, as one short line. */
  text: string;
  /**
   * The reader's own sentence about it, or empty.
   *
   * The one part of a row a person writes. Everything else is the app saying
   * what the weather did; this is the reason to keep it for a year.
   */
  note: string;
  /** The file name of the frame that was on screen, or empty. */
  thumb: string;
}

/**
 * A row as a caller offers it.
 *
 * The three fields the file owns are missing on purpose. A caller cannot
 * choose an id, cannot write somebody's note for them, and cannot point a row
 * at a picture that has not been through the size and format check.
 */
export type NewJournalRow = Omit<JournalRow, "id" | "note" | "thumb">;

/** Stated where the reader can read it, because the panel says both. */
export const JOURNAL_RETENTION_DAYS = 400;
export const JOURNAL_MAX_MB = 4;

/**
 * How wide a kept frame is, and the most one may weigh.
 *
 * A picture in the journal is an illustration of a row, not evidence: the
 * export beside it is where a full-size frame with its credits burned in comes
 * from. Three hundred and twenty pixels is legible in a list and small enough
 * that a year of them is a few megabytes.
 *
 * The ceiling is checked here and again in `src-tauri/src/journal.rs`, which
 * is the one that counts, and `journal.test.ts` holds the two together.
 */
export const JOURNAL_THUMB_WIDTH = 320;
export const JOURNAL_THUMB_MAX_BYTES = 128 * 1024;

/** The journal is a file, so a browser preview has none. */
export function journalAvailable(): boolean {
  return isDesktopRuntime();
}

/**
 * Writes one row, and keeps the frame that was on screen beside it.
 *
 * The picture is taken by the caller, because only the caller knows what the
 * reader was looking at, and it is taken after the row lands rather than
 * before: a row with no picture is a record, and a picture with no row is
 * nothing at all.
 */
export async function appendJournalRow(
  row: NewJournalRow,
  capture?: () => Promise<Uint8Array | null>,
): Promise<void> {
  if (!journalAvailable()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const id = await invoke<string>("journal_append", {
      row: { ...row, id: "", note: "", thumb: "" },
    });
    if (!id || !capture) return;
    const bytes = await capture();
    if (bytes) await saveJournalThumb(id, bytes);
  } catch (failure) {
    // A row that cannot be written is a row that is not written. Nothing on
    // screen depends on this, and a reader watching a storm does not need a
    // toast about a log file.
    log.info(
      "journal",
      failure instanceof Error ? failure.message : "The row was not written.",
    );
  }
}

export async function journalRows(): Promise<JournalRow[]> {
  if (!journalAvailable()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<JournalRow[]>("journal_rows");
}

export async function clearJournal(): Promise<void> {
  if (!journalAvailable()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("journal_clear");
}

/**
 * Puts the reader's own words on one row, or takes them off again.
 *
 * Unlike an append, this is something a person did on purpose and just
 * watched fail, so it throws rather than going quietly into the log.
 */
export async function setJournalNote(id: string, note: string): Promise<void> {
  if (!journalAvailable()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("journal_note", { id, note });
}

/** Removes one row and the picture that belonged to it. */
export async function removeJournalRow(id: string): Promise<void> {
  if (!journalAvailable()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("journal_remove", { id });
}

/**
 * The frame that was on screen, scaled down to a thumbnail.
 *
 * Null rather than an error when there is nothing to take a picture of, or
 * when what comes back is bigger than the budget: an entry with no picture is
 * a perfectly good entry, and the row has already been written by the time
 * this runs.
 */
export async function thumbnailFrom(
  source: HTMLCanvasElement,
): Promise<Uint8Array | null> {
  if (!source.width || !source.height) return null;
  const scale = Math.min(1, JOURNAL_THUMB_WIDTH / source.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob || blob.size > JOURNAL_THUMB_MAX_BYTES) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Keeps a picture beside a row.
 *
 * Quiet on failure for the same reason the append is: this runs off the back
 * of the weather doing something, not off the back of anything the reader
 * asked for, and a toast about a thumbnail during a warning is noise.
 */
export async function saveJournalThumb(
  id: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!journalAvailable()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("journal_thumb", { id, bytes: Array.from(bytes) });
  } catch (failure) {
    log.info(
      "journal",
      failure instanceof Error ? failure.message : "The picture was not kept.",
    );
  }
}

/** One kept picture's bytes, for the panel to show or the export to write. */
export async function journalThumbData(
  name: string,
): Promise<Uint8Array | null> {
  if (!journalAvailable() || !name) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("journal_thumb_data", { name });
    return new Uint8Array(bytes);
  } catch {
    // A picture the budget took back is a picture that is not there, and a
    // row is still worth showing without it.
    return null;
  }
}

export async function journalPath(): Promise<string | null> {
  if (!journalAvailable()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("journal_path");
}

/**
 * The whole journal as the file it is.
 *
 * One JSON object per line, which is what is on disk. Exported as itself
 * rather than as a format of its own, so what a reader takes away is exactly
 * what the app kept.
 */
export function journalText(rows: readonly JournalRow[]): string {
  return (
    rows.map((row) => JSON.stringify(row)).join("\n") +
    (rows.length ? "\n" : "")
  );
}

/** What a kept picture is called once it is out of the app's own folder. */
export function journalThumbFileName(row: JournalRow): string {
  return `openradar-journal-${row.id}.png`;
}

/**
 * The same record, written for a person rather than for a parser.
 *
 * The export hands over both: the file exactly as it is on disk, and this,
 * which somebody can open in a year without knowing what JSON is. Newest
 * first, because that is the order the panel shows and the order a person
 * reads. Pictures are referenced by the names they are written under beside
 * it, so the folder holds together on its own.
 */
export function journalMarkdown(
  rows: readonly JournalRow[],
  heading: string,
): string {
  const lines = [`# ${heading}`, ""];
  for (const row of [...rows].reverse()) {
    lines.push(`## ${row.place} — ${row.text}`.replace(" — ", ": "));
    lines.push("");
    lines.push(`- Observed: ${row.observed}`);
    lines.push(`- Written down: ${row.at}`);
    lines.push(`- Source: ${row.source}`);
    lines.push(`- Obtained: ${row.obtained}`);
    if (row.thumb) {
      lines.push("");
      lines.push(`![${row.text}](${journalThumbFileName(row)})`);
    }
    if (row.note) {
      lines.push("");
      // The reader's own words, last, as their own paragraph rather than as
      // another field in a list of the app's facts.
      lines.push(row.note);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** What a reader can narrow the record by: a place, a kind, a date, a word. */
export interface JournalFilter {
  /** Matched against the place, the text, the source and the reader's note. */
  query: string;
  /** "alert", "observation", or empty for both. */
  kind: string;
  /** How many days back, or 0 for everything the file still holds. */
  days: number;
}

export const JOURNAL_FILTER: JournalFilter = { query: "", kind: "", days: 0 };

/**
 * The rows a filter leaves, in the order they were written.
 *
 * Dates are compared against `observed`, which is when the weather happened,
 * rather than against `at`, which is when the app got around to writing it
 * down. A row whose observed time will not parse is kept: a filter is for
 * narrowing, and something unreadable is not something to hide.
 */
export function filterJournal(
  rows: readonly JournalRow[],
  filter: JournalFilter,
  now: number,
): JournalRow[] {
  const query = filter.query.trim().toLowerCase();
  const since = filter.days > 0 ? now - filter.days * 86_400_000 : null;
  return rows.filter((row) => {
    if (filter.kind && row.kind !== filter.kind) return false;
    if (since !== null) {
      const at = Date.parse(row.observed);
      if (Number.isFinite(at) && at < since) return false;
    }
    if (!query) return true;
    return [row.place, row.text, row.source, row.note].some((field) =>
      field.toLowerCase().includes(query),
    );
  });
}

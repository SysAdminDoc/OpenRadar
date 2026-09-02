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
}

/** Stated where the reader can read it, because the panel says both. */
export const JOURNAL_RETENTION_DAYS = 400;
export const JOURNAL_MAX_MB = 4;

/** The journal is a file, so a browser preview has none. */
export function journalAvailable(): boolean {
  return isDesktopRuntime();
}

export async function appendJournalRow(row: JournalRow): Promise<void> {
  if (!journalAvailable()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("journal_append", { row });
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

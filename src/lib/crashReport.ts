/**
 * What the last run left behind, when it did not end the way it should.
 *
 * A decoder that walks off the end of a buffer takes the process down with no
 * panic, no line in the log, and no window. The native side now catches that
 * and writes a minidump beside the app's own data; this is how the panel
 * finds out, so a reader whose window vanished has something to point at.
 *
 * The file never leaves the machine. Nothing here uploads it and there is no
 * host for one in the allowlist; the app says where it is and stops there.
 */

import { isDesktopRuntime } from "./settings";

export interface CrashRecord {
  /** Where the file is, so it can be found without being told how. */
  path: string;
  bytes: number;
  /** When it was written, as RFC 3339. */
  at: string;
}

/** Dumps are written natively, so a browser preview has none of this. */
export function crashReportAvailable(): boolean {
  return isDesktopRuntime();
}

export async function lastCrash(): Promise<CrashRecord | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CrashRecord | null>("crash_last_dump");
}

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

/**
 * The newest report the WINDOW left, which is a different process entirely.
 *
 * A decoder taking the host process down leaves a dump of ours and no window.
 * The renderer falling over leaves a white window that is still there, and a
 * Crashpad report in a folder WebView2 owns, and nothing in ours. The two are
 * reported side by side because from where a reader sits they are the same
 * event: the app stopped working.
 *
 * Read on the same terms as ours: the file never leaves the machine.
 */
export async function lastWebviewReport(): Promise<CrashRecord | null> {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CrashRecord | null>("crash_last_webview_report");
}

/**
 * Which browser is drawing, or null in a browser preview.
 *
 * The runtime updates on the platform's schedule rather than with the app, so
 * two reports of one GPU crash from one build can be two different browsers.
 *
 * Null means one thing only: this is not a native window. A native window
 * that will not say its version REJECTS, so a caller can tell "there is no
 * runtime" from "the runtime did not answer" and the report does not have to
 * claim the first when it means the second.
 */
export async function webviewVersion(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const version = await invoke<string | null>("host_webview_version");
  if (version === null) throw new Error("the runtime would not say");
  return version;
}

/**
 * The version last read, for a caller with no chance to ask.
 *
 * The crash screen has no app left to run an effect: it renders once, out of
 * whatever is reachable from a module. Without this its report said "not a
 * native window" on a native window, in the one report a reader sends after a
 * graphics crash. Undefined until somebody has asked, which reads as unknown
 * rather than as an answer.
 */
export function knownWebviewVersion(): string | null | undefined {
  return known;
}

let known: string | null | undefined;

/** Remembers an answer so the crash screen can use it. */
export function rememberWebviewVersion(version: string | null): void {
  known = version;
}

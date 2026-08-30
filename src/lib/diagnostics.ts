import { APP_VERSION } from "./settings";
import type { LogEntry } from "./log";
import type { ProviderHealth } from "./providers/health";

/**
 * The diagnostics block, as plain text somebody can paste into a bug report.
 *
 * There is no tracker to round-trip through, so the first message a reader
 * sends has to carry enough to work with: what they are running, what the
 * renderer is, which sources are answering, and the last of the log.
 *
 * What it must not carry is where they live or what their account is called.
 * A radar workspace knows the first to four decimal places and the second from
 * every file path it has ever logged, so both are taken out here rather than
 * being left to whoever reads it.
 */

/** About a kilometre, which is a city rather than a house. */
const PLACES = 1;

/**
 * Coordinates in a log line, cut to one decimal.
 *
 * The workspace logs positions at four, which is about ten metres. Matching a
 * signed number with at least two decimals leaves version strings, counts and
 * durations alone.
 */
export function blurCoordinates(line: string): string {
  return line.replace(/-?\d+\.\d{2,}/g, (whole) =>
    Number(whole).toFixed(PLACES),
  );
}

/**
 * A file path under the user's profile, cut back to the part that identifies
 * the file rather than the person.
 *
 * Windows, macOS and Linux profiles all put the account name in the path, so a
 * log line naming a cache file names the reader.
 */
export function blurUserPaths(line: string): string {
  return line
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi, "<home>")
    .replace(/\/Users\/[^/\s"']+/g, "<home>")
    .replace(/\/home\/[^/\s"']+/g, "<home>");
}

/**
 * Both, for a line that could carry either.
 *
 * The coordinate blur cannot run over the whole block. A user agent string
 * carries version numbers shaped exactly like coordinates, so blurring
 * everything turned "Chrome/140.0.7339.16" into "Chrome/140.0.7339.2" and made
 * the one field that says what the reader is running useless. Positions only
 * ever appear in what the workspace logged, so that is where it runs; paths
 * can appear anywhere, so that runs over everything.
 */
export function redact(line: string): string {
  return blurUserPaths(blurCoordinates(line));
}

export interface DiagnosticsInput {
  renderer: string | null;
  mapReady: boolean;
  radarReady: boolean;
  activeSource: string | null;
  health: ProviderHealth[];
  log: LogEntry[];
  /** What the window is running in, when the native side can say. */
  platform?: string | null;
  webview?: string | null;
}

export function diagnosticsBlock(input: DiagnosticsInput): string {
  const lines: string[] = [
    `OpenRadar ${APP_VERSION}`,
    `Platform: ${input.platform ?? navigator.platform ?? "unknown"}`,
    `Webview: ${input.webview ?? navigator.userAgent}`,
    `Renderer: ${input.renderer ?? "unknown"}`,
    `Map ready: ${input.mapReady} · Radar ready: ${input.radarReady}`,
    `Source: ${input.activeSource ?? "none"}`,
    "",
    "Sources:",
  ];
  for (const entry of input.health) {
    const failing =
      entry.consecutiveFailures > 0
        ? ` · ${entry.consecutiveFailures} failed in a row`
        : "";
    lines.push(
      `  ${entry.id}: ${entry.lastError ? "error" : "ok"}${failing}${
        entry.lastError ? ` · ${entry.lastError}` : ""
      }`,
    );
  }
  const head = lines.map(blurUserPaths);
  // Only the message. A timestamp's own milliseconds are shaped exactly like
  // a coordinate, so blurring the whole line turned 12:01:00.000Z into
  // 12:01:0.0 and threw away the one thing that orders the log.
  const logged = input.log.map(
    (entry) =>
      `  ${new Date(entry.at).toISOString()} ${entry.level} ${entry.scope}: ${redact(entry.message)}`,
  );
  return [...head, "", "Log:", ...logged].join("\n");
}

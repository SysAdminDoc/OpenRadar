import { APP_VERSION } from "./settings";
import type { LogEntry } from "./log";
import type { ProviderHealth } from "./providers/health";
import {
  provenanceLines,
  provenanceProblems,
  type Provenance,
} from "./provenance";

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
 * The workspace logs positions at four, which is about ten metres.
 *
 * A version number is shaped exactly like a coordinate, and log lines carry
 * plenty of them: the updater names versions, and a user agent has several.
 * Blurring every signed decimal turned "Chrome/140.0.7339.16" into
 * "Chrome/140.0.7.16" and "build 1.0.7339" into "build 1.0.7", which is worse
 * than useless because it still reads like a version. So a number that has
 * another dotted number on either side of it is left alone: that is what
 * separates 1.0.7339 from a latitude, and no coordinate is ever written that
 * way.
 *
 * A coordinate is also bounded. Nothing outside ±180 is one, and a number that
 * large with decimals is a byte count or an identifier.
 */
const COORDINATE = /(?<![\d.])(-?\d{1,3}\.\d{2,})(?![\d]*\.\d)/g;

export function blurCoordinates(line: string): string {
  return line.replace(COORDINATE, (whole) => {
    const value = Number(whole);
    if (!Number.isFinite(value) || Math.abs(value) > 180) return whole;
    return value.toFixed(PLACES);
  });
}

/**
 * A file path under the user's profile, cut back to the part that identifies
 * the file rather than the person.
 *
 * Windows, macOS and Linux profiles all put the account name in the path, so a
 * log line naming a cache file names the reader.
 */
export function blurUserPaths(line: string): string {
  return (
    line
      // A drive-letter profile, however the drive is spelled and whatever the
      // folder above it is called: a redirected profile root sits under
      // D:\Profiles rather than C:\Users, and names the reader just the same.
      //
      // The account name runs to the next separator rather than to the next
      // space. Stopping at a space left the second half of "John Smith"
      // behind, and a surname on its own still names somebody.
      .replace(
        /[A-Za-z]:[\\/](?:Users|Profiles|home)[\\/][^\\/"']+/gi,
        "<home>",
      )
      // A home directory served over the network. Nothing above matches a
      // path that starts with two separators and a server name.
      .replace(
        /\\\\[^\\/"']+[\\/](?:Users|Profiles|home)[\\/][^\\/"']+/gi,
        "<home>",
      )
      .replace(/\/(?:Users|home)\/[^/"']+/gi, "<home>")
      // A user name in a URL, which is both a name and half a credential.
      .replace(/\/\/[^/\s"']+@/g, "//<user>@")
  );
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
  /**
   * Where each drawn layer came from and what it claims.
   *
   * A report saying a source is answering does not say what it answered with,
   * and most of what gets reported about a radar app is really a disagreement
   * about time: a picture that looked stale, a forecast that was read as an
   * observation, a frame that came off the disk during an outage. The records
   * carry all three, so they belong in the block a reader pastes.
   */
  layers?: Provenance[];
  /** The moment the block is written, so staleness can be judged against it. */
  now?: number;
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
      // The message a source failed with is whatever the service or the
      // network said, and a request URL carries the position it was asking
      // about. It goes through the same redaction the log does.
      `  ${entry.id}: ${entry.lastError ? "error" : "ok"}${failing}${
        entry.lastError ? ` · ${redact(entry.lastError)}` : ""
      }`,
    );
  }
  if (input.layers?.length) {
    lines.push("", "Layers:");
    for (const record of input.layers) {
      // A record that does not meet the contract is reported as such rather
      // than written out as though it did. The whole point of this block is
      // that somebody can trust what it says about a layer, and confident
      // nonsense in a bug report is worse than an admission.
      const problems = provenanceProblems(record);
      if (problems.length) {
        lines.push(`  ${record.sourceId}: record is not well formed`);
        for (const problem of problems) lines.push(`    ${problem}`);
        continue;
      }
      // Indented under the section the way a source entry is, so the block
      // stays scannable when a reader has several layers on at once.
      for (const line of provenanceLines(record, input.now)) {
        lines.push(`  ${line}`);
      }
    }
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

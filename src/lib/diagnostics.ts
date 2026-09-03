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
  /**
   * What the app is holding on disk.
   *
   * Half the reports a radar app gets are really about the cache: a picture
   * that would not refresh, an offline pack that would not open, a loop that
   * came off the disk during an outage and was read as live. None of that is
   * visible from the log alone.
   */
  cache?: CacheState;
  /**
   * The reader's watched place, and only when they have asked for it to be
   * included.
   *
   * Everything else in this block is about the machine. This is about the
   * person, so it is never gathered by default: the panel has a switch, and
   * the switch is off until somebody turns it on.
   */
  place?: { label: string; latitude: number; longitude: number } | null;
  /**
   * What the last run left behind, when it ended abnormally.
   *
   * The one thing a reader whose window vanished can actually hand over. Left
   * out entirely when there is nothing, because "no crash" is the ordinary
   * state and a line saying so on every report is noise.
   */
  lastCrash?: { path: string; bytes: number; at: string } | null;
  /**
   * The render failure this report is about, when it is about one.
   *
   * The crash screen has no app left to ask, so it fills in what it can and
   * hands over the one thing a tracker actually needs: the message and the
   * stacks. It never passes `place`, so a reader's watched place cannot reach
   * a report written from a crash.
   */
  failure?: {
    message: string;
    stack: string | null;
    componentStack: string | null;
  } | null;
}

/** What is on disk, as the workspace can see it without asking the disk. */
export interface CacheState {
  /**
   * How old the bytes on screen were when the disk served them, in seconds,
   * or null when the last loop came off the network.
   */
  servedAgeSeconds: number | null;
  /** Offline basemap packs installed, and how much they take up. */
  packs: number;
  packBytes: number;
  /** The pack in use as the basemap, if one is. */
  selectedPack: boolean;
  /** The ceiling the pack store is held to, in MiB. */
  packLimitMb: number;
}

/** The most log lines a report carries, newest last. */
export const LOG_LIMIT = 40;

/**
 * The log as counts before it is a list.
 *
 * A report with forty lines in it is read by nobody. The same forty lines as
 * "radar: 6 warnings, 1 error" is read by everybody, and it is also the part
 * that survives when the lines themselves are cut for length.
 */
export function errorSummary(log: LogEntry[]): string[] {
  const counts = new Map<string, Map<string, number>>();
  for (const entry of log) {
    if (entry.level !== "warn" && entry.level !== "error") continue;
    const levels = counts.get(entry.scope) ?? new Map<string, number>();
    levels.set(entry.level, (levels.get(entry.level) ?? 0) + 1);
    counts.set(entry.scope, levels);
  }
  return [...counts]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([scope, levels]) => {
      const parts = [...levels]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([level, count]) => `${count} ${level}`);
      return `  ${scope}: ${parts.join(", ")}`;
    });
}

export function diagnosticsBlock(input: DiagnosticsInput): string {
  const lines: string[] = [
    `OpenRadar ${APP_VERSION}`,
    `Platform: ${input.platform ?? navigator.platform ?? "unknown"}`,
    `Webview: ${input.webview ?? navigator.userAgent}`,
    `Renderer: ${input.renderer ?? "unknown"}`,
    `Map ready: ${input.mapReady} · Radar ready: ${input.radarReady}`,
    `Source: ${input.activeSource ?? "none"}`,
  ];
  if (input.failure) {
    // First, because it is the thing that happened. The message goes through
    // `redact` like the stacks and like every other error string in this
    // block: a fetch failure names the URL it failed on, and a request for a
    // forecast carries the reader's latitude and longitude to four decimals,
    // which is about ten metres. It was the one error-shaped string here that
    // went in raw.
    lines.push(
      "",
      "The workspace stopped drawing:",
      `  ${redact(input.failure.message)}`,
    );
    for (const stack of [input.failure.stack, input.failure.componentStack]) {
      if (!stack) continue;
      for (const line of stack.split("\n")) {
        if (line.trim()) lines.push(`  ${redact(line.trimEnd())}`);
      }
    }
  }
  if (input.lastCrash) {
    // Ahead of everything else, because it is the thing that happened.
    lines.push(
      "",
      "A previous run ended abnormally:",
      // The path goes through the same redaction every other line does: it
      // holds the reader's own user folder.
      `  ${redact(input.lastCrash.path)}`,
      `  written ${input.lastCrash.at}, ${input.lastCrash.bytes} bytes`,
    );
  }
  lines.push("", "Sources:");
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
  if (input.cache) {
    const { servedAgeSeconds, packs, packBytes, selectedPack, packLimitMb } =
      input.cache;
    lines.push("", "On disk:");
    lines.push(
      `  Last loop: ${
        servedAgeSeconds === null
          ? "from the network"
          : `served from the cache, ${servedAgeSeconds} s old`
      }`,
    );
    lines.push(
      `  Offline packs: ${packs}` +
        (packs
          ? ` · ${Math.round(packBytes / (1024 * 1024))} MB of ${packLimitMb} MB · ${
              selectedPack ? "one in use" : "none in use"
            }`
          : ""),
    );
  }

  // The place is the one thing here that is about the reader rather than the
  // machine, so it is written out only when it was handed over.
  if (input.place) {
    lines.push("", "Watched place (added by the reader):");
    lines.push(
      `  ${input.place.label}: ${input.place.latitude.toFixed(PLACES)}, ${input.place.longitude.toFixed(PLACES)}`,
    );
  }

  const problems = errorSummary(input.log);
  if (problems.length) lines.push("", "Recent problems:", ...problems);

  const head = lines.map(blurUserPaths);
  // Bounded, newest kept. A report is pasted into a tracker by hand, and the
  // whole log of a long session is not something anybody reads or wants to
  // scroll past to reach the question.
  const kept = input.log.slice(-LOG_LIMIT);
  const dropped = input.log.length - kept.length;
  // Only the message. A timestamp's own milliseconds are shaped exactly like
  // a coordinate, so blurring the whole line turned 12:01:00.000Z into
  // 12:01:0.0 and threw away the one thing that orders the log.
  const logged = kept.map(
    (entry) =>
      `  ${new Date(entry.at).toISOString()} ${entry.level} ${entry.scope}: ${redact(entry.message)}`,
  );
  const header = dropped
    ? `Log (last ${kept.length} of ${input.log.length}):`
    : "Log:";
  return [...head, "", header, ...logged].join("\n");
}

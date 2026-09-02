import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  journalText,
  JOURNAL_MAX_MB,
  JOURNAL_RETENTION_DAYS,
  type JournalRow,
} from "./journal";
import { diagnosticsBlock } from "./diagnostics";

const row = (over: Partial<JournalRow> = {}): JournalRow => ({
  at: "2026-09-02T13:05:00.000Z",
  place: "Casa",
  kind: "observation",
  source: "KDAL",
  observed: "2026-09-02T13:00:00.000Z",
  obtained: "a station report near a place you watch",
  text: "rain",
  ...over,
});

describe("the record a reader takes away", () => {
  it("is the file itself, one row to a line", () => {
    // Exported as what is on disk rather than as a format of its own, so
    // what a reader carries off is what the app kept.
    const text = journalText([row(), row({ text: "snow" })]);
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(row());
    expect(JSON.parse(lines[1]).text).toBe("snow");
    // And it ends with a newline, the way a line-delimited file does.
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is nothing at all when there is nothing in it", () => {
    expect(journalText([])).toBe("");
  });

  it("carries a source and a time on every row", () => {
    // A row that cannot say where it came from or when the thing happened is
    // not worth keeping, so the shape says so.
    const written = row();
    for (const key of ["place", "source", "observed", "obtained"] as const) {
      expect(written[key], key).toBeTruthy();
    }
  });
});

describe("the bounds the panel promises", () => {
  it("are the bounds the file is actually held to", () => {
    // Two hand-typed copies of the same two numbers, in two languages, with
    // the panel note, the README and the privacy section quoting them. This
    // is what keeps them from drifting into a lie.
    const rust = readFileSync(
      join(import.meta.dirname, "..", "..", "src-tauri", "src", "journal.rs"),
      "utf8",
    );
    const days = /RETENTION_DAYS: i64 = (\d+)/.exec(rust)?.[1];
    const megabytes = /MAX_BYTES: u64 = (\d+) \* 1024 \* 1024/.exec(rust)?.[1];
    expect(Number(days)).toBe(JOURNAL_RETENTION_DAYS);
    expect(Number(megabytes)).toBe(JOURNAL_MAX_MB);
  });
});

describe("what the log may say about it", () => {
  it("counts the places rather than naming them", () => {
    // `redact` blurs coordinates and folder names and knows nothing about
    // what somebody called their house, so the only defence is not putting a
    // name in the line. Read off the source, because the alternative is a
    // test that asserts a property of a string it wrote itself.
    const source = readFileSync(
      join(import.meta.dirname, "..", "hooks", "useAlertWatch.ts"),
      "utf8",
    );
    for (const call of source.matchAll(/log\.\w+\(([\s\S]{0,400}?)\);/g)) {
      expect(call[1], call[1].slice(0, 80)).not.toMatch(
        /place\.name|\bnamed\b|places\.map/,
      );
    }
    // And the line that does exist says how many, which is the part that
    // helps somebody reading a bug report.
    expect(source).toContain("watched place(s)");
  });
});

describe("what the diagnostics report may say about it", () => {
  it("says nothing at all", () => {
    // The one file in the app that writes down where somebody lives is not in
    // the block a reader pastes into a bug report. The report is built from a
    // fixed list and this holds that list to it.
    // Handed a log line that names a place, which is the only way a name can
    // reach the block at all: `redact` blurs coordinates and folder names and
    // knows nothing about what somebody called their house. The old version
    // of this test passed an empty log and asserted a name it had never given
    // anything, so it could not fail for the reason it exists.
    const block = diagnosticsBlock({
      renderer: "test",
      mapReady: true,
      radarReady: true,
      activeSource: "mrms",
      health: [],
      log: [
        {
          at: Date.now(),
          level: "info",
          scope: "watch",
          message: "Announced Tornado Warning at 2 watched place(s).",
        },
      ],
      platform: "windows",
    });
    expect(block).toContain("Announced Tornado Warning");
    // The count is what helps somebody reading a bug report. The names are
    // the reader's own and are not in it.
    expect(block).not.toContain("Casa");
    expect(block).not.toContain("journal.jsonl");
  });
});

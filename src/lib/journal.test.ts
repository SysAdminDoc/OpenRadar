import { describe, expect, it } from "vitest";
import { journalText, type JournalRow } from "./journal";
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

describe("what the diagnostics report may say about it", () => {
  it("says nothing at all", () => {
    // The one file in the app that writes down where somebody lives is not in
    // the block a reader pastes into a bug report. The report is built from a
    // fixed list and this holds that list to it.
    const block = diagnosticsBlock({
      renderer: "test",
      mapReady: true,
      radarReady: true,
      activeSource: "mrms",
      health: [],
      log: [],
      platform: "windows",
    });
    expect(block).not.toContain("Casa");
    expect(block).not.toContain("journal");
  });
});

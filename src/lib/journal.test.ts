import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterJournal,
  journalMarkdown,
  journalText,
  journalThumbFileName,
  setJournalWriting,
  appendJournalRow,
  JOURNAL_MAX_MB,
  JOURNAL_RETENTION_DAYS,
  JOURNAL_THUMB_MAX_BYTES,
  JOURNAL_THUMBS_MAX_MB,
  type JournalRow,
} from "./journal";
import { diagnosticsBlock } from "./diagnostics";

const row = (over: Partial<JournalRow> = {}): JournalRow => ({
  id: "one",
  note: "",
  thumb: "",
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
    const thumb = /MAX_THUMB_BYTES: usize = (\d+) \* 1024;/.exec(rust)?.[1];
    const thumbs = /MAX_THUMBS_BYTES: u64 = (\d+) \* 1024 \* 1024/.exec(
      rust,
    )?.[1];
    expect(Number(days)).toBe(JOURNAL_RETENTION_DAYS);
    expect(Number(megabytes)).toBe(JOURNAL_MAX_MB);
    // The pictures sit beside the file with a budget of their own, and the
    // panel note states it. A record promised as four megabytes with eight
    // more in a neighbouring directory is a promise nobody kept.
    expect(Number(thumbs)).toBe(JOURNAL_THUMBS_MAX_MB);
    // The picture budget is checked on both sides, and only one of them is
    // the one that counts. A thumbnail refused by Rust after passing here is
    // a picture the reader was told was kept.
    expect(Number(thumb) * 1024).toBe(JOURNAL_THUMB_MAX_BYTES);
  });
});

describe("narrowing the record", () => {
  const now = Date.parse("2026-09-02T13:05:00.000Z");
  const rows = [
    row({
      id: "a",
      place: "Casa",
      kind: "alert",
      text: "Severe Thunderstorm Warning",
      observed: "2026-08-01T09:00:00.000Z",
    }),
    row({ id: "b", place: "Casa", text: "rain", note: "Hail on the roof" }),
    row({ id: "c", place: "The cabin", text: "snow", source: "KBOI" }),
  ];

  it("matches a place, a word in a note, a kind and a date", () => {
    const only = (over: Partial<Parameters<typeof filterJournal>[1]> = {}) =>
      filterJournal(rows, { query: "", kind: "", days: 0, ...over }, now).map(
        (found) => found.id,
      );
    expect(only()).toEqual(["a", "b", "c"]);
    expect(only({ query: "cabin" })).toEqual(["c"]);
    expect(only({ query: "KBOI" })).toEqual(["c"]);
    // The note is the reader's own, so it is the first thing they would
    // search for and the easiest one to leave out of a search.
    expect(only({ query: "hail" })).toEqual(["b"]);
    expect(only({ kind: "alert" })).toEqual(["a"]);
    expect(only({ days: 7 })).toEqual(["b", "c"]);
    expect(only({ days: 7, kind: "observation", query: "snow" })).toEqual([
      "c",
    ]);
  });

  it("keeps a row whose time it cannot read rather than hiding it", () => {
    const stubborn = row({ id: "d", observed: "last Tuesday" });
    const found = filterJournal(
      [...rows, stubborn],
      { ...{ query: "", kind: "", days: 1 } },
      now,
    );
    expect(found.map((one) => one.id)).toContain("d");
  });
});

describe("the record written for a person", () => {
  it("carries every fact the row has, and the note last", () => {
    const text = journalMarkdown(
      [
        row({
          id: "a",
          place: "Casa",
          text: "rain",
          note: "Woke us up.",
          thumb: "kept.png",
        }),
      ],
      "What the weather did",
    );
    expect(text).toContain("# What the weather did");
    expect(text).toContain("Casa: rain");
    // A place name carrying the separator the heading used to be patched
    // through ate the replacement and kept the wrong one.
    expect(
      journalMarkdown([row({ place: "Casa — the old one" })], "H"),
    ).toContain("## Casa — the old one: rain");
    expect(text).toContain("- Observed: 2026-09-02T13:00:00.000Z");
    expect(text).toContain("- Source: KDAL");
    expect(text).toContain(
      "- Obtained: a station report near a place you watch",
    );
    // The picture is referenced by the name it is written under beside this
    // file, not by the name it has inside the app's own folder, or the
    // exported folder is a set of links to nothing.
    expect(text).toContain("(openradar-journal-a.png)");
    expect(text).not.toContain("kept.png");
    expect(text.trimEnd().endsWith("Woke us up.")).toBe(true);
  });

  it("puts the newest first, the way the panel shows them", () => {
    const text = journalMarkdown(
      [row({ id: "a", text: "first" }), row({ id: "b", text: "second" })],
      "Heading",
    );
    expect(text.indexOf("second")).toBeLessThan(text.indexOf("first"));
  });

  it("names a picture after the row it belongs to", () => {
    expect(journalThumbFileName(row({ id: "abc" }))).toBe(
      "openradar-journal-abc.png",
    );
  });
});

describe("switching the record off", () => {
  it("stops every row, whichever thing was writing it", async () => {
    // The rule is about the file rather than about any one writer, so it is
    // held in the one place a row can be written from. A fourth writer added
    // later obeys it without having to remember it.
    const source = readFileSync(
      join(import.meta.dirname, "journal.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /if \(!journalAvailable\(\) \|\| !writing\) return;/,
    );
    // And nothing else in the app reaches past it: a caller cannot set the
    // flag back on its own way in.
    setJournalWriting(false);
    await appendJournalRow({
      at: "2026-09-02T13:05:00.000Z",
      place: "Casa",
      kind: "observation",
      source: "KDAL",
      observed: "2026-09-02T13:00:00.000Z",
      obtained: "a station report near a place you watch",
      text: "rain",
    });
    setJournalWriting(true);
  });
});

describe("what opens an entry", () => {
  /**
   * The three things, and only these three.
   *
   * All of them are the weather doing something at a place the reader named:
   * a warning reaching one, the sky changing at one, and a tracked storm
   * passing one. Nothing the reader does writes a row, which is the rule that
   * keeps this a record of the weather rather than a record of a person, and
   * it is the rule that is easiest to break by accident: an export, a panel
   * opened, a search run, all of them feel like things worth remembering.
   *
   * A fourth caller fails this. That is the point: adding one means saying
   * here what event it is, in a file the reviewer reads.
   */
  const WRITERS = [
    "App.tsx",
    "hooks/useAlertWatch.ts",
    "hooks/useCellJournal.ts",
  ];

  const walk = (from: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(from)) {
      const path = join(from, entry);
      if (statSync(path).isDirectory()) {
        found.push(...walk(path));
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        found.push(path);
      }
    }
    return found;
  };

  it("is the weather, in three named places in the source", () => {
    const root = join(import.meta.dirname, "..");
    const writers = walk(root)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        // The definition and the re-export do not count as writing a row.
        return (
          /appendJournalRow\(/.test(source) && !path.endsWith("lib\\journal.ts")
        );
      })
      .map((path) => path.slice(root.length + 1).replace(/\\/g, "/"))
      .sort();
    expect(writers).toEqual(WRITERS.slice().sort());
  });

  it("is never something the reader did", () => {
    const root = join(import.meta.dirname, "..");
    for (const name of WRITERS) {
      const source = readFileSync(join(root, ...name.split("/")), "utf8");
      // A call reachable from a click, a change or a submit is a row about a
      // person. Read off the source rather than reasoned about, because the
      // reasoning is what goes stale.
      for (const call of source.matchAll(
        /on(?:Click|Change|Submit|Input|PointerDown|KeyDown)=\{([\s\S]{0,600}?)\n\s{0,10}\}/g,
      )) {
        expect(call[1], name).not.toContain("appendJournalRow");
      }
    }
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

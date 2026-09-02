import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  almanacFor,
  ALMANAC_MAX,
  readNotes,
  type AlmanacNote,
} from "./almanac";
import type { StormSummary } from "./hurdat";

const NOTES = readNotes(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "..", "public", "almanac.json"),
      "utf8",
    ),
  ),
);

function storm(over: Partial<StormSummary> = {}): StormSummary {
  return {
    id: "AL092005",
    name: "KATRINA",
    year: 2005,
    basin: "AL",
    ace: 20,
    peakWindKt: 150,
    // 23 to 31 August 2005.
    start: Date.UTC(2005, 7, 23) / 1000,
    end: Date.UTC(2005, 7, 31) / 1000,
    fixes: 34,
    ...over,
  };
}

describe("the curated notes that ship with the app", () => {
  it("every one of them is dated and cited", () => {
    // An uncited claim about the weather, in an app that draws warnings, is
    // worse than an empty card.
    expect(NOTES.length).toBeGreaterThan(0);
    for (const note of NOTES) {
      expect(note.url, note.id).toMatch(/^https:\/\//);
      expect(note.source, note.id).toBeTruthy();
      expect(note.year, note.id).toBeGreaterThan(1800);
      expect(note.month, note.id).toBeGreaterThanOrEqual(1);
      expect(note.day, note.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("none of them counts the dead or reaches for a superlative", () => {
    // A note says what happened and where to read about it. Anything past
    // that is editorialising in a line nobody asked for.
    for (const note of NOTES) {
      expect(note.title, note.id).not.toMatch(
        /killed|death|deaths|deadliest|worst|tragic|devastat|destroy/i,
      );
    }
  });

  it("drops an entry that cannot be checked", () => {
    const good: AlmanacNote = {
      id: "ok",
      year: 2011,
      month: 4,
      day: 27,
      title: "Something happened.",
      source: "NWS",
      url: "https://example.gov/x",
    };
    expect(readNotes([good])).toHaveLength(1);
    // No citation, a citation that is not one, a date that is not a date, and
    // the same id twice.
    expect(readNotes([{ ...good, url: "" }])).toHaveLength(0);
    expect(readNotes([{ ...good, url: "see the NWS page" }])).toHaveLength(0);
    expect(readNotes([{ ...good, month: 13 }])).toHaveLength(0);
    expect(readNotes([{ ...good, day: 0 }])).toHaveLength(0);
    expect(readNotes([{ ...good, source: "  " }])).toHaveLength(0);
    expect(readNotes([good, good])).toHaveLength(1);
    expect(readNotes("not a list")).toHaveLength(0);
  });
});

describe("what happened on this date", () => {
  it("finds a storm on every day its track covers", () => {
    // A storm that ran for nine days is on nine cards, not two.
    for (const day of [23, 27, 31]) {
      const found = almanacFor(new Date(2026, 7, day), [storm()], []);
      expect(found, `August ${day}`).toHaveLength(1);
      expect(found[0].kind).toBe("track");
    }
    expect(almanacFor(new Date(2026, 7, 22), [storm()], [])).toHaveLength(0);
    expect(almanacFor(new Date(2026, 8, 1), [storm()], [])).toHaveLength(0);
  });

  it("puts what somebody wrote down before what a dataset says", () => {
    const note: AlmanacNote = {
      id: "x",
      year: 2011,
      month: 8,
      day: 27,
      title: "Something happened.",
      source: "NWS",
      url: "https://example.gov/x",
    };
    const found = almanacFor(new Date(2026, 7, 27), [storm()], [note]);
    expect(found[0].kind).toBe("note");
    expect(found[1].kind).toBe("track");
  });

  it("orders the storms by how strong they got, and stays a card", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      storm({
        id: `AL0${index}2000`,
        name: `S${index}`,
        peakWindKt: 40 + index * 5,
      }),
    );
    const found = almanacFor(new Date(2026, 7, 27), many, []);
    expect(found).toHaveLength(ALMANAC_MAX);
    const first = found[0];
    expect(first.kind === "track" && first.storm.peakWindKt).toBe(85);
  });

  it("says nothing on a day nothing happened", () => {
    expect(almanacFor(new Date(2026, 1, 14), [storm()], NOTES)).toEqual([]);
  });
});

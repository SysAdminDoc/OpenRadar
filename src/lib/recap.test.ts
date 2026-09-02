import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partial, recapFrom, recapLines } from "./recap";
import type { JournalRow } from "./journal";
import { formatClock } from "./units";

const TO = Date.parse("2026-09-02T12:00:00.000Z");
const YEAR = 365 * 86_400_000;
const FROM = TO - YEAR;

function row(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: Math.random().toString(36).slice(2),
    at: new Date(TO).toISOString(),
    place: "Casa",
    kind: "observation",
    source: "KDAL",
    observed: new Date(TO - 86_400_000).toISOString(),
    obtained: "a station report near a place you watch",
    text: "rain",
    note: "",
    thumb: "",
    ...over,
  };
}

function at(daysAgo: number, over: Partial<JournalRow> = {}): JournalRow {
  return row({
    observed: new Date(TO - daysAgo * 86_400_000).toISOString(),
    ...over,
  });
}

describe("a year built from the record on this disk", () => {
  it("counts what is inside the window and nothing outside it", () => {
    const recap = recapFrom(
      [at(10), at(20, { kind: "alert" }), at(400)],
      FROM,
      TO,
    );
    expect(recap?.observations).toBe(1);
    expect(recap?.alerts).toBe(1);
    // The row from before the window is still what tells the recap when the
    // record began, which is the figure the honesty line is made of.
    expect(recap?.recordBegan).toBe(TO - 400 * 86_400_000);
  });

  it("says how far back it can actually speak for", () => {
    // A record that started ninety days ago cannot describe last November,
    // and a recap that counts three months as a year is a lie told with true
    // numbers.
    const recap = recapFrom([at(90), at(2)], FROM, TO);
    expect(recap?.daysInPeriod).toBe(365);
    expect(recap?.daysReachingBack).toBe(90);
    expect(partial(recap!)).toBe(true);
    expect(recapLines(recap!, { places: false }).join(" ")).toContain("90");
  });

  it("does not round a record that began this morning up to a full year", () => {
    // Ten hours into the window. Rounding the gap to the nearest day made
    // this three hundred and sixty-five days, `partial` false, and the card
    // read "your record covers all 365 days" for a record a few hours old.
    const recap = recapFrom(
      [row({ observed: new Date(FROM + 10 * 3_600_000).toISOString() })],
      FROM,
      TO,
    );
    expect(partial(recap!)).toBe(true);
    expect(recap?.daysReachingBack).toBe(364);
    const said = recapLines(recap!, { places: false }).join(" ");
    expect(said).not.toContain("covers all");
  });

  it("does not call a full period partial", () => {
    const recap = recapFrom([at(400), at(2)], FROM, TO);
    expect(recap?.daysReachingBack).toBe(365);
    expect(partial(recap!)).toBe(false);
    expect(recapLines(recap!, { places: false }).join(" ")).toContain(
      "covers all",
    );
  });

  it("does not call a gap in the middle covered", () => {
    // January and December with nothing between them. The record reaches back
    // eleven months; it knows about two days. Calling the first figure
    // coverage is the lie this pair of lines exists to prevent.
    const recap = recapFrom([at(330), at(2)], FROM, TO)!;
    expect(recap.daysReachingBack).toBe(330);
    expect(recap.daysWithSomething).toBe(2);
    const said = recapLines(recap, { places: false }).join(" ");
    expect(said).toContain("reaches back");
    expect(said).not.toContain("covers 330");
    // And it says what a day with nothing on it actually means.
    expect(said).toContain("cannot tell those apart");
  });

  it("has nothing to show rather than a year of noughts", () => {
    // An absence of records is not an absence of weather, and a card full of
    // zeroes says the second thing.
    expect(recapFrom([], FROM, TO)).toBeNull();
    expect(recapFrom([at(400)], FROM, TO)).toBeNull();
    expect(recapFrom([row({ observed: "one Tuesday" })], FROM, TO)).toBeNull();
  });

  it("counts days that have something on them, not days in the period", () => {
    const recap = recapFrom([at(3), at(3), at(3), at(9)], FROM, TO);
    expect(recap?.daysWithSomething).toBe(2);
    expect(recap?.busiest?.rows).toBe(3);
  });

  it("names the busiest day as the day the reader would call it", () => {
    // A day number built as a UTC midnight and then formatted in the reader's
    // own zone printed the day before for everybody west of Greenwich, which
    // is most of the people this app is for. The busiest day is held as a
    // real observed instant, so the formatter cannot disagree with it.
    const observed = Date.parse("2026-06-15T20:00:00.000Z");
    const recap = recapFrom(
      [row({ observed: new Date(observed).toISOString() })],
      observed - 10 * 86_400_000,
      observed + 86_400_000,
    )!;
    expect(recap.busiest?.at).toBe(observed);
    const shown = formatClock(observed, { month: "long", day: "numeric" });
    expect(recapLines(recap, { places: false }).join(" ")).toContain(shown);
  });

  it("keeps a place's own figures, in the order they first appear", () => {
    const recap = recapFrom(
      [
        at(5, { place: "Casa", kind: "alert" }),
        at(4, { place: "The cabin" }),
        at(3, { place: "Casa" }),
      ],
      FROM,
      TO,
    );
    expect(recap?.places.map((place) => place.name)).toEqual([
      "Casa",
      "The cabin",
    ]);
    expect(recap?.places[0]).toMatchObject({ alerts: 1, observations: 1 });
  });

  it("puts a place name on the card only when asked", () => {
    const recap = recapFrom([at(5, { place: "Casa" })], FROM, TO)!;
    // The names are the reader's own words for where they live. A picture
    // meant to be sent to somebody carries them only on purpose.
    expect(recapLines(recap, { places: false }).join(" ")).not.toContain(
      "Casa",
    );
    expect(recapLines(recap, { places: true }).join(" ")).toContain("Casa");
  });

  it("is built where nothing can compare it against anything", () => {
    // Asserting that the rendered sentences do not contain the word "streak"
    // proves only that nobody typed it into the catalogue. What is worth
    // holding is structural: the recap is a pure function of the rows and the
    // window, it reaches nothing else, and the surface it is shown on cannot
    // notify, so there is nowhere for a comparison or a nudge to come from.
    const source = readFileSync(join(import.meta.dirname, "recap.ts"), "utf8");
    for (const reach of [
      "fetch(",
      "invoke(",
      "localStorage",
      "Notification",
      "pushToast",
    ]) {
      expect(source, reach).not.toContain(reach);
    }
    const panel = readFileSync(
      join(import.meta.dirname, "..", "panels", "RecapSection.tsx"),
      "utf8",
    );
    for (const reach of ["Notification", "pushToast", "sound", "badge"]) {
      expect(panel, reach).not.toContain(reach);
    }
    // And the figures it does show are the ones counted off the rows.
    const recap = recapFrom([at(5), at(3, { kind: "alert" })], FROM, TO)!;
    const text = recapLines(recap, { places: true }).join(" ");
    expect(text).toContain("1 warning");
    expect(text).toContain("1 observation");
  });
});

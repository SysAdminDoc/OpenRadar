import { describe, expect, it } from "vitest";
import { partial, recapFrom, recapLines } from "./recap";
import type { JournalRow } from "./journal";

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

  it("says how much of the period it can actually speak for", () => {
    // A record that started ninety days ago cannot describe last November,
    // and a recap that counts three months as a year is a lie told with true
    // numbers.
    const recap = recapFrom([at(90), at(2)], FROM, TO);
    expect(recap?.daysInPeriod).toBe(365);
    expect(recap?.daysCovered).toBe(90);
    expect(partial(recap!)).toBe(true);
    expect(recapLines(recap!, { places: false }).join(" ")).toContain("90");
  });

  it("does not call a full period partial", () => {
    const recap = recapFrom([at(400), at(2)], FROM, TO);
    expect(recap?.daysCovered).toBe(365);
    expect(partial(recap!)).toBe(false);
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

  it("compares the record against nothing at all", () => {
    const recap = recapFrom([at(5), at(3, { kind: "alert" })], FROM, TO)!;
    const text = recapLines(recap, { places: true }).join(" ").toLowerCase();
    // No other person's year is in here, and there is no target to beat.
    for (const word of [
      "rank",
      "score",
      "streak",
      "average user",
      "than last",
      "top ",
      "%",
    ]) {
      expect(text).not.toContain(word);
    }
  });
});

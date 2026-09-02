import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { figureLines, figuresFrom } from "./figures";
import { en } from "../i18n/en";
import type { JournalRow } from "./journal";

const NOW = Date.parse("2026-09-02T13:00:00.000Z");

function row(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: Math.random().toString(36).slice(2),
    at: new Date(NOW).toISOString(),
    place: "Casa",
    kind: "observation",
    source: "KDAL",
    observed: new Date(NOW).toISOString(),
    obtained: "a station report near a place you watch",
    text: "rain",
    note: "",
    thumb: "",
    ...over,
  };
}

function daysAgo(days: number, over: Partial<JournalRow> = {}): JournalRow {
  return row({
    observed: new Date(NOW - days * 86_400_000).toISOString(),
    ...over,
  });
}

describe("figures about your own record", () => {
  it("counts what the record holds and nothing else", () => {
    const figures = figuresFrom([
      daysAgo(10, { kind: "alert" }),
      daysAgo(3),
      daysAgo(3, { place: "The cabin" }),
    ]);
    expect(figures).toMatchObject({
      rows: 3,
      alerts: 1,
      observations: 2,
      places: 2,
      days: 2,
    });
    expect(figures?.from).toBe(NOW - 10 * 86_400_000);
    expect(figures?.to).toBe(NOW - 3 * 86_400_000);
  });

  it("has nothing to say about an empty record", () => {
    // Unavailable rather than a row of noughts. Zero warnings at zero places
    // over no period is not a fact about somebody's weather.
    expect(figuresFrom([])).toBeNull();
  });

  it("names the period every figure covers", () => {
    const said = figureLines(figuresFrom([daysAgo(30), daysAgo(1)])!).join(" ");
    // A number on its own invites a comparison; a number that says what it
    // counts and over what period is a fact about a file.
    expect(said).toContain("2026");
    expect(said).toMatch(/2 rows|2 records|2 /);
  });

  it("is a fact, never a game", () => {
    // The exclusion list, held rather than remembered. Everything here is a
    // count of something in a file; none of it is a streak, a level, a
    // target or a comparison with a period that has already gone.
    const source = readFileSync(
      join(import.meta.dirname, "figures.ts"),
      "utf8",
    );
    // The mechanisms, in the code. The words themselves are checked against
    // the copy below instead: this file's own doc comment says what a streak
    // is and why there is not one, and a scan that cannot tell prose from
    // code would fail on the sentence explaining the rule.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    for (const reach of [
      "Notification",
      "pushToast",
      "playSound",
      "previousPeriod",
      "lastMonth",
      "lastYear",
      "badge",
      "streak",
    ]) {
      expect(code, reach).not.toContain(reach);
    }
    // And the same of the copy it renders.
    for (const [key, value] of Object.entries(en)) {
      if (!key.startsWith("figures.")) continue;
      // Phrases that only turn up when an app is pushing somebody, rather
      // than the word "streak" itself: the note in this section says there
      // is not one, and that sentence is the feature.
      for (const word of [
        "day streak",
        "keep it up",
        "better than",
        "well done",
        "congratulations",
        "you are on",
        "level ",
      ]) {
        expect(value.toLowerCase(), key).not.toContain(word);
      }
    }
  });

  it("is reachable only from where somebody went to look", () => {
    // Nothing pushes a figure at anybody. The only place this is rendered is
    // the record's own section in Settings, and a second caller has to say
    // here where it is putting them.
    const root = join(import.meta.dirname, "..");
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
    const callers = walk(root)
      .filter((path) => /figureLines\(/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(root.length + 1).replace(/\\/g, "/"))
      .filter((path) => path !== "lib/figures.ts")
      .sort();
    expect(callers).toEqual(["panels/JournalSection.tsx"]);
  });
});

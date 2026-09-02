import { readFileSync, readdirSync, statSync } from "node:fs";
import { sep } from "node:path";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { pseudoize } from "./pseudo";

/**
 * Every language written by hand, checked the same way.
 *
 * A translation added without being named here would be tested by nothing,
 * which is how a catalogue falls behind without the build noticing.
 */
const TRANSLATIONS: Array<[string, Record<string, string>]> = [
  ["Spanish", es],
  ["French", fr],
];

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Names that are the same in every language: services, formats, and the
 * organisations that publish the data. Translating these would be wrong, not
 * thorough.
 */
const PROPER_NOUNS = [
  "OpenFreeMap",
  "OpenStreetMap",
  "GOES-East GeoColor",
  "NOAA MRMS",
  "NWS RIDGE II",
  "NOAA nowCOAST",
  "RainViewer",
  "OpenRadar",
];

/**
 * Text a person reads, found in the places it can hide in JSX: between tags,
 * and in the handful of attributes that are read out rather than acted on.
 *
 * This is a lint, not a compiler. It looks for the shapes that have actually
 * gone untranslated rather than trying to understand the language.
 */
function untranslated(source: string): string[] {
  const found: string[] = [];
  // Generic type arguments read as tags to a regex, so they go first:
  // Promise<void> would otherwise look like the word "Promise" between tags.
  let text = source;
  for (let round = 0; round < 5; round += 1) {
    const next = text.replace(/\b[A-Za-z_$][\w$]*<(?![/ ])[^<>="]*>/g, "TYPE");
    if (next === text) break;
    text = next;
  }
  source = text;

  // A label, title, placeholder, or aria-label given as a plain string.
  const attribute =
    /\s(aria-label|placeholder|title|label|detail|eyebrow)="([^"]{2,})"/g;
  for (const match of source.matchAll(attribute)) {
    // Class names and machine values are not copy, and neither is a single
    // word with no letters in it.
    if (!/[a-z]{3}/i.test(match[2])) continue;
    found.push(`${match[1]}="${match[2]}"`);
  }

  // Words sitting between tags, which is where copy lives when it is not in
  // an attribute. An expression is not copy, so anything holding a brace is
  // left alone, and so is anything that reads as code rather than a sentence.
  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/[;()=:`]/.test(text)) continue;
    if (!/^[A-Z][A-Za-z0-9 ,.'\u2019\u00b7%\u00b0-]*$/.test(text)) continue;
    if (!/[A-Za-z]{3}/.test(text)) continue;
    if (PROPER_NOUNS.includes(text)) continue;
    found.push(text);
  }

  return found;
}

/**
 * Copy hiding in a string literal rather than in markup.
 *
 * Only the places a literal actually reaches a person: a thrown message, which
 * becomes a toast or a panel's error line; the fields of a toast; and text
 * written onto a DOM node by hand.
 *
 * Log lines are deliberately not included. They are developer-facing, they
 * carry service text verbatim, and the project's own rule keeps them in
 * English along with code comments.
 */
function untranslatedStrings(source: string): string[] {
  const found: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["thrown", /throw new Error\(\s*"([^"]{8,})"/g],
    ["written", /\.textContent\s*=\s*"([^"]{4,})"/g],
    ["label", /\blabel\s*=\s*"([^"]{4,})"/g],
    // Anything handed straight to a state setter, which is how an error line
    // or a summary reaches the screen without ever passing through markup.
    ["set", /\bset[A-Z]\w*\(\s*"([^"]{8,})"/g],
  ];

  /** Reads like a sentence rather than a key, a unit, or a machine value. */
  const isCopy = (text: string) =>
    /^[A-Z][a-z]/.test(text) && / /.test(text.trim());

  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (!isCopy(match[1])) continue;
      found.push(`${kind} "${match[1]}"`);
    }
  }

  // A toast field is read whole rather than matched in one pass. Its value can
  // be a bare literal, a ternary between two of them, a call with a literal
  // buried in its arguments, or any of those wrapped onto the next line by the
  // formatter. A single expression that stops at the first string it finds
  // reads only one branch of a ternary, and one that cannot cross a newline
  // misses everything the formatter wrapped.
  for (const match of source.matchAll(
    /\b(?:title|detail|actionLabel|eyebrow):/g,
  )) {
    const from = (match.index ?? 0) + match[0].length;
    // The value ends at the comma that closes this property, or at the brace
    // that closes the object holding it. Counted rather than matched, so a
    // literal nested inside a call's own arguments is still part of the value
    // and a sibling property afterwards is not. Bounded, or a scan would blame
    // every string in the rest of the file.
    let depth = 0;
    let ends = from;
    const limit = Math.min(source.length, from + 400);
    while (ends < limit) {
      const character = source[ends];
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (character === "," && depth === 0) break;
      ends += 1;
    }
    const value = source.slice(from, ends);
    for (const literal of value.matchAll(/"([^"]{4,})"/g)) {
      if (!isCopy(literal[1])) continue;
      found.push(`toast "${literal[1]}"`);
    }
  }
  return found;
}

describe("the workspace is translated", () => {
  it.each(TRANSLATIONS)("has a %s string for every English one", (_, copy) => {
    const english = Object.keys(en).sort();
    expect(Object.keys(copy).sort()).toEqual(english);
    // And none of them is the key left in by accident, or an empty string
    // where a sentence should be.
    for (const [key, value] of Object.entries(copy)) {
      expect(typeof value, key).toBe("string");
      if (key.startsWith("keywords.")) continue;
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it.each(TRANSLATIONS)("says something different in %s", (_, copy) => {
    // Some strings are the same word in both languages: a unit, a name, a
    // number format. Most are not, and a catalogue that was copied rather
    // than translated would fail this.
    const differing = Object.keys(en).filter(
      (key) => copy[key] !== en[key as keyof typeof en],
    );
    expect(differing.length / Object.keys(en).length).toBeGreaterThan(0.8);
  });

  it("leaves no copy behind in the panels and chrome", () => {
    const offenders: string[] = [];
    for (const path of [
      ...sourceFiles(join(ROOT, "panels")),
      ...sourceFiles(join(ROOT, "components")),
    ]) {
      const found = untranslated(readFileSync(path, "utf8"));
      for (const item of found) {
        offenders.push(`${path.slice(ROOT.length + 1)}: ${item}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no copy behind in the hooks and the libraries either", () => {
    // Copy does not only live in markup. A thrown message becomes a toast, a
    // toast title is copy, and text written straight onto a DOM node is copy
    // that no JSX scan will ever see.
    const offenders: string[] = [];
    for (const path of [
      ...sourceFiles(join(ROOT, "hooks")),
      ...sourceFiles(join(ROOT, "lib")),
      ...sourceFiles(join(ROOT, "panels")),
      ...sourceFiles(join(ROOT, "components")),
      join(ROOT, "App.tsx"),
    ]) {
      for (const item of untranslatedStrings(readFileSync(path, "utf8"))) {
        offenders.push(`${path.slice(ROOT.length + 1)}: ${item}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(TRANSLATIONS)("fills in the same blanks in %s", (_, copy) => {
    // A translation that drops a placeholder does not fail to build and does
    // not throw: it simply never shows the number. One that invents a new one
    // renders the braces on screen.
    // Both kinds of blank: a plain placeholder, and the number a plural block
    // is chosen by. A translation that keeps the words and loses the block
    // shows the same sentence for one and for a thousand.
    //
    // The blocks are taken out before the plain placeholders are counted,
    // because an arm's own words sit in braces too and "one {day}" is a word,
    // not a blank to fill in.
    const names = (value: string) => {
      const found: string[] = [];
      let rest = "";
      let at = 0;
      while (at < value.length) {
        const start = value.indexOf("{", at);
        if (start === -1) break;
        const head = /^\{(\w+),\s*plural,/.exec(value.slice(start));
        if (!head) {
          rest += value.slice(at, start + 1);
          at = start + 1;
          continue;
        }
        found.push(head[1]);
        rest += value.slice(at, start);
        let depth = 0;
        let cursor = start;
        do {
          if (value[cursor] === "{") depth += 1;
          if (value[cursor] === "}") depth -= 1;
          cursor += 1;
        } while (cursor < value.length && depth > 0);
        at = cursor;
      }
      rest += value.slice(at);
      for (const match of rest.matchAll(/\{(\w+)\}/g)) found.push(match[1]);
      return found.sort();
    };
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(names(copy[key]), key).toEqual(names(en[key]));
    }
  });

  it("counts nothing with a noun stuck on the end of it", () => {
    /**
     * Words that legitimately follow a number without inflecting: units and
     * abbreviations. "5 min" and "1 min" are both right, and wrapping them in
     * a plural block would be ceremony rather than correctness.
     */
    const FIXED = new Set([
      // Units and abbreviations, which do not inflect.
      "min",
      "h",
      "kB",
      "MB",
      "GB",
      "kt",
      "km",
      "mi",
      "in",
      "mm",
      "dBZ",
      "UTC",
      "Z",
      // Words that follow a number without being counted by it.
      "back",
      "tracked",
      "more",
      "of",
      "and",
      "from",
      "at",
      "to",
      "on",
      "is",
      "was",
      "ago",
      "out",
      "old",
      "across",
      "percent",
      // Not nouns being counted: a verb, a preposition, and a bearing, which
      // is a direction rather than a number of things. A wind from 001
      // degrees is still "degrees".
      "as",
      "has",
      "reaches",
      "degrees",
    ]);

    // A number written straight into a sentence, with the next word hard
    // coded, reads wrong at one in some language or other. This finds the
    // ones nobody has converted, in English, where the plural s is the tell.
    const outsideBlocks = (value: string) => {
      let rest = "";
      let at = 0;
      while (at < value.length) {
        const start = value.indexOf("{", at);
        if (start === -1) break;
        if (!/^\{\w+,\s*plural,/.test(value.slice(start))) {
          rest += value.slice(at, start + 1);
          at = start + 1;
          continue;
        }
        rest += value.slice(at, start);
        let depth = 0;
        let cursor = start;
        do {
          if (value[cursor] === "{") depth += 1;
          if (value[cursor] === "}") depth -= 1;
          cursor += 1;
        } while (cursor < value.length && depth > 0);
        at = cursor;
      }
      return rest + value.slice(at);
    };

    const wrong: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      // Every placeholder, not a list of the names somebody thought of. A
      // hand-written list of parameter names is the same shape of mistake as
      // a hand-written list of file extensions, and it went stale the same
      // way: `{readings} readings`, `{fixes} fixes`, `{acres} acres` and four
      // others were all invisible to the first version of this.
      for (const match of outsideBlocks(value).matchAll(
        /\{(\w+)\}\s+([A-Za-z]+)/g,
      )) {
        const word = match[2];
        if (FIXED.has(word) || !word.endsWith("s")) continue;
        wrong.push(`${key}: "{${match[1]}} ${word}"`);
      }
    }
    // All of them at once, because fixing these one failure at a time is how
    // a conversion like this gets abandoned half done.
    expect(wrong).toEqual([]);
  });

  it("is filled in with the blanks the copy actually has", () => {
    // A placeholder renamed in three catalogues and not at its one call site
    // does not fail to build and does not throw: `translate` leaves an
    // unmatched `{from}` on screen, and the caller's `start:` goes nowhere.
    // Storm history said "ACE 17.47 · 156 fixes · {from} to {to}" for a
    // fortnight because nothing read the two halves together.
    const root = join(import.meta.dirname, "..");
    const wrong: string[] = [];
    for (const path of sourceFiles(root)) {
      if (path.includes(`i18n${sep}`)) continue;
      const source = readFileSync(path, "utf8");
      for (const call of source.matchAll(
        /\bt\(\s*"([\w.]+)"\s*,\s*\{([\s\S]{0,600}?)\}\s*\)/g,
      )) {
        const key = call[1] as keyof typeof en;
        if (!(key in en)) continue;
        const wanted = new Set(
          [...en[key].matchAll(/\{(\w+)[,}]/g)].map((one) => one[1]),
        );
        if (!wanted.size) continue;
        // Only the names at the top of the object. `formatClock(at, { month,
        // day })` nested inside a parameter is an option for the formatter,
        // not a blank in the sentence.
        let depth = 0;
        // Comments out first: a note written above a parameter is prose, and
        // "Raw: the sentence chooses its words" is not a blank.
        const given = call[2]
          .replace(new RegExp(String.raw`/\*[^]*?\*/`, "g"), "")
          .replace(new RegExp(String.raw`//.*`, "g"), "");
        for (const token of given.matchAll(/[{}[\]()]|(\w+)\s*:/g)) {
          if (token[1] === undefined) {
            depth += "{[(".includes(token[0]) ? 1 : -1;
            continue;
          }
          if (depth !== 0 || wanted.has(token[1])) continue;
          wrong.push(`${key}: "${token[1]}" is not a blank in that string`);
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });

  it("makes the pseudolocale longer than the original", () => {
    // The whole point of it is to be longer, so a label that only fits its
    // English text shows up before someone else finds it.
    for (const [key, value] of Object.entries(en)) {
      if (!value) continue;
      // Comfortably longer, not just wrapped in brackets: a language that is
      // two characters wider than English would find nothing.
      expect(pseudoize(value).length / value.length, key).toBeGreaterThan(1.3);
    }
    // And it leaves the parameters alone, or the code would fill in nothing.
    expect(pseudoize("Issued {issued} · expires {expires}")).toContain(
      "{issued}",
    );
    expect(pseudoize("Issued {issued} · expires {expires}")).toContain(
      "{expires}",
    );
  });

  it("carries no string nothing asks for", () => {
    // A key left behind when its caller changed is dead weight that still has
    // to be translated, and the parity test above is happy to keep both
    // languages carrying it for ever.
    const sources = [
      ...sourceFiles(join(ROOT, "panels")),
      ...sourceFiles(join(ROOT, "components")),
      ...sourceFiles(join(ROOT, "hooks")),
      ...sourceFiles(join(ROOT, "lib")),
      join(ROOT, "App.tsx"),
      join(ROOT, "main.tsx"),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    const unused = Object.keys(en).filter((key) => {
      // Some families are reached by building the key rather than writing it,
      // so the prefix standing in the source is what proves they are used.
      const prefix = key.slice(0, key.indexOf(".") + 1);
      return !sources.includes(`"${key}"`) && !sources.includes(`\`${prefix}`);
    });
    expect(unused).toEqual([]);
  });
});

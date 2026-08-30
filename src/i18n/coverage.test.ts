import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { pseudoize } from "./pseudo";

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
    // Not just a bare literal after the colon: a ternary between two
    // sentences is still copy, and that is how the dual pane toast hid.
    ["toast", /\b(?:title|detail|actionLabel|eyebrow):[^\n]*?"([^"]{4,})"/g],
    ["written", /\.textContent\s*=\s*"([^"]{4,})"/g],
    ["label", /\blabel\s*=\s*"([^"]{4,})"/g],
    // Anything handed straight to a state setter, which is how an error line
    // or a summary reaches the screen without ever passing through markup.
    ["set", /\bset[A-Z]\w*\(\s*"([^"]{8,})"/g],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      const text = match[1];
      // Two words or more, starting like a sentence: an identifier, a unit,
      // or a machine value is none of those.
      if (!/^[A-Z][a-z]/.test(text)) continue;
      if (!/ /.test(text.trim())) continue;
      found.push(`${kind} "${text}"`);
    }
  }
  return found;
}

describe("the workspace is translated", () => {
  it("has a Spanish string for every English one", () => {
    const english = Object.keys(en).sort();
    const spanish = Object.keys(es).sort();
    expect(spanish).toEqual(english);
    // And none of them is the key left in by accident, or an empty string
    // where a sentence should be.
    for (const [key, value] of Object.entries(es)) {
      expect(typeof value, key).toBe("string");
      if (key.startsWith("keywords.")) continue;
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it("says something different in Spanish", () => {
    // Some strings are the same word in both languages: a unit, a name, a
    // number format. Most are not, and a catalogue that was copied rather
    // than translated would fail this.
    const differing = Object.keys(en).filter(
      (key) => es[key as keyof typeof es] !== en[key as keyof typeof en],
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

  it("fills in the same blanks in both languages", () => {
    // A translation that drops a placeholder does not fail to build and does
    // not throw: it simply never shows the number. One that invents a new one
    // renders the braces on screen.
    const names = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(names(es[key]), key).toEqual(names(en[key]));
    }
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
});

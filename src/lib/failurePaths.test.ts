import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where a failure's own words are allowed to reach a reader.
 *
 * `failureSentence` exists because a failure's `message` is the engine's, not
 * this app's: a network that is not there raises a `TypeError` whose message
 * is "Failed to fetch", in English, whatever language the app is set to, and a
 * body that will not parse raises a `SyntaxError` full of tokens and offsets.
 * Six panels were routed through it, then five more hooks, and both rounds
 * were found by reading. Reading is not a gate, and the same two shapes kept
 * coming back: `failure instanceof Error ? failure.message : "some English
 * sentence"`, which is untranslated copy written into the code, and a bare
 * `.message` handed straight to whatever renders it.
 *
 * So this reads the tree instead. A developer log is exempt and meant to be
 * English; what is not exempt is anything a reader sees.
 */

const ROOT = join(import.meta.dirname, "..");

/** Every source file under `src/panels` and `src/hooks`, tests aside. */
function sources(): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const here = join(at, name);
      if (statSync(here).isDirectory()) {
        walk(here);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      found.push({
        path: here.slice(ROOT.length + 1).replace(/\\/g, "/"),
        text: readFileSync(here, "utf8"),
      });
    }
  };
  walk(join(ROOT, "panels"));
  walk(join(ROOT, "hooks"));
  return found;
}

/**
 * What a reader ends up seeing, by the name of the thing it is handed to.
 *
 * Named rather than inferred, because there is no way to tell from the text
 * whether a value is rendered: these are the four shapes this tree uses, and a
 * fifth one arriving is a line to add here rather than a hole that stays open.
 */
const SINKS = [
  "setError",
  "onFailed",
  "pushToast",
  "recordFailure",
  "setFailed",
];

/**
 * The text of every call to one of those, from the opening bracket to the one
 * that closes it.
 *
 * Brackets are counted rather than matched by expression, because an argument
 * is often a ternary several lines long with its own calls inside it, and that
 * is exactly the shape the two defects take.
 */
function callsTo(text: string, sink: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`\\b${sink}\\s*\\(`, "g");
  for (const match of text.matchAll(opener)) {
    let depth = 0;
    let at = match.index + match[0].length - 1;
    const from = at;
    for (; at < text.length; at += 1) {
      if (text[at] === "(") depth += 1;
      else if (text[at] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(text.slice(from, at + 1));
  }
  return found;
}

describe("what a failure is allowed to say to a reader", () => {
  it("finds the calls it is looking for", () => {
    // The one way this gate fails that looks exactly like a clean tree. A
    // bracket counter that stops matching, or a sink renamed out from under
    // it, reports nothing wrong for ever.
    const counted = sources()
      .flatMap((file) => SINKS.flatMap((sink) => callsTo(file.text, sink)))
      .filter((call) => call.length > 2);
    expect(counted.length).toBeGreaterThan(40);
    expect(counted.every((call) => call.endsWith(")"))).toBe(true);
  });

  it("never hands one the engine's own words", () => {
    const wrong: string[] = [];
    for (const file of sources()) {
      for (const sink of SINKS) {
        for (const call of callsTo(file.text, sink)) {
          if (!/\.message\b/.test(call)) continue;
          if (call.includes("failureSentence")) continue;
          wrong.push(
            `${file.path}: ${sink}${call.replace(/\s+/g, " ").slice(0, 90)}`,
          );
        }
      }
    }
    expect(
      wrong,
      "these hand a failure's own message to something a reader sees. A " +
        "TypeError says 'Failed to fetch' in English whatever language the " +
        "app is in. Put it through failureSentence, whose fallback is a " +
        "catalogue key",
    ).toEqual([]);
  });

  it("never writes an English sentence where a catalogue key belongs", () => {
    // The other half, and the one a count of `.message` cannot see. Most of
    // these sites work the sentence out into a variable first, so the literal
    // is nowhere near the thing that renders it. What is always local is the
    // fallback handed to `failureSentence`, and that is the place a literal
    // ends up: copy that can never be translated, sitting one argument along
    // from the call that exists to stop exactly this.
    const wrong: string[] = [];
    for (const file of sources()) {
      for (const call of callsTo(file.text, "failureSentence")) {
        // A sentence rather than a word: a capital, a run of text and a full
        // stop. A catalogue key has none of those.
        for (const [, said] of call.matchAll(/"([A-Z][^"]{15,}\.)"/g)) {
          wrong.push(`${file.path}: failureSentence(…, "${said}")`);
        }
      }
      // And the same literal handed straight to something a reader sees.
      for (const sink of SINKS) {
        for (const call of callsTo(file.text, sink)) {
          for (const [, said] of call.matchAll(/"([A-Z][^"]{15,}\.)"/g)) {
            wrong.push(`${file.path}: ${sink}(… "${said}")`);
          }
        }
      }
    }
    expect(
      wrong,
      "these put an English sentence where a catalogue key belongs, so a " +
        "Spanish or French reader gets English the moment it fires",
    ).toEqual([]);
  });
});

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
 *
 * The first version of this could see neither of the two shapes it was
 * written for once they were more than one expression apart. It looked only
 * inside a sink call's own brackets, and it walked only `panels` and `hooks`.
 * An adversarial pass on 2026-09-08 put `useWind.ts` back to handing
 * `failure.message` to `setError` through a local and the run stayed green,
 * and named three live leaks in `App.tsx` and one in `lib/providers` that the
 * walk had never reached. It follows a value into a sink now, through a local
 * and through a helper, and it reads the whole of `src`.
 */

const ROOT = join(import.meta.dirname, "..");

/**
 * Everything under `src` a reader's words could travel through.
 *
 * `i18n` holds the catalogues, which ARE the English and have no sinks in
 * them, and `test` is the harness. Everything else is in: the first version
 * of this walked `panels` and `hooks` alone, and `App.tsx`, `components` and
 * `lib` are where four of the live leaks turned out to be.
 */
function sources(): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const skip = new Set(["i18n", "test", "assets", "workers"]);
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const here = join(at, name);
      if (statSync(here).isDirectory()) {
        if (!skip.has(name)) walk(here);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      found.push({
        path: here.slice(ROOT.length + 1).replace(/\\/g, "/"),
        text: readFileSync(here, "utf8"),
      });
    }
  };
  walk(ROOT);
  return found;
}

/**
 * What a reader ends up seeing, by the name of the thing it is handed to.
 *
 * Named rather than inferred, because there is no way to tell from the text
 * whether a value is rendered: these are the shapes this tree uses, and a new
 * one arriving is a line to add here rather than a hole that stays open.
 */
const SINKS = [
  "setError",
  "onFailed",
  "pushToast",
  "recordFailure",
  "setFailed",
  // The slice and the wind profile put a failure into an answer object rather
  // than into an error of its own, which is how `sweepErrorText` reached a
  // reader without passing anything on this list. Reverting that helper left
  // the gate green.
  "setAnswer",
  // A sentence built into an error and thrown reaches a reader as surely as
  // one handed to a setter: whoever catches it runs it through
  // `failureSentence`, which passes a plain `Error`'s own message through by
  // design, and writes it into state a panel renders. The storm reports built
  // a refused connection's "Failed to fetch" into `reports.serviceStatus`
  // that way and the gate walked past it, because the taint left through a
  // `throw` and arrived under a property key.
  //
  // Not `onError`, which was considered on 2026-09-08 and is wrong: the wind
  // layer hands its `onError` the driver's own compile log, which reaches
  // `log.warn` and never a reader. Making it a sink convicts a developer log
  // this file's own docblock exempts.
  "throw new Error",
  // And the same sentence handed to a promise instead of thrown, which is
  // how the GIF export leaked "The GIF worker failed." and the encoder's own
  // English into a toast: whoever catches it runs it through
  // `failureSentence`, which passes a plain `Error`'s own message through by
  // design. `new Error` is part of the name on purpose. A bare `reject`
  // convicts `alerts.ts`, which rejects with a `DOMException` that
  // `failureSentence` translates, and that is correct code.
  "reject(new Error",
];

/** A failure's own message, which is the engine's words and never translated. */
const OWN_WORDS = /\.message\b/;

/**
 * A sentence rather than a word: a capital, a run of text and a full stop.
 * A catalogue key has none of those.
 *
 * All three quote styles. Prettier writes double quotes here, so the other
 * two are rare rather than impossible, and a gate that only reads one of them
 * is a gate somebody walks past by changing a keystroke. Nothing in the tree
 * matches the two new ones today, checked on 2026-09-08 across 223 files.
 */
const ENGLISH =
  /(?:"([A-Z][^"]{15,}\.)"|'([A-Z][^']{15,}\.)'|`([A-Z][^`]{15,}\.)`)/g;

/** Whichever of the three quote styles matched. */
function said(match: RegExpMatchArray): string {
  return match[1] ?? match[2] ?? match[3] ?? "";
}

/** The text from a brace or bracket to the one that closes it. */
function balanced(text: string, from: number, open: string, close: string) {
  let depth = 0;
  for (let at = from; at < text.length; at += 1) {
    if (text[at] === open) depth += 1;
    else if (text[at] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(from, at + 1);
    }
  }
  return text.slice(from);
}

/**
 * Every call to one of those, from the opening bracket to the one that closes
 * it, with where it starts.
 *
 * Brackets are counted rather than matched by expression, because an argument
 * is often a ternary several lines long with its own calls inside it, and that
 * is exactly the shape the two defects take.
 */
function callsTo(
  text: string,
  sink: string,
): Array<{ at: number; call: string }> {
  const found: Array<{ at: number; call: string }> = [];
  // Escaped, because a sink may name more than a bare identifier:
  // `reject(new Error` carries a bracket, which is a regex of its own
  // otherwise and threw "Unterminated group" the first time it was added.
  const opener = new RegExp(
    `\\b${sink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`,
    "g",
  );
  for (const match of text.matchAll(opener)) {
    const from = match.index + match[0].length - 1;
    found.push({ at: from, call: balanced(text, from, "(", ")") });
  }
  return found;
}

/**
 * Functions in a file that hand back a failure's own message.
 *
 * `sweepErrorText`, `packErrorText`, `messageFor` and `failureMessage` all end
 * `if (failure instanceof Error) return failure.message;`, and their results
 * go straight into a sink. Collected across every file rather than per file,
 * because two of the four are exported and read somewhere else.
 */
function passesOwnWords(text: string): string[] {
  const named: string[] = [];
  const declared =
    /(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*\{|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:[^=]*)?\s*=>\s*\{)/g;
  for (const match of text.matchAll(declared)) {
    const name = match[1] ?? match[2];
    // `failureSentence` is the sanctioned route and reads `.message` on
    // purpose, behind the check that decides whether the words are safe to
    // show. Listing it here would make every correct call site a finding.
    if (!name || name === "failureSentence") continue;
    const body = balanced(text, match.index + match[0].length - 1, "{", "}");
    // Handing the message BACK, not merely touching one. Every component and
    // every hook of any size mentions `.message` somewhere, and a first cut
    // that looked for the word alone called `App`, `SettingsPanel` and six
    // hooks helpers of this kind.
    if (!/return[^;]*\.message\b[^;]*;/.test(body)) continue;
    if (body.includes("failureSentence")) continue;
    named.push(name);
  }
  return named;
}

/**
 * Whether a file can be talking about one of those helpers at all.
 *
 * The set is built across the tree, so a bare name in it would otherwise
 * convict an unrelated local somewhere else: `useAmbient` has a helper called
 * `read`, and `useWorkspaceActions` has a `const read = parseTheme(...)` that
 * has nothing to do with it.
 */
function reaches(text: string, name: string): boolean {
  const imported = new RegExp(`import[^;]*\\b${name}\\b[^;]*from`, "s");
  const declares = new RegExp(
    `(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*[=:])`,
  );
  return imported.test(text) || declares.test(text);
}

/**
 * The names a call passes as VALUES, rather than as property keys.
 *
 * `pushToast({ detail: translate("x") })` names `detail`, and the helper set
 * is collected across the whole tree, so one helper called `detail` anywhere
 * in `src` convicted every one of those: thirty findings in one file, none of
 * them about the same thing. A key here is written `name:` with no space, and
 * a ternary is written ` : ` with one, which prettier settles for the whole
 * repository.
 */
function valueNames(call: string): string[] {
  return [
    ...withoutConditions(call).matchAll(
      /(?<![.\w$])([A-Za-z_$][\w$]*)(?![\w$:])/g,
    ),
  ].map((one) => one[1]);
}

/**
 * The same call with every ternary's condition blanked out.
 *
 * A condition is not a value: nothing it names reaches what the call produces.
 * `tides.ts` throws `new Error(/no predictions/i.test(said) ? translate(a) :
 * translate(b))`, where `said` is the service's own message and the sentence
 * is a catalogue string either way, which is exactly how it should be written.
 * Reading names out of the condition convicted it.
 *
 * The condition runs from the last boundary at this depth to the `?`, which
 * is why the boundaries are tracked per depth rather than globally. `?.` and
 * `??` are not ternaries and are stepped over.
 */
function withoutConditions(call: string): string {
  const out = [...call];
  const boundary: number[] = [0];
  let depth = 0;
  for (let at = 0; at < call.length; at += 1) {
    const here = call[at];
    if (here === "(" || here === "[" || here === "{") {
      depth += 1;
      boundary[depth] = at + 1;
      continue;
    }
    if (here === ")" || here === "]" || here === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (here === "," || here === ":") {
      boundary[depth] = at + 1;
      continue;
    }
    if (here !== "?") continue;
    if (call[at + 1] === "." || call[at + 1] === "?") {
      at += 1;
      continue;
    }
    for (let back = boundary[depth] ?? 0; back < at; back += 1) {
      out[back] = " ";
    }
    boundary[depth] = at + 1;
  }
  return out.join("");
}

/**
 * Whether something the call passes was given a failure's own words nearby.
 *
 * Two thousand characters back rather than the enclosing function, because
 * finding that needs a parser and this needs to run in a test. Every leak the
 * 2026-09-08 pass named sits inside twenty lines of its sink; a value carried
 * further than that is what `passesOwnWords` is for.
 */
function taintedName(
  text: string,
  call: string,
  at: number,
  helpers: Set<string>,
): string | null {
  const names = valueNames(call);
  const before = text.slice(Math.max(0, at - 2000), at);
  for (const name of new Set(names)) {
    if (helpers.has(name) && reaches(text, name)) return name;
    // A declaration, and a plain reassignment after one. The second is the
    // most ordinary shape of all, `let detail = …;` and then
    // `if (failure instanceof Error) detail = failure.message;`, and the
    // declaration pattern alone cannot see it: the line that puts the
    // engine's words in carries no `const`.
    for (const assigned of [
      new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]*)?=([^;]*);`, "g"),
      // The first character after the `=` may not open a brace or an arrow.
      // JSX writes every attribute as `name={...}` and has no semicolons
      // inside an element, so this pattern read `label={t("radar.retry")}` as
      // an assignment to `label` and ran on past the closing tag to whatever
      // semicolon came next. A developer log two lines below then convicted
      // an unrelated `label` handed bare to a sink. The tree was green by
      // luck: on 2026-09-08 the only non-declaration match anywhere was one
      // name that is never passed bare.
      //
      // The cost is an assignment of an object literal, `detail = { ... };`,
      // which this no longer follows. Nothing in the tree puts a failure's
      // words into one, and `passesOwnWords` still reaches a helper that
      // returns one.
      new RegExp(`(?<![.\\w$])${name}\\s*=\\s*([^;={>][^;]*);`, "g"),
    ]) {
      for (const match of before.matchAll(assigned)) {
        if (OWN_WORDS.test(match[1]) && !match[1].includes("failureSentence")) {
          return name;
        }
      }
    }
  }
  return null;
}

/** Names an English sentence was worked out into, near a call. */
function englishName(text: string, call: string, at: number): string | null {
  const names = valueNames(call);
  const before = text.slice(Math.max(0, at - 2000), at);
  for (const name of new Set(names)) {
    const assigned = new RegExp(
      `(?:const|let|var)\\s+${name}\\s*(?::[^=]*)?=([^;]*);`,
      "g",
    );
    for (const match of before.matchAll(assigned)) {
      // Its own copy rather than `ENGLISH.test`. That one is `g`-flagged and
      // shared, and a successful `test` leaves `lastIndex` where it stopped;
      // `matchAll` copies that onto its own clone, so the next call's scan
      // would start partway through the string and the report would come out
      // short.
      if (new RegExp(ENGLISH.source).test(match[1])) return name;
    }
  }
  return null;
}

describe("what a failure is allowed to say to a reader", () => {
  const files = sources();
  const helpers = new Set(files.flatMap((file) => passesOwnWords(file.text)));

  it("finds the calls it is looking for", () => {
    // The one way this gate fails that looks exactly like a clean tree. A
    // bracket counter that stops matching, or a sink renamed out from under
    // it, reports nothing wrong for ever.
    const counted = files
      .flatMap((file) => SINKS.flatMap((sink) => callsTo(file.text, sink)))
      .filter((found) => found.call.length > 2);
    expect(counted.length).toBeGreaterThan(40);
    expect(counted.every((found) => found.call.endsWith(")"))).toBe(true);
  });

  it("reads the whole of src, not two directories of it", () => {
    // Three live leaks sat in `App.tsx` and one in `lib/providers` for as long
    // as the walk was `panels` and `hooks`. The count is what stops a walk
    // that silently stops descending.
    const walked = files.map((file) => file.path);
    expect(walked).toContain("App.tsx");
    expect(walked.some((path) => path.startsWith("components/"))).toBe(true);
    expect(walked.some((path) => path.startsWith("lib/providers/"))).toBe(true);
    expect(walked.length).toBeGreaterThan(150);
  });

  it("knows which helpers hand back a failure's own words", () => {
    // `passesOwnWords` is the half that reaches across files, and a regex
    // that stops matching declarations would empty it silently.
    expect(helpers.size).toBeGreaterThan(0);
  });

  it("never hands one the engine's own words", () => {
    const wrong: string[] = [];
    for (const file of files) {
      for (const sink of SINKS) {
        for (const { at, call } of callsTo(file.text, sink)) {
          const short = `${sink}${call.replace(/\s+/g, " ").slice(0, 90)}`;
          if (OWN_WORDS.test(call)) {
            if (call.includes("failureSentence")) continue;
            wrong.push(`${file.path}: ${short}`);
            continue;
          }
          const carried = taintedName(file.text, call, at, helpers);
          if (carried) wrong.push(`${file.path}: ${short} <- ${carried}`);
        }
      }
    }
    expect(
      wrong,
      "these hand a failure's own message to something a reader sees, " +
        "directly or through a name assigned one nearby. A TypeError says " +
        "'Failed to fetch' in English whatever language the app is in. Put " +
        "it through failureSentence, whose fallback is a catalogue key",
    ).toEqual([]);
  });

  it("never writes an English sentence where a catalogue key belongs", () => {
    // The other half, and the one a count of `.message` cannot see. Most of
    // these sites work the sentence out into a variable first, so the literal
    // is nowhere near the thing that renders it.
    const wrong: string[] = [];
    for (const file of files) {
      for (const { call } of callsTo(file.text, "failureSentence")) {
        for (const match of call.matchAll(ENGLISH)) {
          wrong.push(`${file.path}: failureSentence(…, "${said(match)}")`);
        }
      }
      for (const sink of SINKS) {
        for (const { at, call } of callsTo(file.text, sink)) {
          for (const match of call.matchAll(ENGLISH)) {
            wrong.push(`${file.path}: ${sink}(… "${said(match)}")`);
          }
          const carried = englishName(file.text, call, at);
          if (carried)
            wrong.push(`${file.path}: ${sink}(${carried}) <- English`);
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

describe("what the gate itself reads", () => {
  it("does not take a JSX attribute for an assignment", () => {
    // JSX writes every attribute as `name={...}` and puts no semicolons
    // inside an element, so the reassignment pattern read `label={...}` as an
    // assignment to `label` and ran past the closing tag to the next
    // semicolon it found. The developer log below it then convicted a `label`
    // that is a catalogue string and nothing else. The tree was green by
    // luck rather than by construction: on 2026-09-08 the only
    // non-declaration match in `src` was one name never passed bare.
    const source = `
      const label = t("radar.retry");
      return (
        <RadarError
          label={t("radar.retry")}
          onRetry={() =>
            log.warn("radar", failure instanceof Error ? failure.message : "")
          }
        />
      );
      setError(label);
    `;
    const [call] = callsTo(source, "setError");
    expect(call, "the fixture stopped containing the sink").toBeTruthy();
    expect(taintedName(source, call.call, call.at, new Set())).toBeNull();
  });

  it("follows a failure's words into a sentence that is thrown", () => {
    // The shape the storm reports had. Whoever catches this runs it through
    // `failureSentence`, which passes a plain `Error`'s own message through
    // by design, and writes it into state a panel renders, so the engine's
    // "Failed to fetch" reached the screen. The taint leaves through a
    // `throw` and arrives under a property key, and the gate followed
    // neither until 2026-09-08.
    const source = `
      let failed = "";
      try {
        await fetch(url);
      } catch (error) {
        failed = error instanceof Error ? error.message : "";
      }
      throw new Error(translate("reports.serviceStatus", { answer: failed }));
    `;
    const [call] = callsTo(source, "throw new Error");
    expect(call, "the fixture stopped containing the sink").toBeTruthy();
    expect(taintedName(source, call.call, call.at, new Set())).toBe("failed");
  });

  it("reads no names out of a ternary's condition", () => {
    // A condition is not a value. `tides.ts` throws a catalogue sentence
    // chosen by testing the service's own message against a regex, which is
    // the right way to write it, and the first version of the throw sink
    // convicted it for naming the message at all.
    const source = `
      const said = String(raw.error.message);
      throw new Error(
        /no predictions/i.test(said)
          ? translate("tides.noPredictions")
          : translate("tides.unknown"),
      );
    `;
    const [call] = callsTo(source, "throw new Error");
    expect(call, "the fixture stopped containing the sink").toBeTruthy();
    expect(taintedName(source, call.call, call.at, new Set())).toBeNull();
    // And the same words reaching the sentence itself are still caught, so
    // the rule above drops conditions rather than dropping the check.
    const leaking = source.replace(
      'translate("tides.unknown")',
      'translate("tides.unknown", { answer: said })',
    );
    const [second] = callsTo(leaking, "throw new Error");
    expect(taintedName(leaking, second.call, second.at, new Set())).toBe(
      "said",
    );
  });
});

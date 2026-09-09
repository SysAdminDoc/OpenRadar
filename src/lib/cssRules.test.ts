import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * A rule in the stylesheet, with the at-rule it sits inside.
 *
 * Two rules only compete when their selector and their context are both the
 * same string: identical selectors have identical specificity, so the later
 * one wins outright, and a rule inside a media query is not competing with
 * one outside it at all.
 */
interface Rule {
  context: string;
  selector: string;
  body: string;
  line: number;
}

function rules(css: string): Rule[] {
  const found: Rule[] = [];
  const at: string[] = [];
  let head = "";
  for (let i = 0; i < css.length; i += 1) {
    const character = css[i];
    if (character === "{") {
      const selector = head.trim();
      head = "";
      if (selector.startsWith("@")) {
        at.push(selector);
        continue;
      }
      let end = i + 1;
      let depth = 1;
      while (end < css.length && depth > 0) {
        if (css[end] === "{") depth += 1;
        if (css[end] === "}") depth -= 1;
        end += 1;
      }
      found.push({
        context: at.join(" >> "),
        selector,
        body: css.slice(i + 1, end - 1),
        line: css.slice(0, i).split("\n").length,
      });
      i = end - 1;
      continue;
    }
    if (character === "}") {
      at.pop();
      head = "";
      continue;
    }
    head += character;
  }
  return found;
}

/** Which properties a rule sets, ignoring the custom ones a theme reaches. */
function properties(body: string): Map<string, string> {
  const set = new Map<string, string>();
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "(") depth += 1;
    if (body[i] === ")") depth -= 1;
    if (body[i] !== ";" || depth > 0) continue;
    const text = body.slice(start, i);
    start = i + 1;
    const match = /^\s*([a-z][a-z0-9-]*)\s*:\s*([\s\S]+)$/.exec(text);
    if (match) set.set(match[1], match[2]);
  }
  return set;
}

/**
 * What the file says against what the browser does.
 *
 * This stylesheet grew a second layout at the bottom without the first one
 * being taken out, so eighty declarations across thirty-three rules were
 * being read by everybody who opened the file and by nobody's browser: a
 * radial vignette on the map stage, the whole of the brand mark's colour, the
 * pressed state of a command button. The first thing anybody does with a rule
 * like that is edit it, watch nothing happen, and go looking for the reason
 * somewhere else.
 */
describe("the stylesheet says what the browser does", () => {
  const css = readFileSync(join(ROOT, "index.css"), "utf8");

  it("has no declaration a later rule with the same selector already sets", () => {
    const groups = new Map<string, Rule[]>();
    for (const rule of rules(css)) {
      const key = `${rule.context}||${rule.selector}`;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    expect(groups.size).toBeGreaterThan(400);

    const beaten: string[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const later = properties(list.at(-1)!.body);
      for (const earlier of list.slice(0, -1)) {
        for (const [property, value] of properties(earlier.body)) {
          // An important declaration wins from wherever it is written, which
          // is the one case where the earlier rule is the one being read.
          if (value.includes("!important")) continue;
          if (!later.has(property)) continue;
          beaten.push(
            `${earlier.selector} line ${earlier.line}: ${property} is set again at line ${list.at(-1)!.line}`,
          );
        }
      }
    }
    expect(beaten).toEqual([]);
  });

  it("paints the window's own strip in the colour the workspace is painted in", () => {
    // The colour the browser puts around the window before anything has drawn
    // was a hand-copied near-match of the palette, in three places, none of
    // them equal to `--bg`: a cold start showed a strip in a colour the app
    // never uses. The workspace reads the palette now; the boot script cannot,
    // because it runs before there is a stylesheet, so its pair is held here.
    const html = readFileSync(join(ROOT, "..", "index.html"), "utf8");
    const backgrounds = [...css.matchAll(/--bg:\s*(#[0-9a-f]{3,8})/g)].map(
      (match) => match[1],
    );
    // The dark palette first, then the light one, which is the order the file
    // declares them in and the order the boot script names them.
    expect(backgrounds).toHaveLength(2);
    const [dark, light] = backgrounds;
    expect(html).toContain(`content="${dark}"`);
    expect(html).toContain(`? "${light}" : "${dark}"`);
    // And the fallback the workspace keeps for a window with no stylesheet.
    const appearance = readFileSync(
      join(ROOT, "hooks", "useAppearance.ts"),
      "utf8",
    );
    expect(appearance).toContain(`dark: "${dark}"`);
    expect(appearance).toContain(`light: "${light}"`);
  });

  it("has no rule with nothing in it", () => {
    // What is left when the last live declaration goes. It reads as a place
    // something belongs rather than as nothing at all.
    const empty = rules(css)
      .filter((rule) => rule.body.trim() === "")
      .map((rule) => `${rule.selector} line ${rule.line}`);
    expect(empty).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * Read with the parser the build itself uses rather than a walk written here.
 *
 * A hand-rolled one was written first and was wrong: this file's comments
 * quote whole rules back, braces and all, and a walk that steps over a
 * comment as text loses count. It saw 37 rules carrying a colour where there
 * are 80, and the gate built on it passed over a colour planted in the middle
 * of the file. A stylesheet is not a thing to parse by eye.
 */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  postcss.parse(css).walkRules((rule) => {
    found.push(rule);
  });
  return found;
}

/** The at-rule a rule sits inside, as one string, or "" at the top level. */
function context(rule: Rule): string {
  const parts: string[] = [];
  for (
    let at: Rule["parent"] = rule.parent;
    at && at.type !== "root";
    at = at.parent
  ) {
    if (at.type === "atrule") parts.unshift(`@${at.name} ${at.params}`);
  }
  return parts.join(" >> ");
}

/** Which properties a rule sets, ignoring the custom ones a theme reaches. */
function properties(rule: Rule): Map<string, string> {
  const set = new Map<string, string>();
  rule.walkDecls((declaration) => {
    if (declaration.parent !== rule) return;
    if (declaration.prop.startsWith("--")) return;
    set.set(
      declaration.prop,
      declaration.value + (declaration.important ? " !important" : ""),
    );
  });
  return set;
}

/**
 * Where the stylesheet writes a colour rather than reading a token, and why.
 *
 * Matched on the front of a rule's first selector, so a family shares one
 * reason. A colour anywhere else fails the test below, which is the point:
 * the light theme is where a literal shows up, and nobody opens the light
 * theme to add a shadow.
 */
const LITERALS_WITH_A_REASON: Array<{ selector: string; reason: string }> = [
  {
    // Not a bare `:root`, which would take every rule in the responsive half
    // of the file with it: fifty-eight of them begin `:root[data-narrow…]`.
    // The palettes themselves need no entry, being custom properties, which
    // are not read here at all.
    selector: ":root[data-ambient",
    reason: "The three washes the weather puts over the rail.",
  },
  {
    selector: ".legend-ramp",
    reason: "A ramp is the reading's own colours, which no theme may reach.",
  },
  {
    selector: ".skewt",
    reason:
      "The diagram's own ink: the adiabats, the mixing lines, the two traces.",
  },
  { selector: ".hodograph", reason: "The same, for the hodograph." },
  {
    selector: ".sounding",
    reason: "The diagram's ground, and what says a sounding is a model's.",
  },
  { selector: ".alert-tag", reason: "The office's own severity colours." },
  {
    selector: ".track-swatch",
    reason: "The colour a track is drawn in on the map, beside the map.",
  },
  {
    selector: ".status-dot",
    reason:
      "A hairline around a dot that is otherwise drawn in tokens, and it has a light counterpart of its own beside it.",
  },
  {
    selector: ".capture-bar",
    reason:
      "A recording surface, fixed dark on purpose: it is burned into a picture that goes somewhere else, where the reader's theme means nothing.",
  },
  {
    selector: ".ambient-readout",
    reason:
      "Drawn straight onto the map, so what it stays legible against is the basemap rather than the chrome; its variant is keyed on that.",
  },
  {
    selector: ".map-popup",
    reason: "Over the map rather than in the chrome, with its own surface.",
  },
  {
    selector: ".maplibregl-popup",
    reason:
      "The library's own markup, styled to match the popup it is part of.",
  },
  {
    selector: ".command-bar",
    reason:
      "The rail's own ground, which is the same dark in both themes on purpose: everything in it is drawn against that rather than against the reader's chosen surface, and the rule above it reasons about the contrast.",
  },
  {
    selector: ".command-scroll-region",
    reason: "A fade to nothing at the ends of a scrolling list.",
  },
  {
    selector: ".surface-panel",
    reason:
      "The shadow a panel casts, which is not a colour anybody reads. Reaches the panel's own parts as well, which are drawn in tokens today.",
  },
  {
    selector: ".fatal-error__mark",
    reason: "The ink on the danger colour, which has to stay legible on it.",
  },
  {
    selector: ".map-watermark",
    reason: "Over the map, with a light counterpart beside it.",
  },
  {
    selector: ".map-readout",
    reason: "The same: over the map, with a light counterpart beside it.",
  },
  {
    selector: ".source-attribution",
    reason: "The same again, and the same counterpart.",
  },
  {
    selector: ".map-style-card",
    reason: "A swatch of the basemap it offers, which is a picture of it.",
  },
  {
    selector: ".segmented-control",
    reason: "The ink on the accent, which follows the accent, not the theme.",
  },
  {
    selector: 'input[type="range"]',
    reason: "The thumb of a slider, drawn on the accent.",
  },
  {
    selector: ".product-legend",
    reason: "Sits over the map beside the ramps it labels.",
  },
  { selector: ".radar-legend", reason: "The same, and it carries the ramps." },
];

/**
 * What the file says against what the browser does.
 *
 * This stylesheet grew a second layout at the bottom without the first one
 * being taken out, so ninety-two declarations were being read by everybody
 * who opened the file and by nobody's browser: a radial vignette on the map
 * stage, the whole of the brand mark's colour, the pressed state of a command
 * button. The first thing anybody does with a rule like that is edit it,
 * watch nothing happen, and go looking for the reason somewhere else.
 */
describe("the stylesheet says what the browser does", () => {
  const css = readFileSync(join(ROOT, "index.css"), "utf8");
  const all = rules(css);

  it("has no declaration a later rule with the same selector already sets", () => {
    const groups = new Map<string, Rule[]>();
    for (const rule of all) {
      // Whitespace flattened: `.a,.b` and `.a, .b` select the same elements,
      // and which of the two a rule is written as is prettier's decision.
      const key = `${context(rule)}||${rule.selector.replace(/\s+/g, " ")}`;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    expect(groups.size).toBeGreaterThan(400);

    const beaten: string[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Every pair, rather than each against the last. A declaration killed
      // by a duplicate in the middle of three is just as dead, and comparing
      // only against the last of them cannot see it.
      for (const [at, earlier] of list.entries()) {
        for (const later of list.slice(at + 1)) {
          const wins = properties(later);
          for (const [property, value] of properties(earlier)) {
            // An important declaration wins from wherever it is written,
            // which is the one case where the earlier rule is the one read.
            if (value.includes("!important")) continue;
            if (!wins.has(property)) continue;
            beaten.push(
              `${earlier.selector} line ${earlier.source?.start?.line}: ${property} is set again at line ${later.source?.start?.line}`,
            );
          }
        }
      }
    }
    expect(beaten).toEqual([]);
  });

  it("keeps a rule inside a media query from losing to a later plain one", () => {
    // A media query adds no specificity. The forced-colours block asks the
    // system for its own background and its own colour for "this one is
    // chosen", and both were being lost to plain rules written later in the
    // file: a reader who asked for high contrast got the app's dark bar and
    // an active button whose border was gone, with the rule that said
    // otherwise sitting right there in the file.
    const plain = all.filter((rule) => !context(rule));
    const beaten: string[] = [];
    for (const [at, rule] of all.entries()) {
      const inside = context(rule);
      if (!/@media|@supports/.test(inside)) continue;
      const mine = properties(rule);
      for (const later of plain) {
        if (later.selector !== rule.selector) continue;
        if (all.indexOf(later) < at) continue;
        const wins = properties(later);
        for (const [property, value] of mine) {
          if (value.includes("!important")) continue;
          if (!wins.has(property)) continue;
          beaten.push(
            `${inside} ${rule.selector} line ${rule.source?.start?.line}: ${property} is taken by line ${later.source?.start?.line}`,
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

  it("writes a colour of its own only where somebody said why", () => {
    // A literal is not wrong. A reading's own ramp, a recording surface and a
    // halo over a map are all colours that do not belong to a theme. What is
    // wrong is a new one arriving in the chrome without anybody saying which
    // of those it is, because the light theme is where that shows up and
    // nobody opens the light theme to add a shadow.
    const literal = /#[0-9a-fA-F]{3,8}|rgba?\(/;
    const light = /data-theme="light"|prefers-color-scheme/;
    const unexplained: string[] = [];
    for (const rule of all) {
      const colours = [...properties(rule).values()].some((value) =>
        literal.test(value),
      );
      if (!colours) continue;
      // A light rule is the counterpart rather than a thing needing one, and
      // a keyframe stop is a step in an animation rather than a surface.
      if (light.test(rule.selector) || light.test(context(rule))) continue;
      if (context(rule).includes("@keyframes")) continue;
      const first = rule.selector.split(",")[0].trim();
      // The named thing, or something belonging to it, rather than anything
      // whose text happens to start the same way. Written as a bare prefix,
      // the `:root` entry let through all fifty-eight rules beginning
      // `:root[data-narrow~="680"]`, which is most of the responsive half of
      // the file.
      const belongs = (selector: string) => {
        if (!first.startsWith(selector)) return false;
        const rest = first.slice(selector.length);
        // An entry naming an attribute is precise by construction, so it may
        // end inside one; anything else has to end where a name ends.
        if (selector.includes("[")) return true;
        return rest === "" || /^[\s.:[>+~-]|^__/.test(rest);
      };
      if (LITERALS_WITH_A_REASON.some((one) => belongs(one.selector))) {
        continue;
      }
      unexplained.push(`${first} line ${rule.source?.start?.line}`);
    }
    expect(unexplained).toEqual([]);
  });

  it("has no rule with nothing in it", () => {
    // What is left when the last live declaration goes. It reads as a place
    // something belongs rather than as nothing at all.
    const empty = all
      .filter((rule) => rule.nodes.length === 0)
      .map((rule) => `${rule.selector} line ${rule.source?.start?.line}`);
    expect(empty).toEqual([]);
  });
});

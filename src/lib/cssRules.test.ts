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

/**
 * The shorthand that swallows a longhand, for the families this file writes.
 *
 * `background-color` is gone the moment a later rule sets `background`, and
 * comparing property names alone cannot see it: the two names are different
 * and the declaration is just as dead. Only the families this stylesheet
 * actually uses are here, because a table nobody reads is a table that rots.
 */
const SWALLOWED_BY: Record<string, string[]> = {
  "background-color": ["background"],
  "background-image": ["background"],
  "background-position": ["background"],
  "background-size": ["background"],
  "background-repeat": ["background"],
  // `border` resets the width, the style and the colour of all four sides,
  // and the image. It does NOT reset the radius, which was in this table and
  // was wrong: `#a{border-radius:8px} #a{border:0}` leaves the radius
  // standing, and this file writes a radius 119 times against 104 borders.
  "border-color": ["border"],
  "border-style": ["border"],
  "border-width": ["border"],
  "border-top": ["border"],
  "border-right": ["border"],
  "border-bottom": ["border"],
  "border-left": ["border"],
  "font-size": ["font"],
  "font-weight": ["font"],
  "font-family": ["font"],
  "font-style": ["font"],
  "line-height": ["font"],
  "flex-basis": ["flex"],
  "flex-grow": ["flex"],
  "flex-shrink": ["flex"],
  "flex-direction": ["flex-flow"],
  "flex-wrap": ["flex-flow"],
  "grid-template-columns": ["grid-template", "grid"],
  "grid-template-rows": ["grid-template", "grid"],
  "grid-row": ["grid-area"],
  "grid-column": ["grid-area"],
  top: ["inset"],
  right: ["inset"],
  bottom: ["inset"],
  left: ["inset"],
  "margin-top": ["margin"],
  "margin-right": ["margin"],
  "margin-bottom": ["margin"],
  "margin-left": ["margin"],
  "padding-top": ["padding"],
  "padding-right": ["padding"],
  "padding-bottom": ["padding"],
  "padding-left": ["padding"],
  "align-items": ["place-items"],
  "justify-items": ["place-items"],
  "align-content": ["place-content"],
  "justify-content": ["place-content"],
  "outline-color": ["outline"],
  "outline-style": ["outline"],
  "outline-width": ["outline"],
  "animation-name": ["animation"],
  "animation-duration": ["animation"],
  "animation-timing-function": ["animation"],
  "animation-delay": ["animation"],
  "animation-iteration-count": ["animation"],
  "animation-fill-mode": ["animation"],
  "transition-property": ["transition"],
  "transition-duration": ["transition"],
  "transition-timing-function": ["transition"],
  "transition-delay": ["transition"],
  "list-style-type": ["list-style"],
  "list-style-position": ["list-style"],
  "list-style-image": ["list-style"],
  "text-decoration-line": ["text-decoration"],
  "text-decoration-color": ["text-decoration"],
  "text-decoration-style": ["text-decoration"],
  "mask-image": ["mask"],
  "overflow-x": ["overflow"],
  "overflow-y": ["overflow"],
  "row-gap": ["gap"],
  "column-gap": ["gap"],
};

/** Whether a later rule setting these properties kills this one. */
function taken(property: string, wins: Map<string, string>): boolean {
  if (wins.has(property)) return true;
  return (SWALLOWED_BY[property] ?? []).some((shorthand) =>
    wins.has(shorthand),
  );
}

/**
 * How hard a selector is to beat, as the three counts the cascade uses.
 *
 * The first version of this was never reached: it was only ever asked whether
 * a selector beat a prefix extension of itself, where the answer is yes
 * whatever the counts say, so it could be wrong in four places and nothing
 * noticed. It decides real questions now, so it is written to the
 * specification and held to it by a case list below.
 *
 * `:where()` contributes nothing and takes its contents with it. `:not()`,
 * `:is()` and `:has()` contribute their argument, which is exact for one
 * argument and an over-count for a list, where the specification takes the
 * largest. This file has six `:not()`, each with a single argument, and no
 * `:is`, `:where` or `:has` at all, so the list case cannot arise here; it is
 * written down rather than left to be found later. A pseudo-element counts as
 * a type selector rather than as nothing.
 */
function weight(selector: string): [number, number, number] {
  const bare = selector
    // An escaped character is not the thing it looks like.
    .replace(/\\./g, "")
    // Pseudo-elements first, or the pseudo-class pass below would take the
    // second colon and leave the name behind. Each becomes a type selector.
    .replace(/::[a-z-]+(?:\([^)]*\))?/g, " e")
    .replace(/:where\([^)]*\)/g, " ")
    .replace(/:(?:not|is|has)\(([^)]*)\)/g, " $1 ");
  return [
    (bare.match(/#[\w-]+/g) ?? []).length,
    (bare.match(/\.[\w-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?/g) ?? []).length,
    (bare.match(/(^|[\s>+~(,])[a-z][\w-]*/g) ?? []).length,
  ];
}

/**
 * The element a selector is about, which is its last compound.
 *
 * `.app-shell .command-bar` and `:root[data-narrow~="680"] .command-bar` are
 * both rules about command bars; everything in front only says which ones. So
 * two rules that share a subject are two rules about one kind of element, and
 * the later of them can take a declaration from the earlier.
 */
function subject(selector: string): string {
  const compounds = selector
    .replace(/\s*[>+~]\s*/g, " ")
    .trim()
    .split(/\s+/);
  return compounds[compounds.length - 1] ?? selector;
}

/** Whether the second selector wins a tie or better against the first. */
function beats(later: string, earlier: string): boolean {
  const [a, b, c] = weight(later);
  const [x, y, z] = weight(earlier);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
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

  it("counts a selector's weight the way the cascade does", () => {
    // Held against the specification rather than against this file. The first
    // version of `weight` was only ever asked whether a selector beat a
    // prefix extension of itself, where the answer is yes whatever the counts
    // are, so four mistakes in it were invisible. It decides now.
    const cases: Array<[string, [number, number, number]]> = [
      ["div", [0, 0, 1]],
      [".a", [0, 1, 0]],
      ["#a", [1, 0, 0]],
      // A pseudo-element is a type selector, not nothing.
      ["a::before", [0, 0, 2]],
      ["::-webkit-scrollbar", [0, 0, 1]],
      // `:where` contributes nothing at all, and its contents go with it.
      [".a:where(.b.c.d)", [0, 1, 0]],
      // `:not` and `:has` contribute their argument.
      [".a:not(.b)", [0, 2, 0]],
      [".a:has(.b)", [0, 2, 0]],
      // The pair the media gate has to tell apart, which is what sent it
      // looking: the second of these was taking the first and neither the
      // string comparison nor the suffix one could see it.
      [":root .surface-panel", [0, 2, 0]],
      [':root[data-narrow~="680"] .surface-panel', [0, 3, 0]],
      // And two more this file really carries.
      ['.command-button[aria-pressed="true"]', [0, 2, 0]],
      [".status-list span:not(.status-dot)", [0, 2, 1]],
    ];
    for (const [selector, want] of cases) {
      expect(weight(selector), selector).toEqual(want);
    }
    // What the gate asks of it: a later rule that ties takes the declaration
    // and a weaker one does not.
    expect(beats(".a .b", ".b")).toBe(true);
    expect(beats(".b", ".b")).toBe(true);
    expect(beats("div.b", ".a.b")).toBe(false);
    expect(beats("[data-x] .b", "#a .b")).toBe(false);
    // And the subject, which is what says two rules are about one element.
    expect(subject(':root[data-narrow~="680"] .surface-panel')).toBe(
      ".surface-panel",
    );
    expect(subject(".a > .b + .c ~ .d")).toBe(".d");
    expect(subject(".toast")).toBe(".toast");
  });

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
            // By the property's own name or by the shorthand that swallows
            // it: `background-color` is gone once a later rule sets
            // `background`, and the names never match.
            if (!taken(property, wins)) continue;
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
    //
    // The first version of this compared the two selectors as strings, which
    // is the narrowest thing it could have done: a later
    // `.app-shell .command-bar` takes the bar's background from the block
    // just as completely as another `.command-bar` would, and reads as a
    // different rule. Same elements, then weight, is the question the
    // browser asks.
    // Its second version compared whole selectors as a suffix, which is only
    // a little wider and missed the case the first repair created: raising a
    // rule to `:root .surface-panel` put it past the plain rules and left it
    // losing to `:root[data-narrow~="680"] .surface-panel`, which neither
    // equals it nor ends with it. What two rules share when one can take from
    // the other is the element they select, which is the last compound;
    // everything in front only says which of those elements, and the weight
    // settles the rest.
    const parts = (rule: Rule) =>
      rule.selector.split(",").map((one) => one.replace(/\s+/g, " ").trim());
    const plain = all.filter((rule) => !context(rule));
    const beaten: string[] = [];
    for (const [at, rule] of all.entries()) {
      const inside = context(rule);
      if (!/@media|@supports/.test(inside)) continue;
      const mine = properties(rule);
      // One selector of the block's list at a time. Reported per rule, a
      // block naming six things was reported as beaten six times over
      // whichever one of them really was, and `.toast` was named four times
      // by lines that do not select a toast at all.
      for (const one of parts(rule)) {
        for (const later of plain) {
          if (all.indexOf(later) < at) continue;
          const takes = parts(later).some(
            (other) => subject(other) === subject(one) && beats(other, one),
          );
          if (!takes) continue;
          const wins = properties(later);
          for (const [property, value] of mine) {
            if (value.includes("!important")) continue;
            if (!taken(property, wins)) continue;
            beaten.push(
              `${inside} ${one} line ${rule.source?.start?.line}: ${property} is taken by line ${later.source?.start?.line}`,
            );
          }
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

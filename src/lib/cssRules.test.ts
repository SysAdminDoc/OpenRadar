import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";
import { selectorSpecificity } from "@csstools/selector-specificity";
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
 * A rule's selectors, one per element it is about.
 *
 * Not a split on commas: `:is(.a, .b)` carries one selector and splitting on
 * every comma made three out of it, then measured each half of an argument as
 * though it were a rule of its own.
 */
function selectors(selector: string): string[] {
  return selectorParser()
    .astSync(selector)
    .nodes.map((one) => String(one).replace(/\s+/g, " ").trim());
}

/**
 * How hard a selector is to beat, as the three counts the cascade uses.
 *
 * The first version of this was never reached: it was only ever asked whether
 * a selector beat a prefix extension of itself, where the answer is yes
 * whatever the counts say, so it could be wrong in four places and nothing
 * noticed. It decides real questions now.
 *
 * The second version was hand-rolled against the specification and held to it
 * by a case list, and it was wrong in nine more ways the list did not reach:
 * `:is(.a, .b)` summed where the specification takes the largest, a legacy
 * one-colon pseudo-element counted as a class, `::slotted()` and namespaces
 * and a comment inside a selector all miscounted, and a repair that moved the
 * id count away from attribute values took `:host(#a)` and `:nth-child(odd of
 * #a)` down with it. Nine ways is not a case list short, it is the wrong
 * shape of answer: selector specificity is a small algorithm with a reference
 * implementation, and thirty lines of regular expressions is a second one.
 *
 * So this is the reference implementation, run over a parse rather than over
 * a string. `@csstools/selector-specificity` is what stylelint's own rules
 * use for exactly this question.
 */
function weight(selector: string): [number, number, number] {
  const root = selectorParser().astSync(selector);
  // One selector, not a list. A list has no single weight, each of its
  // selectors carries its own, and reading `first` and stopping would answer
  // for `.a, #b` with the weight of `.a`. The gate's callers split with
  // `selectors` before they get here, so this is a refusal rather than a
  // rule: the next caller that forgets is told rather than answered.
  expect(root.nodes, `${selector} is a list, not a selector`).toHaveLength(1);
  const found = selectorSpecificity(root.first);
  return [found.a, found.b, found.c];
}

/**
 * The element a selector is about, which is its last compound.
 *
 * `.app-shell .command-bar` and `:root[data-narrow~="680"] .command-bar` are
 * both rules about command bars; everything in front only says which ones. So
 * two rules that share a subject are two rules about one kind of element, and
 * the later of them can take a declaration from the earlier.
 *
 * Descendants only, in the sense that this says nothing about whether the two
 * ancestries overlap: `.app-shell .toast` and `.capture-bar .toast` share a
 * subject and select nothing in common, and would be reported as a defeat.
 * No pair in this file is that shape, and the gate is meant to shout.
 */
function subject(selector: string): string {
  // Taken off the parse for the same reason the weight is. Held out of the
  // way by hand, a space inside an attribute value read as a combinator and
  // split a selector in the middle of a value; the version that fixed that
  // protected brackets and not parentheses, so `:not(.a .b)` still split. The
  // parser knows which spaces are combinators.
  const root = selectorParser().astSync(selector);
  const compound: string[] = [];
  for (const node of root.first.nodes) {
    if (node.type === "combinator") compound.length = 0;
    else compound.push(String(node).trim());
  }
  return compound.join("") || selector;
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
 * Every declaration inside an at-rule that a later plain rule takes away.
 *
 * A function over parsed rules rather than a block inside the test, so a
 * case list can drive it with a stylesheet written for the purpose. It could
 * not be, and that mattered: on the current `index.css` this reports nothing
 * under the subject rule, under the suffix rule it replaced, and under plain
 * string equality, so reverting the containment left the whole suite green
 * and only the pre-repair stylesheet told them apart.
 */
function beatenInsideAtRules(all: Rule[]): string[] {
  const parts = (rule: Rule) => selectors(rule.selector);
  const plain = all.filter((rule) => !context(rule));
  const beaten: string[] = [];
  for (const [at, rule] of all.entries()) {
    const inside = context(rule);
    if (!/@media|@supports/.test(inside)) continue;
    const mine = properties(rule);
    // One selector of the block's list at a time. Reported per rule, a block
    // naming six things was reported as beaten six times over whichever one
    // of them really was, and `.toast` was named four times by lines that do
    // not select a toast at all.
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
  return beaten;
}

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

  it("sees a later plain rule take a declaration however it is written", () => {
    // Driven on a stylesheet written for it, because `index.css` cannot tell
    // these apart: it reports nothing under the subject rule, under the
    // suffix rule that came before it and under plain string equality, so
    // reverting the containment leaves every other case here green. The
    // shapes below are the three that matter, and only the last one is what
    // the file itself ever had.
    const said = (css: string) => beatenInsideAtRules(rules(css));

    // The exact string, which every version of this has caught.
    expect(
      said("@media (forced-colors: active){.a{color:red}} .a{color:blue}"),
    ).toHaveLength(1);
    // A descendant in front of it, which the string comparison could not see.
    expect(
      said("@media (forced-colors: active){.a{color:red}} .b .a{color:blue}"),
    ).toHaveLength(1);
    // And a heavier ancestor on the same subject, which the suffix comparison
    // could not see either. This is the shape that got past the last repair.
    expect(
      said(
        "@media (forced-colors: active){:root .a{color:red}}" +
          ':root[data-x="1"] .a{color:blue}',
      ),
    ).toHaveLength(1);

    // And the two it must stay quiet about: a weaker later rule, and one
    // written before the block rather than after it.
    expect(
      said("@media (forced-colors: active){.b .a{color:red}} .a{color:blue}"),
    ).toEqual([]);
    expect(
      said("* .a{color:blue} @media (forced-colors: active){.a{color:red}}"),
    ).toEqual([]);
  });

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
      // `:not` and `:has` contribute their argument, which is why the two
      // below are here as well as these: with a class argument, "expand the
      // argument" and "count the pseudo-class as one class" give the same
      // answer, so deleting the expansion left the whole list green.
      [".a:not(.b)", [0, 2, 0]],
      [".a:has(.b)", [0, 2, 0]],
      [".a:not(#b)", [1, 1, 0]],
      [".a:has(div)", [0, 1, 1]],
      // A pseudo-class's own argument is not a selector: `odd` was counted
      // as a type selector and `show more` as one too.
      [":nth-child(odd)", [0, 1, 0]],
      ["li:nth-of-type(even)", [0, 1, 1]],
      ['[aria-label="show more"]', [0, 1, 0]],
      // Nor is what is inside an attribute value an id, however it is spelled:
      // a fragment link is one attribute and nothing else.
      ['a[href="#top"]', [0, 1, 1]],
      ['[data-tag="#a.b"]', [0, 1, 0]],
      // And a type selector may be written in any case.
      ["DIV", [0, 0, 1]],
      // The pair the media gate has to tell apart, which is what sent it
      // looking: the second of these was taking the first and neither the
      // string comparison nor the suffix one could see it.
      [":root .surface-panel", [0, 2, 0]],
      [':root[data-narrow~="680"] .surface-panel', [0, 3, 0]],
      // And two more this file really carries.
      ['.command-button[aria-pressed="true"]', [0, 2, 0]],
      [".status-list span:not(.status-dot)", [0, 2, 1]],
      // The nine the hand-rolled version got wrong, kept as cases rather than
      // dropped with it: a list takes its largest argument and not their sum,
      // a pseudo-class argument that really is a selector counts, a legacy
      // one-colon pseudo-element is a pseudo-element, and a type selector may
      // be written in any case.
      [":is(.a, .b)", [0, 1, 0]],
      [":is(.a, #b)", [1, 0, 0]],
      [":not(.a, #b)", [1, 0, 0]],
      [":host(#a)", [1, 1, 0]],
      [":host-context(#a)", [1, 1, 0]],
      [":nth-child(odd of #a)", [1, 1, 0]],
      [":nth-child(2n+1 of .foo)", [0, 2, 0]],
      ["a:before", [0, 0, 2]],
      ["::slotted(.a)", [0, 1, 1]],
      ["DIV", [0, 0, 1]],
    ];
    for (const [selector, want] of cases) {
      expect(weight(selector), selector).toEqual(want);
    }

    // A rule is about as many elements as the cascade says, which is not one
    // per comma: `:is()` carries its own, and splitting on every one of them
    // made three rules out of this and then weighed `.c) .d` as a selector.
    expect(selectors(".a, :is(.b, .c) .d")).toEqual([".a", ":is(.b, .c) .d"]);
    // And a list handed straight to `weight` is refused rather than answered
    // for by whichever selector happens to come first.
    expect(() => weight(".a, #b")).toThrow();
    // And the subject is the last compound, where a space inside parentheses
    // is not a combinator any more than one inside brackets is.
    expect(subject(":not(.a .b) .c")).toBe(".c");
    expect(subject(".x:not(.a .b)")).toBe(".x:not(.a .b)");
    expect(subject('.y[aria-label="show more"]')).toBe(
      '.y[aria-label="show more"]',
    );
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
    // A space inside an attribute value is not a combinator.
    expect(subject('.a[data-x="two words"]')).toBe('.a[data-x="two words"]');
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
    const beaten = beatenInsideAtRules(all);
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
      const first = selectors(rule.selector)[0];
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

  it("turns every blur off for a reader who asked for contrast", () => {
    // The two contrast blocks named five surfaces. Six selectors in the file
    // declare a blur, and three of the six were not among the five; the other
    // two names in the blocks are surfaces that only ever write `none`, so
    // the eight the blocks list now is a list length rather than a count of
    // anything that ever blurred.
    // Measured in Chromium before this: at `prefers-contrast: more` the tool
    // readout stayed at `blur(18px)`, the product legend at `blur(9px)` and
    // the toast at `blur(20px)`, in both layouts, and two of the three
    // survived `forced-colors: active` as well. Nothing said so, because the
    // list was written by hand and the surfaces were added later.
    //
    // A list against a list, so adding a translucent surface without adding
    // it to both blocks is what fails rather than something a reader finds.
    //
    // Three things the first version of this could not see, each of which
    // would have let exactly the defect above back in. It skipped every rule
    // inside an at-rule, so a blur written under a width query was invisible
    // while the plain spelling of the same rule reddened it. It knew one of
    // the two spellings of the property, and the prefixed one is what Safari
    // and a WKWebView read. And it read one of the app's two stylesheets.
    // Six things this could not see across two passes, each of which puts a
    // blur back in front of a reader who asked for contrast. Walking rules
    // and reading their own declarations misses a query nested inside a rule,
    // because postcss gives that as an at-rule between the two and neither
    // half is a rule with the declaration in it. Testing the at-rule text for
    // a substring counts a clear narrowed by `and (min-width: 4000px)`, and
    // one negated with `not all and`, as clears: one of those fires almost
    // never and the other exactly backwards. And a clear only clears if it
    // wins, which nothing here asked:
    // re-blurring the toast with `!important` at the end of the file measured
    // `blur(20px)` under contrast with every case here green, in a file whose
    // contrast block already needed `!important` to win a specificity war.
    const BLUR = new Set(["backdrop-filter", "-webkit-backdrop-filter"]);
    /**
     * The rule a declaration belongs to, however many at-rules are between.
     *
     * `declaration.parent` is the at-rule when a query is nested inside a
     * rule, which is the shape CSS nesting gives and the mirror image of a
     * rule nested inside a query. Reading the parent alone saw neither the
     * selector nor the declaration and let a nested blur through with every
     * case green.
     */
    const owner = (node: Rule["parent"]): Rule | null => {
      for (let at = node; at && at.type !== "root"; at = at.parent) {
        if (at.type === "rule") return at as Rule;
      }
      return null;
    };
    /**
     * Every blur in a sheet, wherever and however it is written.
     *
     * Walks declarations rather than rules, so a query nested inside a rule
     * is the same question as one wrapped around it, and reports what a
     * contrast block would have to name: the property, the selector, and the
     * at-rules it sits under.
     */
    const blursIn = (css: string) => {
      const found = new Map<string, boolean>();
      postcss.parse(css).walkDecls((declaration) => {
        if (!BLUR.has(declaration.prop)) return;
        if (declaration.value.startsWith("none")) return;
        const rule = owner(declaration.parent);
        if (!rule) return;
        const inside = context(rule);
        // A keyframe's selector is a percentage rather than something a
        // contrast block could name, so a blur animated there is a different
        // question from this one.
        if (inside.includes("@keyframes")) return;
        for (const one of selectors(rule.selector)) {
          found.set(`${declaration.prop} on ${one}`, declaration.important);
        }
      });
      return found;
    };
    /** And every one of those a given query turns off, with the weight to. */
    const clearedIn = (css: string, query: string) => {
      const found = new Set<string>();
      postcss.parse(css).walkDecls((declaration) => {
        if (!BLUR.has(declaration.prop)) return;
        if (declaration.value !== "none" || !declaration.important) return;
        const rule = owner(declaration.parent);
        if (!rule) return;
        // The whole condition and nothing else. A clear narrowed by a second
        // condition is a clear for some readers, and a `not all and` one is a
        // clear for the readers who did not ask.
        if (context(rule) !== `@media (${query})`) return;
        for (const one of selectors(rule.selector)) {
          found.add(`${declaration.prop} on ${one}`);
        }
      });
      return found;
    };

    // The glance window is its own document with its own stylesheet, so its
    // blurs have to be turned off by its own blocks. It has none today, which
    // is the point: the gate is here before the first one is.
    // Every stylesheet the app has, found rather than listed. A list of two
    // is a list that goes stale the first time somebody adds a third, and a
    // gate that reads two of three sheets says nothing about the third while
    // reading as though it covers the app.
    //
    // `backdrop-filter` and its prefixed spelling only. A plain `filter:
    // blur()` blurs the element rather than what is behind it, which is a
    // decorative effect on a picture and not a translucent surface a warning
    // has to read through, so it is a different question with a different
    // answer and does not belong in this list.
    const sheets = readdirSync(ROOT)
      .filter((name) => name.endsWith(".css"))
      .map((name) => [name, readFileSync(join(ROOT, name), "utf8")] as const);
    expect(sheets.length, "no stylesheet was read").toBeGreaterThan(1);
    expect(blursIn(css).size).toBeGreaterThan(4);

    for (const [name, sheet] of sheets) {
      const blurred = blursIn(sheet);
      // No blur may be `!important`. The clears are, and that is the only
      // reason they win: an important blur is either a defeat outright or a
      // race on file order, and neither is a thing to leave to a later edit.
      expect(
        [...blurred].filter(([, important]) => important).map(([one]) => one),
        `${name} blurs a surface with !important`,
      ).toEqual([]);
      for (const query of ["prefers-contrast: more", "forced-colors: active"]) {
        expect(
          [...blurred.keys()].filter(
            (one) => !clearedIn(sheet, query).has(one),
          ),
          `${name} at ${query}`,
        ).toEqual([]);
      }
    }
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

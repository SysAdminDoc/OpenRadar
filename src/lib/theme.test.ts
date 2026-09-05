import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  looksLikeTheme,
  parseTheme,
  parseThemeColor,
  parseThemeShadow,
  parseThemeWeight,
  themeCss,
  themeFromAccent,
  themeText,
  THEME_STYLE_ID,
  THEME_TOKENS,
} from "./theme";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

const ROOT = join(import.meta.dirname, "..");

afterEach(() => applyTheme(null));

/**
 * Every TypeScript file in the app, tests included.
 *
 * A test that reaches for a theme token is a test written against a boundary
 * that has already moved, so it is scanned like everything else.
 */
function sourceFiles(from: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(from)) {
    const path = join(from, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

const SAMPLE = `OpenRadar theme
Name: Harbour
Base: dark
Accent: #7cc4ff
AccentSoft: rgba(124, 196, 255, 0.16)
Surface: rgba(14, 20, 30, 0.94)
Shadow: 0 18px 45px rgba(0, 0, 0, 0.4)
HeadingWeight: 700
`;

describe("a theme reaches the chrome and nothing else", () => {
  it("sets only the tokens on the list", () => {
    const read = parseTheme(SAMPLE, "harbour.txt");
    expect(read).not.toBeNull();
    const css = themeCss(read!.theme);
    const properties = [...css.matchAll(/(--[a-z-]+):/g)].map(
      (match) => match[1],
    );
    expect(properties.length).toBeGreaterThan(0);
    const allowed = THEME_TOKENS.map((token) => token.property);
    for (const property of properties) expect(allowed).toContain(property);
  });

  it("keeps the list of tokens to chrome", () => {
    // Pinned rather than described. Adding a token is a decision about
    // whether the thing it colours is the workspace or the weather, and this
    // is where somebody has to make it.
    expect(THEME_TOKENS.map((token) => token.property)).toEqual([
      "--surface",
      "--surface-solid",
      "--surface-raised",
      "--surface-hover",
      "--border",
      "--border-strong",
      "--accent",
      "--accent-strong",
      "--accent-soft",
      "--shadow",
      "--heading-weight",
    ]);
  });

  it("leaves every colour that carries a reading out of reach", () => {
    // Not a list of the modules somebody thought of. Every source file under
    // src/, minus the two that define the boundary, must not mention a theme
    // token at all: the colours a reading is drawn in are written where the
    // reading is decided, and none of that reads a custom property. A hand
    // list is how `src/lib/overlays/alerts.ts`, which draws the warning
    // outlines this whole separation exists for, went unchecked.
    const properties = THEME_TOKENS.map((token) => token.property);
    const allowed = new Set([
      join(ROOT, "lib", "theme.ts"),
      join(ROOT, "lib", "theme.test.ts"),
    ]);
    const offenders: string[] = [];
    for (const path of sourceFiles(ROOT)) {
      if (allowed.has(path)) continue;
      const source = readFileSync(path, "utf8");
      for (const property of properties) {
        if (source.includes(property)) {
          offenders.push(`${path.slice(ROOT.length + 1)}: ${property}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("opens the colour control on the accent that is actually on screen", () => {
    // The stylesheet defines the accent twice per look and the later one
    // wins, so a swatch copied from the first pair opens on a colour nobody
    // is looking at. Read the last of each here rather than trusting a
    // comment to stay true.
    const css = readFileSync(join(ROOT, "index.css"), "utf8");
    // Walked as rules rather than searched from a selector, because the last
    // rule that names a look is not the last rule that sets its accent.
    const accents: Record<"dark" | "light", string | null> = {
      dark: null,
      light: null,
    };
    for (const rule of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const value = /--accent:\s*([^;]+);/.exec(rule[2])?.[1].trim();
      if (!value) continue;
      accents[rule[1].includes('data-theme="light"') ? "light" : "dark"] =
        value;
    }
    const lastAccent = (mode: "dark" | "light") => accents[mode];
    const panel = readFileSync(
      join(ROOT, "panels", "SettingsPanel.tsx"),
      "utf8",
    );
    const shown = (mode: string) =>
      new RegExp(`${mode}:\\s*"([^"]+)"`).exec(
        panel.slice(panel.indexOf("BUILT_IN_ACCENT:")),
      )?.[1];
    expect(lastAccent("dark")).toBeTruthy();
    expect(lastAccent("light")).toBeTruthy();
    expect(shown("dark")).toBe(lastAccent("dark"));
    expect(shown("light")).toBe(lastAccent("light"));
  });

  it("draws every ramp from its own colours rather than from a token", () => {
    // The scales beside the map are gradients written out by hand to match
    // the numbers under them. A `var()` in one of these would mean a theme
    // could restyle a reflectivity scale, which is the thing this whole
    // separation exists to stop.
    const css = readFileSync(join(ROOT, "index.css"), "utf8");
    const rules = [...css.matchAll(/([^{}]*legend-ramp[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(3);
    for (const rule of rules) {
      const selector = rule[1].trim().split("\n").pop()?.trim() ?? "";
      expect(rule[2], selector).not.toContain("var(");
    }
  });

  it("outranks both built-in looks and loses to more contrast", () => {
    // Three tiers, and a theme has to sit in the middle one. `:root` alone
    // loses to `:root[data-theme="light"]`, which meant a theme applied in
    // dark and did nothing whatever in light. One more `:root` again is what
    // keeps the contrast block above it.
    const written = themeCss({
      name: "x",
      base: "dark",
      tokens: { Accent: "#ffffff" },
    });
    expect(written.startsWith(":root:root {")).toBe(true);

    const css = readFileSync(join(ROOT, "index.css"), "utf8");
    const at = css.indexOf("@media (prefers-contrast: more)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, at + 900);
    expect(block).toContain(":root:root:root {");
    expect(block).toContain(':root:root:root[data-theme="light"] {');

    // And the base looks are the tier below, or the doubling above would be
    // pointless. Both are written once each with a plain selector.
    expect(css).toContain("\n:root {");
    expect(css).toContain('\n:root[data-theme="light"] {');
  });

  it("cannot grow a token out of the name it was given", () => {
    // The name is the one field written back into the file text as it stands,
    // and the file is read a line at a time, so a name with a line break in
    // it used to write a directive the stored theme never carried.
    const forged = normalizeSettings({
      schemaVersion: 3,
      workspaceTheme: {
        name: "a\nSurface: #ff0000",
        base: "dark",
        tokens: { Accent: "#00ff00" },
      },
    } as unknown as Record<string, unknown>);
    expect(forged.workspaceTheme?.tokens).toEqual({ Accent: "#00ff00" });
    expect(forged.workspaceTheme?.name).toBe("a Surface: #ff0000");
    // And it cannot rename itself either.
    const renamed = normalizeSettings({
      schemaVersion: 3,
      workspaceTheme: {
        name: "a\nName: b",
        base: "dark",
        tokens: { Accent: "#00ff00" },
      },
    } as unknown as Record<string, unknown>);
    expect(renamed.workspaceTheme?.name).not.toBe("b");
  });

  it("carries the base the file was drawn against", () => {
    const read = parseTheme(SAMPLE.replace("Base: dark", "Base: light"), "x");
    expect(read?.theme.base).toBe("light");
    // Round-trips, because the import path takes the workspace to it.
    expect(parseTheme(themeText(read!.theme), "x")?.theme.base).toBe("light");
  });
});

describe("reading a theme file", () => {
  it("rebuilds a colour rather than passing its text through", () => {
    expect(parseThemeColor("#ABC")).toBe("#aabbcc");
    expect(parseThemeColor("rgb(12, 34, 56)")).toBe("#0c2238");
    expect(parseThemeColor("rgba(12, 34, 56, 0.5)")).toBe(
      "rgba(12, 34, 56, 0.5)",
    );
    expect(parseThemeColor("#11223344")).toBe("rgba(17, 34, 51, 0.267)");
    // Out of range is clamped rather than refused, the way a colour table
    // already clamps a channel somebody typed as 300.
    expect(parseThemeColor("rgb(300, -20, 56)")).toBe("#ff0038");
  });

  it("refuses anything that could carry more than a colour", () => {
    for (const attempt of [
      "#fff; } :root { --danger: red",
      "var(--danger)",
      "url(http://example.com/x.png)",
      "red",
      "rgb(12 34 56) !important",
      "",
    ]) {
      expect(parseThemeColor(attempt), attempt).toBeNull();
    }
    expect(parseThemeShadow("0 1px 2px #000; }")).toBeNull();
    expect(parseThemeShadow("inset 0 1px 2px #000")).toBeNull();
    expect(parseThemeShadow("0 1px 2px 3px 4px #000")).toBeNull();
    expect(parseThemeShadow("0 18px 45px rgba(0, 0, 0, 0.4)")).toBe(
      "0px 18px 45px rgba(0, 0, 0, 0.4)",
    );
    expect(parseThemeWeight("700")).toBe("700");
    for (const attempt of ["70", "1000", "bold", "700; color: red"]) {
      expect(parseThemeWeight(attempt), attempt).toBeNull();
    }
  });

  it("keeps what it understood and says what it did not", () => {
    const read = parseTheme(
      `${SAMPLE}Border: not a colour\nSparkle: yes\n`,
      "harbour.txt",
    );
    expect(read?.theme.name).toBe("Harbour");
    expect(read?.theme.base).toBe("dark");
    expect(read?.theme.tokens.Border).toBeUndefined();
    expect(read?.skipped).toEqual(["Border", "Sparkle"]);
  });

  it("is not a theme with nothing this build understands", () => {
    expect(
      parseTheme("OpenRadar theme\nName: Empty\nSparkle: yes\n", "x"),
    ).toBe(null);
    expect(looksLikeTheme("harbour.txt", SAMPLE)).toBe(true);
    expect(looksLikeTheme("shapes.geojson", SAMPLE)).toBe(false);
    expect(looksLikeTheme("table.pal", SAMPLE)).toBe(false);
    expect(
      looksLikeTheme("harbour.txt", "Product: BR\nColor: 5 4 233 231"),
    ).toBe(false);
  });

  it("round-trips through its own file text", () => {
    const read = parseTheme(SAMPLE, "harbour.txt");
    const again = parseTheme(themeText(read!.theme), "harbour.txt");
    expect(again?.theme).toEqual(read?.theme);
  });
});

describe("a personal accent", () => {
  it("is a theme carrying three tokens and no more", () => {
    const theme = themeFromAccent("#ff8a3d", "dark", "Accent");
    expect(theme?.tokens).toEqual({
      Accent: "#ff8a3d",
      AccentStrong: "#ff8a3d",
      AccentSoft: "rgba(255, 138, 61, 0.16)",
    });
    expect(themeFromAccent("nope", "dark")).toBeNull();
  });
});

describe("a theme held in the settings file", () => {
  it("is read back out of its own text, not trusted as an object", () => {
    // A hand-edited settings.json is the way in that does not go through the
    // import path, so it gets the same parser.
    const stored = normalizeSettings({
      ...DEFAULT_SETTINGS,
      workspaceTheme: {
        name: "Edited",
        base: "dark",
        tokens: {
          Accent: "#ff0000",
          Border: "#fff; } :root { --danger: lime",
          Sparkle: "#00ff00",
        },
      },
    } as unknown as Record<string, unknown>);
    // Sparkle is not a token, so it is gone. Border was a colour with a
    // stylesheet's worth of text after it, and what survives the parser is
    // the colour: the semicolon starts a comment in this format the way it
    // does in a .pal file, so nothing after it reaches a rule.
    expect(stored.workspaceTheme?.tokens).toEqual({
      Accent: "#ff0000",
      Border: "#ffffff",
    });
    expect(themeCss(stored.workspaceTheme!)).not.toContain("danger");
  });

  it("is nothing at all in a file that has never carried one", () => {
    const stored = normalizeSettings({ schemaVersion: 3 });
    expect(stored.workspaceTheme).toBeNull();
  });
});

describe("putting a theme on the page", () => {
  it("goes on and comes off in one action", () => {
    const theme = themeFromAccent("#ff8a3d", "dark");
    applyTheme(theme);
    const element = document.getElementById(THEME_STYLE_ID);
    expect(element?.textContent).toContain("--accent: #ff8a3d;");
    applyTheme(null);
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull();
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(ROOT, "index.css"), "utf8");

  it("defines every custom property it reads", () => {
    // Two shipped without being defined anywhere, both with a fallback that
    // hid it. `--surface-sunken` left three chrome surfaces as a fixed dark
    // box inside a white panel, with the text in them at 2.87:1, and
    // `--warning` left the line that says a model run is out of date at
    // 1.67:1. A fallback is not a definition: it is the value nobody chose,
    // rendered for every reader.
    const used = new Set(
      [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]),
    );
    const defined = new Set(
      [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  /**
   * The selectors that draw a reading rather than the workspace around it.
   *
   * A theme reaches the eleven chrome tokens and nothing else, and the source
   * scan above holds that for TypeScript. It cannot see the stylesheet, which
   * is where this went wrong: `--surface-sunken` was added to the token list
   * as chrome, and it backs the office's own severity word on every alert
   * row. A theme setting it to the text colour painted "Extreme" at 1:1, in
   * both looks, with axe reporting nothing because the two colours matched.
   */
  const READINGS = [
    ".alert-severity",
    ".alert-row i",
    ".alert-tag",
    ".legend-ramp",
    ".alert-advice",
  ];

  it("keeps every theme token out of the ink and ground of a reading", () => {
    // Only `color` and `background`, which is the whole claim: a theme may
    // tint the border around a badge, and it may not touch what the badge
    // says or the ground it says it on. A border is chrome; the word is the
    // office's reading of how bad this is.
    const properties = THEME_TOKENS.map((token) => token.property);
    const offenders: string[] = [];
    for (const rule of css.split("}")) {
      const [selector, body] = rule.split("{");
      if (!body) continue;
      if (!READINGS.some((name) => selector.includes(name))) continue;
      for (const line of body.split(";")) {
        const [property, value] = line.split(":");
        if (!value) continue;
        if (!/^\s*(color|background(-color)?)\s*$/.test(property)) continue;
        for (const token of properties) {
          // On a word boundary, or `--surface` matches `--surface-sunken`.
          if (new RegExp(`${token}(?![a-z-])`).test(value)) {
            offenders.push(`${selector.trim()}: ${property.trim()} ${token}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /** Every property set inside the blocks matching a selector. */
  function setIn(selector: string): Set<string> {
    const found = new Set<string>();
    // At the start of a line, so `:root {` does not also match the doubled
    // `:root:root:root {` the prefers-contrast block uses. Matched loosely it
    // swept those in and this said less than it looked like it said.
    const opens = `\n${selector}`;
    let at = css.indexOf(opens);
    expect(at, `${selector} is gone`).toBeGreaterThan(-1);
    while (at > -1) {
      const body = css.slice(at, css.indexOf("\n}", at));
      for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
        found.add(match[1]);
      }
      at = css.indexOf(opens, at + opens.length);
    }
    return found;
  }

  it("writes each colour down once per theme", () => {
    // The palette existed twice, at the top of the file and again two
    // thousand lines further down, with different numbers in each: nineteen
    // colours where `--surface-hover` was #202837 in one and #18232f in the
    // other. The later pair is what shipped, so anybody editing the first one
    // changed nothing on screen and every contrast figure had to be read off
    // the second.
    for (const selector of [":root {", ':root[data-theme="light"] {']) {
      const seen = new Map<string, string[]>();
      // From the start of a line, or from the start of the file: the block
      // that was deleted lived at byte 0, which is exactly where a
      // reintroduced one would go.
      let at = css.startsWith(selector) ? 0 : css.indexOf(`\n${selector}`);
      expect(at, `${selector} is gone`).toBeGreaterThan(-1);
      while (at > -1) {
        const body = css.slice(at, css.indexOf("\n}", at));
        for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:([^;]*);/g)) {
          seen.set(match[1], [...(seen.get(match[1]) ?? []), match[2]]);
        }
        at = css.indexOf(`\n${selector}`, at + selector.length);
      }
      const twice = [...seen]
        // One exception, and only one: a pair where the second declaration
        // is a relative colour, which an engine that does not understand it
        // drops, leaving the plain colour above it. That is a fallback, not
        // a second opinion.
        .filter(
          ([, values]) =>
            values.length > 2 ||
            (values.length === 2 && !values[1].includes("from var(")),
        )
        .map(([name]) => name);
      expect(twice, selector).toEqual([]);
    }
  });

  it("draws a slider handle big enough to grab", () => {
    // WCAG 2.5.8 asks twenty-four pixels of a pointer target. The scrubber
    // under the map is the most dragged control in the app and its handle was
    // whatever the browser drew, about sixteen; so was every slider in
    // Settings and Layers. Held here rather than in the browser suite because
    // Chromium will not report a form control's internal pseudo element
    // through `getComputedStyle`: it answers with the input's own values, so
    // an assertion there passed at any size.
    for (const thumb of ["-webkit-slider-thumb", "-moz-range-thumb"]) {
      const at = css.indexOf(`::${thumb} {`);
      expect(at, `${thumb} is not drawn`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf("\n}", at));
      for (const side of ["width", "height"]) {
        const size = new RegExp(`${side}:\\s*(\\d+)px`).exec(body)?.[1];
        expect(Number(size), `${thumb} ${side}`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("still paints the part of a slider behind the handle", () => {
    // Drawing the handle cost this: a browser paints the passed part of the
    // track in the accent colour on its own, and stops the moment the thumb
    // is styled, so all twelve sliders became a uniform grey line with a dot
    // on it. Chromium has no pseudo element for the filled part, so the share
    // arrives as `--range-fill` and the track is a gradient. Held on the
    // source for the same reason the handle size is.
    const at = css.indexOf("::-webkit-slider-runnable-track {");
    expect(at, "the track is not drawn").toBeGreaterThan(-1);
    const track = css.slice(at, css.indexOf("\n}", at));
    expect(track).toContain("var(--range-fill");
    expect(track).toContain("var(--accent-fill)");

    // Gecko has one, and it is the whole fix there.
    const gecko = css.indexOf("::-moz-range-progress {");
    expect(gecko, "the Gecko fill is not drawn").toBeGreaterThan(-1);
    expect(css.slice(gecko, css.indexOf("\n}", gecko))).toContain(
      "var(--accent-fill)",
    );

    // And every slider hands the share over. A slider without it paints an
    // empty track whatever its value, which is the regression this is about.
    const sliders = readdirSync(ROOT, { recursive: true })
      .map((name) => String(name))
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .map((name) => join(ROOT, name))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return source
          .split("<input")
          .slice(1)
          .filter((tag) =>
            tag.slice(0, tag.indexOf("/>")).includes('type="range"'),
          )
          .map((tag) => [path, tag.slice(0, tag.indexOf("/>"))] as const);
      });
    expect(sliders.length).toBeGreaterThan(0);
    for (const [path, tag] of sliders) {
      expect(tag, path).toContain("style={rangeFill(");
    }
  });

  it("gives the dark theme a value for everything the light theme sets", () => {
    // A guard rather than a regression test: this was already true when it
    // was written, and it is here so that it stays true. The light block is
    // an override of the base one, so a colour that exists only there has no
    // value at all in the dark theme, which is the shipped default, and
    // whatever reads it falls back to whatever it inherits.
    const base = setIn(":root {");
    const light = setIn(':root[data-theme="light"] {');
    expect(light.size).toBeGreaterThan(10);
    expect([...light].filter((name) => !base.has(name))).toEqual([]);
  });
});

describe("the second monitor's readout", () => {
  const css = readFileSync(join(ROOT, "index.css"), "utf8");

  /** One rule's declarations, from its selector to the closing brace. */
  function ruleFor(selector: string): string {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    const from = css.indexOf("{", at);
    return css.slice(from, css.indexOf("\n}", from));
  }

  it("keeps its drift and its fade on the base rule", () => {
    // The light-basemap override was written into the middle of the base
    // rule, which closed it early: every dark basemap lost the easing on the
    // drift and the fade, and the override then outranked the reduced-motion
    // block, so a reader who asked for less motion still got the fade.
    expect(ruleFor(".ambient-readout")).toContain("transition:");
    expect(ruleFor(".ambient-readout[data-over-light]")).not.toContain(
      "transition:",
    );
  });

  it("lets the reduced-motion block win", () => {
    // Specificity, not order: `[data-over-light]` is one class heavier than
    // the plain selector the media block uses, so anything it declares that
    // the block also declares cannot be turned off by asking for less
    // motion.
    const over = ruleFor(".ambient-readout[data-over-light]");
    for (const property of ["transition", "transform", "animation"]) {
      expect(over, property).not.toContain(`${property}:`);
    }
  });
});

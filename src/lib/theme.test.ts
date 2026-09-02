import { readFileSync } from "node:fs";
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
    // The modules that decide what a number looks like. None of them reads a
    // custom property, so nothing a theme can write is on the path between a
    // reflectivity value and the colour drawn for it. A ramp moved onto a
    // token would fail here rather than being noticed on a storm day.
    const properties = THEME_TOKENS.map((token) => token.property);
    const offenders: string[] = [];
    for (const file of [
      "lib/legend.ts",
      "lib/mosaicLegend.ts",
      "lib/alertTypes.ts",
      "lib/cells.ts",
      "lib/classification.ts",
      "lib/palette.ts",
      "lib/surge.ts",
      "lib/mapStyles.ts",
      "lib/mapLayers/radar.ts",
      "lib/mapLayers/vector.ts",
      "lib/mapLayers/raster.ts",
      "lib/mapLayers/image.ts",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const property of properties) {
        if (source.includes(property)) offenders.push(`${file}: ${property}`);
      }
    }
    expect(offenders).toEqual([]);
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

  it("lets more contrast outrank a theme", () => {
    // A theme is a plain `:root` rule, so the contrast block has to be
    // doubled or a reader who asked the system for more contrast would lose
    // it to a colour somebody picked.
    const css = readFileSync(join(ROOT, "index.css"), "utf8");
    const at = css.indexOf("@media (prefers-contrast: more)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, at + 900);
    expect(block).toContain(":root:root {");
    expect(block).toContain(':root:root[data-theme="light"] {');
    expect(
      themeCss({ name: "x", base: "dark", tokens: { Accent: "#fff" } }),
    ).toContain(":root {");
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

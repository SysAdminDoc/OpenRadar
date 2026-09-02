/**
 * The look of the workspace, separated from the look of the data.
 *
 * The two are not the same thing and must not be allowed to become the same
 * thing. A reflectivity ramp, a warning outline, a hazard colour and a track
 * swatch are readings: change one and the map says something it was not told.
 * The surface a panel is drawn on, the line around it, the accent on a heading
 * and the shadow under a card are none of anybody's business but the reader's.
 *
 * So a theme can set the tokens in `THEME_TOKENS` and nothing else. That is
 * not a convention, it is the whole mechanism: nothing here can write a
 * property that is not on the list, the values are rebuilt from what the
 * parser understood rather than passed through as text, and a test in
 * `theme.test.ts` fails if a token the data drawing reads ever appears here.
 *
 * The file format is plain text with one directive per line, the same shape a
 * `.pal` colour table already uses:
 *
 *   OpenRadar theme
 *   Name: Harbour
 *   Base: dark
 *   Accent: #7cc4ff
 *   Surface: rgba(14, 20, 30, 0.94)
 *   Shadow: 0 18px 45px rgba(0, 0, 0, 0.4)
 *   HeadingWeight: 700
 */
import type { ThemeMode } from "./settings";

export type ThemeTokenKind = "color" | "shadow" | "weight";

export interface ThemeToken {
  /** The word a theme file writes before the colon. */
  directive: string;
  /** The custom property it sets, which is the only thing it can reach. */
  property: string;
  kind: ThemeTokenKind;
}

/**
 * Every token a theme is allowed to set.
 *
 * Adding one is a decision about whether the thing it colours is chrome or
 * data, so the list is pinned by a test rather than left to grow.
 */
export const THEME_TOKENS: ThemeToken[] = [
  { directive: "Surface", property: "--surface", kind: "color" },
  { directive: "SurfaceSolid", property: "--surface-solid", kind: "color" },
  { directive: "SurfaceRaised", property: "--surface-raised", kind: "color" },
  { directive: "SurfaceHover", property: "--surface-hover", kind: "color" },
  { directive: "Border", property: "--border", kind: "color" },
  { directive: "BorderStrong", property: "--border-strong", kind: "color" },
  { directive: "Accent", property: "--accent", kind: "color" },
  { directive: "AccentStrong", property: "--accent-strong", kind: "color" },
  { directive: "AccentSoft", property: "--accent-soft", kind: "color" },
  { directive: "Shadow", property: "--shadow", kind: "shadow" },
  { directive: "HeadingWeight", property: "--heading-weight", kind: "weight" },
];

const BY_DIRECTIVE = new Map(
  THEME_TOKENS.map((token) => [token.directive.toLowerCase(), token]),
);

export interface WorkspaceTheme {
  name: string;
  /** Which built-in the theme sits on, since it only overrides some tokens. */
  base: ThemeMode;
  /** Directive name to the value the parser rebuilt, never the raw text. */
  tokens: Record<string, string>;
}

/** The longest a name may be, so a hand-edited file cannot fill the panel. */
const MAX_NAME = 60;

/**
 * A name as one line of ordinary text.
 *
 * The name is the one field written back into the file text verbatim, and the
 * file is read a line at a time, so a name carrying a newline is a name that
 * can write a directive the stored theme never had. A hand-edited
 * `settings.json` whose name held a line break followed by `Surface: #ff0000`
 * grew a Surface token out of nothing before this. Everything that is not
 * printable text goes.
 */
function cleanName(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

/**
 * A colour, rebuilt from its own numbers.
 *
 * Only two notations are read, and neither is echoed back as it arrived. This
 * is what keeps a theme file from carrying anything else into a stylesheet:
 * whatever the text said, what comes out of here is `#rrggbb` or
 * `rgba(r, g, b, a)` built out of six integers and a fraction.
 */
export function parseThemeColor(text: string): string | null {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) {
      return `#${[...digits].map((one) => one + one).join("")}`.toLowerCase();
    }
    if (digits.length === 6) return `#${digits.toLowerCase()}`;
    const alpha = Number.parseInt(digits.slice(6), 16) / 255;
    const [red, green, blue] = [0, 2, 4].map((at) =>
      Number.parseInt(digits.slice(at, at + 2), 16),
    );
    return `rgba(${red}, ${green}, ${blue}, ${clampAlpha(alpha)})`;
  }
  const functional =
    /^rgba?\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)$/i.exec(
      value,
    );
  if (!functional) return null;
  const numbers = functional.slice(1, 4).map(Number);
  if (numbers.some((one) => !Number.isFinite(one))) return null;
  const [red, green, blue] = numbers.map(clampChannel);
  if (functional[4] === undefined) {
    return `#${[red, green, blue]
      .map((one) => one.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  const alpha = Number(functional[4]);
  if (!Number.isFinite(alpha)) return null;
  return `rgba(${red}, ${green}, ${blue}, ${clampAlpha(alpha)})`;
}

/**
 * A drop shadow, rebuilt from its own numbers.
 *
 * Two or three lengths in pixels and one colour, which covers every shadow the
 * workspace draws. Anything else is refused rather than trimmed, because a
 * shadow is the one token whose value is more than a single word and so the
 * one with room to hide something.
 */
export function parseThemeShadow(text: string): string | null {
  const value = text.trim();
  const split = /^([^#r]*)((?:#|rgba?\().*)$/i.exec(value);
  if (!split) return null;
  const lengths = split[1].trim().split(/\s+/).filter(Boolean);
  if (lengths.length < 2 || lengths.length > 4) return null;
  const written: string[] = [];
  for (const length of lengths) {
    // A bare zero needs no unit and is how every shadow in the stylesheet is
    // written, so refusing it would refuse the app's own values.
    const measure = /^(-?\d{1,3}(?:\.\d{1,2})?)(px)?$/.exec(length);
    if (!measure || (!measure[2] && Number(measure[1]) !== 0)) return null;
    written.push(`${Number(measure[1])}px`);
  }
  const color = parseThemeColor(split[2]);
  if (!color) return null;
  return `${written.join(" ")} ${color}`;
}

/** A font weight, held to the range a variable font actually answers to. */
export function parseThemeWeight(text: string): string | null {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 100 || value > 900) return null;
  return String(value);
}

function parseValue(kind: ThemeTokenKind, text: string): string | null {
  if (kind === "color") return parseThemeColor(text);
  if (kind === "shadow") return parseThemeShadow(text);
  return parseThemeWeight(text);
}

/** Whether a dropped file reads like a theme rather than an overlay. */
export function looksLikeTheme(name: string, text: string): boolean {
  if (/\.(json|geojson|pal)$/i.test(name)) return false;
  return /^\s*openradar theme\s*$/im.test(text);
}

/**
 * Read a theme out of its own text.
 *
 * Every directive that is not on the list is collected in `skipped` rather
 * than being an error, so a file written for a later build still applies what
 * this one understands and the panel can say what it left out. A file with no
 * token this build knows is not a theme.
 */
export function parseTheme(
  text: string,
  fallbackName: string,
): { theme: WorkspaceTheme; skipped: string[] } | null {
  const tokens: Record<string, string> = {};
  const skipped: string[] = [];
  let name = "";
  let base: ThemeMode = "dark";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.split(";")[0].trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(":");
    if (at < 0) continue;
    const key = trimmed.slice(0, at).trim().toLowerCase();
    const rest = trimmed.slice(at + 1).trim();
    if (key === "name") {
      name = cleanName(rest);
      continue;
    }
    if (key === "base") {
      base = rest.toLowerCase() === "light" ? "light" : "dark";
      continue;
    }
    const token = BY_DIRECTIVE.get(key);
    if (!token) {
      if (!skipped.includes(trimmed.slice(0, at).trim())) {
        skipped.push(trimmed.slice(0, at).trim());
      }
      continue;
    }
    const value = parseValue(token.kind, rest);
    if (value === null) {
      if (!skipped.includes(token.directive)) skipped.push(token.directive);
      continue;
    }
    tokens[token.directive] = value;
  }
  if (!Object.keys(tokens).length) return null;
  return {
    theme: { name: name || cleanName(fallbackName), base, tokens },
    skipped,
  };
}

/** The theme written back out as the file it came from. */
export function themeText(theme: WorkspaceTheme): string {
  const lines = [
    "OpenRadar theme",
    `Name: ${cleanName(theme.name)}`,
    `Base: ${theme.base}`,
  ];
  for (const token of THEME_TOKENS) {
    const value = theme.tokens[token.directive];
    if (typeof value === "string" && value) {
      lines.push(`${token.directive}: ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A theme carrying nothing but the reader's own colour.
 *
 * Somebody who wants the app in their own colour should not have to write a
 * file, and an accent is the one token that does that on its own: the strong
 * variant is the same colour and the soft one is it at the opacity the
 * built-ins already use for a selected row.
 */
export function themeFromAccent(
  color: string,
  base: ThemeMode,
  name = "Accent",
): WorkspaceTheme | null {
  const accent = parseThemeColor(color);
  if (!accent || !accent.startsWith("#")) return null;
  const [red, green, blue] = [1, 3, 5].map((at) =>
    Number.parseInt(accent.slice(at, at + 2), 16),
  );
  return {
    name,
    base,
    tokens: {
      Accent: accent,
      AccentStrong: accent,
      AccentSoft: `rgba(${red}, ${green}, ${blue}, 0.16)`,
    },
  };
}

/** The accent a theme carries, for a colour control to show. */
export function themeAccent(theme: WorkspaceTheme | null): string | null {
  const accent = theme?.tokens.Accent;
  return typeof accent === "string" && accent.startsWith("#") ? accent : null;
}

/** The id of the element the theme is written into. */
export const THEME_STYLE_ID = "workspace-theme";

/**
 * Put a theme on the page, or take the last one off.
 *
 * A stylesheet rule rather than inline properties on the root element,
 * because `@media (prefers-contrast: more)` has to be able to win: it sets its
 * own borders and surfaces from a doubled `:root:root` selector, which
 * outranks the plain `:root` written here whatever order they land in. A
 * reader who has asked Windows for more contrast gets it, theme or no theme.
 */
export function applyTheme(theme: WorkspaceTheme | null): void {
  const head = document.head;
  if (!head) return;
  let element = document.getElementById(
    THEME_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!theme) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("style");
    element.id = THEME_STYLE_ID;
    head.append(element);
  }
  element.textContent = themeCss(theme);
}

/** The rule a theme becomes, built only out of what the parser understood. */
export function themeCss(theme: WorkspaceTheme): string {
  const declarations: string[] = [];
  for (const token of THEME_TOKENS) {
    const value = theme.tokens[token.directive];
    if (typeof value !== "string" || !value) continue;
    // Rebuilt again on the way out. The parser is the only thing that has
    // ever written into `tokens`, and this is still cheaper than trusting it.
    const safe = parseValue(token.kind, value);
    if (safe === null) continue;
    declarations.push(`  ${token.property}: ${safe};`);
  }
  if (!declarations.length) return "";
  // Doubled: see `applyTheme`. One `:root` loses to the light look, and a
  // theme that silently does nothing for half the readers who set one is
  // worse than no theming at all.
  return `:root:root {\n${declarations.join("\n")}\n}\n`;
}

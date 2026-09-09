/**
 * Drawing a reference line over a basemap nobody chose for it.
 *
 * County lines follow the theme's own line token, which is the right colour
 * for the app's panels and says nothing about the map underneath: the basemap
 * is picked separately, and asking the system for more contrast switches the
 * palette without switching the basemap. A near-white line at full opacity
 * over the light basemap composites to about one to one, so the reader turns
 * the accessibility preference ON and the lines disappear.
 *
 * The cartographic answer is a casing: a wider stroke of the opposite
 * lightness underneath, so the line reads on any ground. This works out which
 * way round that is.
 */

/** A colour as the browser resolves it, or null when it is not one. */
export function parseColor(
  value: string,
): { red: number; green: number; blue: number } | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((one) => one + one)
            .join("")
        : hex[1];
    return {
      red: parseInt(digits.slice(0, 2), 16),
      green: parseInt(digits.slice(2, 4), 16),
      blue: parseInt(digits.slice(4, 6), 16),
    };
  }
  // `getComputedStyle` hands back `rgb(...)` or `rgba(...)` for anything a
  // stylesheet resolved, which is what the theme tokens come back as.
  const parts = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (!parts) return null;
  const numbers = parts[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (
    numbers.length < 3 ||
    numbers.slice(0, 3).some((one) => !Number.isFinite(one))
  ) {
    return null;
  }
  const [red, green, blue] = numbers;
  return { red, green, blue };
}

/** How light a colour is, nought to one, on the sRGB curve. */
export function lightness(value: string): number | null {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const channel = (raw: number) => {
    const held = Math.min(1, Math.max(0, raw / 255));
    return held <= 0.03928 ? held / 12.92 : ((held + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parsed.red) +
    0.7152 * channel(parsed.green) +
    0.0722 * channel(parsed.blue)
  );
}

/**
 * The stroke that goes under a line of this colour so it reads on any ground.
 *
 * Dark under a light line and light under a dark one. A colour that cannot be
 * read at all gets the dark casing, which is the safer guess: every basemap
 * the app offers is lighter than black and most are much lighter.
 */
export function casingFor(line: string): string {
  const level = lightness(line);
  return level !== null && level < 0.5
    ? "rgba(255, 255, 255, 0.75)"
    : "rgba(9, 12, 18, 0.75)";
}

/**
 * The marks drawn straight onto the basemap, in the two lightnesses.
 *
 * A casing is the answer for a line long enough to carry one. These are not
 * that: a storm's dashed track, its forecast dots, the ring round the cell,
 * a tropical fix with no colour of its own and the point a placefile drops
 * are all small marks, and a second stroke under a three pixel dot is a
 * bigger dot. So each is given the lightness the ground is not, the same way
 * the county lines choose theirs.
 *
 * Each of these shipped as one near-white apiece, chosen against the dark
 * basemap. Over Roads, Daylight or the light workspace they composited to
 * about one to one, and the cell ring is the mark that says which storm to
 * look at first.
 */
export const MAP_INK = {
  /** A storm cell: its ring, its track and its forecast positions. */
  cell: { light: "#0f172a", dark: "#f8fafc" },
  /** The same, for a cell the algorithm found rotation in. */
  rotation: { light: "#b91c1c", dark: "#f87171" },
  /** A tropical track whose fix carries no colour of its own. */
  track: { light: "#334155", dark: "#e2e8f0" },
  /** The ring round a point a placefile drops. */
  placefilePoint: { light: "#1e293b", dark: "#eff6ff" },
  /** The line and the ends of a measurement the reader is drawing. */
  tool: { light: "#0369a1", dark: "#7dd3fc" },
} as const;

/** What goes behind a cell's name, which is the opposite of its ink. */
export const MAP_INK_HALO = {
  light: "rgba(248, 250, 252, 0.9)",
  dark: "rgba(9, 11, 16, 0.85)",
} as const;

/** The ink for a mark over the basemap that is on screen now. */
export function inkFor(role: keyof typeof MAP_INK, overLight: boolean): string {
  return MAP_INK[role][overLight ? "light" : "dark"];
}

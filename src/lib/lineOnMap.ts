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

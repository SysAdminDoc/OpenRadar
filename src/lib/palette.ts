/**
 * GRLevelX `.pal` colour tables.
 *
 * A palette is how radar people compare the same storm across tools: everyone
 * loads the same file and the same dBZ comes out the same colour. It could not
 * be applied while every pixel arrived as a picture NOAA had already coloured;
 * the locally decoded products give it raw values to act on.
 *
 * The format is plain text, one directive per line:
 *
 *   Product: BR
 *   Units:   dBZ
 *   Step:    5
 *   Color:   5 4 233 231
 *   Color:   50 253 0 0 212 0 0
 *   SolidColor: 75 253 253 253
 *   RF:      119 0 125
 */

export interface PaletteStop {
  value: number;
  color: string;
  /** True for a `SolidColor:` line, which holds its colour to the next stop. */
  solid?: boolean;
  /**
   * The second colour on a `Color:` line, which the file blends towards up to
   * the next stop. A `SolidColor:` line has none.
   */
  toColor: string | null;
}

export interface Palette {
  name: string;
  product: string | null;
  units: string | null;
  step: number | null;
  stops: PaletteStop[];
  /** The range-folded colour, which is not a value on the scale. */
  rangeFolded: string | null;
  /** Directives that were read but do nothing here, so the panel can say so. */
  skipped: string[];
}

/** The most stops a file may define, which is far more than any real one has. */
const MAX_STOPS = 512;

function channel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((part) => channel(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Splits a directive line into its keyword and the numbers after it. */
function directive(line: string): { key: string; rest: string } | null {
  const trimmed = line.split(";")[0].trim();
  if (!trimmed) return null;
  const at = trimmed.indexOf(":");
  if (at < 0) return null;
  return {
    key: trimmed.slice(0, at).trim().toLowerCase(),
    rest: trimmed.slice(at + 1).trim(),
  };
}

function numbers(rest: string): number[] {
  return rest
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

/**
 * Reads a palette. A file with no usable colours is not a palette, so this
 * returns null rather than an empty one the map would draw as nothing.
 */
export function parsePalette(text: string, name: string): Palette | null {
  const palette: Palette = {
    name,
    product: null,
    units: null,
    step: null,
    stops: [],
    rangeFolded: null,
    skipped: [],
  };
  const skipped = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const read = directive(line);
    if (!read) continue;
    const { key, rest } = read;

    if (key === "product") {
      palette.product = rest || null;
      // Read and reported, but which product a table applies to is decided by
      // its units rather than by this name.
      skipped.add(key);
      continue;
    }
    if (key === "units") {
      palette.units = rest || null;
      continue;
    }
    if (key === "step") {
      const [step] = numbers(rest);
      palette.step = Number.isFinite(step) ? step : null;
      // Read, but nothing here draws in steps: the ramp is continuous.
      skipped.add(key);
      continue;
    }
    if (key === "rf") {
      const [red, green, blue] = numbers(rest);
      if ([red, green, blue].every(Number.isFinite)) {
        palette.rangeFolded = hex(red, green, blue);
      }
      continue;
    }
    if (key === "color" || key === "solidcolor" || key === "color4") {
      if (palette.stops.length >= MAX_STOPS) continue;
      const parts = numbers(rest);
      // Value, then a colour, and optionally a second colour to blend towards.
      // Color4 carries an alpha after each colour, which is dropped: the layer
      // has its own opacity and a palette fighting it helps nobody.
      const width = key === "color4" ? 4 : 3;
      if (parts.length < 1 + width) continue;
      const [value] = parts;
      const first = parts.slice(1, 4);
      const second = parts.slice(1 + width, 1 + width + 3);
      palette.stops.push({
        value,
        color: hex(first[0], first[1], first[2]),
        solid: key === "solidcolor",
        toColor:
          key !== "solidcolor" && second.length === 3
            ? hex(second[0], second[1], second[2])
            : null,
      });
      continue;
    }
    skipped.add(read.key);
  }

  if (!palette.stops.length) return null;
  // A palette is read low to high whatever order the file lists it in.
  palette.stops.sort((left, right) => left.value - right.value);
  palette.skipped = [...skipped].sort();
  return palette;
}

/**
 * The colour a value gets. Between two stops it blends, which is what the
 * second colour on a `Color:` line is for; a solid stop holds its colour until
 * the next one.
 */
export function paletteColor(palette: Palette, value: number): string {
  const { stops } = palette;
  if (!stops.length) return "#000000";
  if (value <= stops[0].value) return stops[0].color;

  for (let at = 0; at < stops.length - 1; at += 1) {
    const low = stops[at];
    const high = stops[at + 1];
    // Half open: a value sitting exactly on the next stop belongs to that
    // stop, not to the end of the blend running into it.
    if (value >= high.value) continue;
    // A SolidColor line holds its colour to the next stop. A Color line with
    // one colour does not: it ramps into the next stop, which is what the
    // format says and what every other reader does.
    if (low.solid) return low.color;
    const span = high.value - low.value;
    const position = span > 0 ? (value - low.value) / span : 0;
    return blend(low.color, low.toColor ?? high.color, position);
  }

  const last = stops[stops.length - 1];
  return last.toColor ?? last.color;
}

function blend(from: string, to: string, position: number): string {
  const one = parseHex(from);
  const two = parseHex(to);
  const held = Math.max(0, Math.min(1, position));
  return hex(
    one[0] + (two[0] - one[0]) * held,
    one[1] + (two[1] - one[1]) * held,
    one[2] + (two[2] - one[2]) * held,
  );
}

function parseHex(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

/** The value range a palette covers, which is what its legend is drawn over. */
export function paletteRange(palette: Palette): { min: number; max: number } {
  return {
    min: palette.stops[0].value,
    max: palette.stops[palette.stops.length - 1].value,
  };
}

/**
 * What the native renderers need: the stops as plain pairs, in order. Sent
 * with every request rather than held, so a palette can be changed without
 * anything on the native side going stale.
 */
export function paletteForRenderer(
  palette: Palette,
): Array<[number, string, string | null, boolean]> {
  // Whether a stop is solid travels with it. Without it the native side
  // cannot tell a SolidColor line from a Color line with one colour, and the
  // two are drawn differently.
  return palette.stops.map((stop) => [
    stop.value,
    stop.color,
    stop.toColor,
    Boolean(stop.solid),
  ]);
}

/** The products a palette can be applied to, by what it says it is for. */
export function paletteApplies(palette: Palette, unit: string): boolean {
  // A table that does not say what it is for is a reflectivity table, which is
  // what the format is for. The native side makes the same call, and the two
  // have to agree or the legend describes something the map is not drawing.
  if (!palette.units) return unit.trim().toLowerCase() === "dbz";
  return palette.units.trim().toLowerCase() === unit.trim().toLowerCase();
}

/**
 * Whether a file is a colour table rather than an overlay. The extension is
 * the honest signal; the content check is for a file saved under another name.
 */
export function looksLikePalette(name: string, text: string): boolean {
  if (/\.pal$/i.test(name)) return true;
  const head = text.slice(0, 4000);
  return (
    /^\s*(solid)?color4?\s*:/im.test(head) &&
    /^\s*(product|units|step)\s*:/im.test(head)
  );
}

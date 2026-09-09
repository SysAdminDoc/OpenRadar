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

import type { AppSettings } from "./settings/types";
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
    if (
      key === "color" ||
      key === "solidcolor" ||
      key === "color4" ||
      key === "solidcolor4"
    ) {
      if (palette.stops.length >= MAX_STOPS) continue;
      const parts = numbers(rest);
      // Value, then a colour, and optionally a second colour to blend towards.
      // The four-channel spellings carry an alpha after each colour, which is
      // dropped: the layer has its own opacity and a palette fighting it helps
      // nobody. Dropping it is only invisible while the table stays here, so
      // the alpha is named in `skipped`: saving the table back out is where
      // the loss would otherwise leave with the file and turn up in somebody
      // else's tool as an opaque band.
      const wide = key === "color4" || key === "solidcolor4";
      const width = wide ? 4 : 3;
      if (parts.length < 1 + width) continue;
      if (wide) skipped.add("color4 alpha");
      // `SolidColor4` used to reach none of this and fell through to the
      // skipped list, which dropped the stop itself: a band missing from the
      // ramp on the map, not only from the file.
      const solid = key === "solidcolor" || key === "solidcolor4";
      const [value] = parts;
      const first = parts.slice(1, 4);
      const second = parts.slice(1 + width, 1 + width + 3);
      palette.stops.push({
        value,
        color: hex(first[0], first[1], first[2]),
        solid,
        toColor:
          !solid && second.length === 3
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

/**
 * How many tables the library holds.
 *
 * A number rather than no limit, because the whole set is written into the
 * settings file and into every workspace backup, and a reader who imports a
 * hub's worth of community tables should hit a stated ceiling rather than a
 * settings file that has quietly become a megabyte.
 */
export const MAX_PALETTES = 12;

/**
 * The unit a table is for, as the assignment map keys it.
 *
 * A file that does not say is a reflectivity table, which is what the format
 * was written for. `paletteApplies` makes the same call, and the native side
 * makes it a third time; all three have to agree or the legend describes
 * something the map is not drawing.
 */
export function paletteUnit(palette: Palette): string {
  return palette.units?.trim() || "dBZ";
}

/** The table assigned to a product measured in this unit, if there is one. */
export function assignedPalette(
  palettes: Palette[],
  assignments: Record<string, string>,
  unit: string,
): Palette | null {
  const wanted = assignments[unit.trim().toLowerCase()];
  if (!wanted) return null;
  return (
    palettes.find(
      (palette) => palette.name === wanted && paletteApplies(palette, unit),
    ) ?? null
  );
}

/**
 * Every table actually in force, at most one per unit.
 *
 * This is what the renderer is given. The library is the reader's shelf and
 * this is what they took off it, so importing a table changes nothing on the
 * map until it is assigned.
 */
export function activePalettes(
  palettes: Palette[],
  assignments: Record<string, string>,
): Palette[] {
  const seen = new Set<string>();
  const active: Palette[] = [];
  for (const [unit, name] of Object.entries(assignments)) {
    if (seen.has(unit)) continue;
    const found = palettes.find(
      (palette) => palette.name === name && paletteApplies(palette, unit),
    );
    if (!found) continue;
    seen.add(unit);
    active.push(found);
  }
  return active;
}

/** A `#rrggbb` back to the three numbers a `.pal` line carries. */
function channels(color: string): string {
  const parsed = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!parsed) return "0 0 0";
  return [parsed[1], parsed[2], parsed[3]]
    .map((part) => String(parseInt(part, 16)))
    .join(" ");
}

/**
 * A table back out as a `.pal` file, so one tuned here can be shared.
 *
 * Colour tables are the currency of this hobby: most of what people publish
 * for GRLevelX is a palette, and a table adjusted in this app used to live and
 * die inside its settings file. What comes out is what GRLevel3 reads.
 *
 * It writes what the parser understood and nothing else. A directive this app
 * skips is recorded by name only, its values never kept, so it cannot be put
 * back; the file that comes out is the table as this app is actually drawing
 * it, which is the honest thing for it to be. The panel already names the
 * skipped directives where the table is listed.
 */
export function writePalette(palette: Palette): string {
  const lines: string[] = [];
  if (palette.product) lines.push(`Product: ${palette.product}`);
  if (palette.units) lines.push(`Units: ${palette.units}`);
  if (palette.step !== null) lines.push(`Step: ${palette.step}`);
  for (const stop of palette.stops) {
    const head = `${stop.value} ${channels(stop.color)}`;
    lines.push(
      stop.solid
        ? `SolidColor: ${head}`
        : `Color: ${head}${stop.toColor ? ` ${channels(stop.toColor)}` : ""}`,
    );
  }
  if (palette.rangeFolded) lines.push(`RF: ${channels(palette.rangeFolded)}`);
  return `${lines.join("\n")}\n`;
}

/*
 * Reading a colour table, a library of them and their assignments out of
 * a settings file.
 *
 * Beside the parser rather than in the store, because what makes a stored
 * table legitimate is that this module would have produced it: a
 * hand-edited `settings.json` must not put a colour on screen that no
 * file could.
 */

/**
 * The library, read back from a settings file.
 *
 * A build before this one held one table under `palette`, so that becomes a
 * library of one rather than being dropped: the reader loaded it, and an
 * upgrade is not a reason to throw somebody's colour scale away.
 */
/**
 * The library with one more table on it, in force for what it is for.
 *
 * Null when the shelf is full and this is a table that is not already on it,
 * because silently dropping one of the reader's own tables to make room is
 * worse than saying the shelf is full.
 *
 * A table imported under a name already there replaces that one in place. It
 * keeps its position and keeps whatever it was assigned to, since re-importing
 * an edited file is an update to what the reader arranged rather than a new
 * thing to arrange.
 */
export function withPalette(
  settings: AppSettings,
  palette: Palette,
): AppSettings | null {
  const at = settings.palettes.findIndex((held) => held.name === palette.name);
  if (at < 0 && settings.palettes.length >= MAX_PALETTES) return null;
  const palettes =
    at < 0
      ? [...settings.palettes, palette]
      : settings.palettes.map((held, index) => (index === at ? palette : held));
  return {
    ...settings,
    palettes,
    paletteAssignments: {
      ...settings.paletteAssignments,
      [paletteUnit(palette).toLowerCase()]: palette.name,
    },
  };
}

/** The library without a table, and without any assignment that named it. */
export function withoutPalette(
  settings: AppSettings,
  name: string,
): AppSettings {
  const paletteAssignments = Object.fromEntries(
    Object.entries(settings.paletteAssignments).filter(
      ([, assigned]) => assigned !== name,
    ),
  );
  return {
    ...settings,
    palettes: settings.palettes.filter((held) => held.name !== name),
    paletteAssignments,
  };
}

/** One unit's table put in force, or taken out of force when name is null. */
export function withPaletteAssigned(
  settings: AppSettings,
  unit: string,
  name: string | null,
): AppSettings {
  const key = unit.trim().toLowerCase();
  const paletteAssignments = { ...settings.paletteAssignments };
  if (name) {
    paletteAssignments[key] = name;
  } else {
    delete paletteAssignments[key];
  }
  return { ...settings, paletteAssignments };
}

export function normalizePalettes(raw: Record<string, unknown>): Palette[] {
  const source = Array.isArray(raw.palettes)
    ? raw.palettes
    : raw.palette
      ? [raw.palette]
      : [];
  const read: Palette[] = [];
  for (const entry of source) {
    const palette = normalizePalette(entry);
    if (!palette) continue;
    // One name, one table. A second import under a name already on the shelf
    // replaced the first at import time, so two here is a hand-edited file.
    if (read.some((held) => held.name === palette.name)) continue;
    read.push(palette);
    if (read.length === MAX_PALETTES) break;
  }
  return read;
}

/**
 * Which table is in force per unit, dropped to the ones that could be true.
 *
 * The names are not checked against the library here. A name for a table that
 * is not on the shelf simply does not resolve, and keeping it means removing a
 * table and importing it again restores the assignment it had.
 */
export function normalizePaletteAssignments(
  raw: Record<string, unknown>,
): Record<string, string> {
  const stored = raw.paletteAssignments;
  const assignments: Record<string, string> = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [unit, name] of Object.entries(
      stored as Record<string, unknown>,
    )) {
      if (typeof name !== "string" || !name) continue;
      assignments[unit.trim().toLowerCase()] = name.slice(0, 60);
    }
  } else if (!Array.isArray(raw.palettes) && raw.palette) {
    // The single table an older build held was always in force, so the
    // upgrade keeps it in force rather than leaving the map suddenly plain.
    const only = normalizePalette(raw.palette);
    if (only) {
      assignments[paletteUnit(only).toLowerCase()] = only.name;
    }
  }
  return assignments;
}

/**
 * A stored colour table, re-read from its own text rather than trusted.
 *
 * Written back out with `writePalette` and parsed again, so a hand-edited
 * settings file cannot put anything on the map the parser would not have
 * produced. This used to carry its own copy of what `writePalette` does, and
 * the copy asked about a stop's second colour before its solid flag where the
 * original asks about solid first: one format written in two files, differing
 * in the order they ask, which nothing would have caught until a palette
 * arrived with both set.
 *
 * The sanitising stays, because `writePalette` takes a palette and this takes
 * whatever was in the file: a stop with no number, or a colour that is not
 * one, is dropped before the writer sees it. The writer's own fallback for a
 * bad colour is black, and a black stop nobody chose is worse than a missing
 * one.
 */
export function normalizePalette(value: unknown): Palette | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Palette>;
  if (!Array.isArray(raw.stops) || !raw.stops.length) return null;
  const colour = (from: unknown): string | null =>
    typeof from === "string" && /^#[0-9a-fA-F]{6}$/.test(from) ? from : null;
  const stops = raw.stops.flatMap((stop) => {
    const at = Number(stop?.value);
    const color = colour(stop?.color);
    if (!Number.isFinite(at) || !color) return [];
    return [
      {
        value: at,
        color,
        toColor: colour(stop?.toColor ?? null),
        solid: Boolean(stop?.solid),
      },
    ];
  });
  if (!stops.length) return null;
  const name = typeof raw.name === "string" ? raw.name.slice(0, 60) : "palette";
  // Anything truthy, written as text, rather than strings only. These two
  // arrive from a stored `settings.json` that a reader or an older build may
  // have written, so `units: 5` and `units: ["dBZ"]` both turn up, and it is
  // the units that decide which readings a table colours. Refusing a non-string
  // silently drops that decision and the table quietly starts colouring
  // something else, or nothing. Written out, a nonsense one is at least
  // visible: the parser puts `product` in the skipped list, and the units go
  // on screen beside the table's name.
  const said = (value: unknown): string | null =>
    value ? String(value) : null;
  return parsePalette(
    writePalette({
      name,
      product: said(raw.product),
      units: said(raw.units),
      step: Number.isFinite(raw.step) ? Number(raw.step) : null,
      stops,
      rangeFolded: colour(raw.rangeFolded ?? null),
      skipped: [],
    }),
    name,
  );
}

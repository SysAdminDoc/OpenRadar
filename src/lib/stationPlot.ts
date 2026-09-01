/**
 * The station model, drawn as images the map can place.
 *
 * A surface observation is conventionally drawn as a plot rather than a dot:
 * a circle whose fill says how much sky is covered, and a staff pointing the
 * way the wind is coming from with feathers counting its speed. Everybody who
 * reads weather maps reads this, and drawing it any other way would make the
 * layer a novelty rather than the thing people already know.
 *
 * The pixels are written by hand into an RGBA buffer rather than through a
 * canvas, because a canvas is a browser and this is arithmetic: the shapes
 * are straight lines and a disc, the rules for where the feathers go are the
 * WMO's, and both are worth holding with tests that do not need a window.
 */

/** How many device pixels one plot pixel is drawn at. */
export const PLOT_SCALE = 2;

/** The box each icon is drawn in, in plot pixels before the scale. */
export const PLOT_SIZE = 44;

export interface PlotImage {
  id: string;
  width: number;
  height: number;
  /** RGBA, row-major, `width * height * 4` bytes. */
  data: Uint8Array;
}

interface Ink {
  data: Uint8Array;
  width: number;
  height: number;
}

function blank(width: number, height: number): Ink {
  return { data: new Uint8Array(width * height * 4), width, height };
}

function put(ink: Ink, x: number, y: number, alpha: number) {
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || row < 0 || column >= ink.width || row >= ink.height) return;
  const at = (row * ink.width + column) * 4;
  const held = ink.data[at + 3];
  const next = Math.max(held, Math.round(Math.min(1, alpha) * 255));
  // White, so the map can recolour it. MapLibre tints an icon only when it is
  // an SDF, and an SDF cannot carry the fill fractions a sky disc needs, so
  // the plot is drawn in one colour and the contrast comes from the halo.
  ink.data[at] = 255;
  ink.data[at + 1] = 255;
  ink.data[at + 2] = 255;
  ink.data[at + 3] = next;
}

/** A straight line, thick enough to survive being scaled down on a map. */
function line(
  ink: Ink,
  from: [number, number],
  to: [number, number],
  weight: number,
) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(x2 - x1, y2 - y1) * PLOT_SCALE * 2),
  );
  const half = (weight * PLOT_SCALE) / 2;
  for (let step = 0; step <= steps; step += 1) {
    const at = step / steps;
    const x = (x1 + (x2 - x1) * at) * PLOT_SCALE;
    const y = (y1 + (y2 - y1) * at) * PLOT_SCALE;
    for (let dx = -half; dx <= half; dx += 0.5) {
      for (let dy = -half; dy <= half; dy += 0.5) {
        if (Math.hypot(dx, dy) > half) continue;
        put(ink, x + dx, y + dy, 1);
      }
    }
  }
}

/** A filled triangle, for a pennant. */
function triangle(
  ink: Ink,
  a: [number, number],
  b: [number, number],
  c: [number, number],
) {
  const xs = [a[0], b[0], c[0]];
  const ys = [a[1], b[1], c[1]];
  const area = (p: number[], q: number[], r: number[]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
  const whole = area(a, b, c);
  if (whole === 0) return;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.4) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.4) {
      const point = [x, y];
      const one = area(a, b, point) / whole;
      const two = area(b, c, point) / whole;
      const three = area(c, a, point) / whole;
      if (one < 0 || two < 0 || three < 0) continue;
      put(ink, x * PLOT_SCALE, y * PLOT_SCALE, 1);
    }
  }
}

/** A ring, and optionally the part of its inside that is covered. */
function disc(ink: Ink, cx: number, cy: number, radius: number, fill: number) {
  for (let angle = 0; angle < 360; angle += 0.5) {
    const radians = (angle * Math.PI) / 180;
    line(
      ink,
      [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius],
      [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius],
      1,
    );
  }
  if (fill <= 0) return;
  // The conventional fills are a right half, three quarters and the whole
  // disc; a quarter is drawn as a wedge from the top. Anything in between is
  // not a thing the coverage codes can say.
  for (let x = -radius; x <= radius; x += 0.4) {
    for (let y = -radius; y <= radius; y += 0.4) {
      if (Math.hypot(x, y) > radius) continue;
      let inside: boolean;
      if (fill >= 1) inside = true;
      else if (fill >= 0.75) inside = !(x < 0 && y > 0);
      else if (fill >= 0.5) inside = x >= 0;
      else inside = x >= 0 && y <= 0;
      if (inside) put(ink, (cx + x) * PLOT_SCALE, (cy + y) * PLOT_SCALE, 1);
    }
  }
}

/** How much of the disc each METAR coverage code fills. */
export const SKY_FILL: Record<string, number> = {
  CLR: 0,
  SKC: 0,
  CAVOK: 0,
  NCD: 0,
  FEW: 0.25,
  SCT: 0.5,
  BKN: 0.75,
  OVC: 1,
  OVX: 1,
};

/**
 * The feathers a speed is drawn with, worst first.
 *
 * Rounded to the nearest five knots the way the convention is drawn, so a
 * plot always reads as a whole number of feathers rather than as a length
 * somebody has to estimate. Calm has no staff at all.
 */
export function barbParts(knots: number): {
  pennants: number;
  full: number;
  half: number;
} {
  const rounded = Math.round(Math.max(0, knots) / 5) * 5;
  let left = rounded;
  const pennants = Math.floor(left / 50);
  left -= pennants * 50;
  const full = Math.floor(left / 10);
  left -= full * 10;
  return { pennants, full, half: left >= 5 ? 1 : 0 };
}

/** The icon name for a speed, so the map can look one up per station. */
export function barbId(knots: number): string {
  const rounded = Math.round(Math.max(0, knots) / 5) * 5;
  return `station-barb-${Math.min(rounded, BARB_MAX_KNOTS)}`;
}

/** Past this the plot is drawn as the fastest barb rather than growing. */
export const BARB_MAX_KNOTS = 100;

/**
 * One wind barb, pointing straight up.
 *
 * The map rotates it to the direction the wind comes from, which is what
 * `wdir` reports and what the convention draws: the staff points into the
 * wind, so a north wind has its feathers at the top of the plot.
 */
export function barbImage(knots: number): PlotImage {
  const size = PLOT_SIZE * PLOT_SCALE;
  const ink = blank(size, size);
  const middle = PLOT_SIZE / 2;
  const { pennants, full, half } = barbParts(knots);

  if (pennants + full + half === 0) {
    // Calm: the convention is a second ring around the sky disc and no staff.
    disc(ink, middle, middle, 8, 0);
    return { id: barbId(knots), width: size, height: size, data: ink.data };
  }

  // The staff runs from the edge of the sky disc to the top of the box.
  const foot = middle - 5;
  const head = 3;
  line(ink, [middle, foot], [middle, head], 1.2);

  let at = head;
  const step = 3.4;
  const span = 8;
  for (let count = 0; count < pennants; count += 1) {
    triangle(ink, [middle, at], [middle, at + step * 1.4], [middle + span, at]);
    at += step * 1.7;
  }
  for (let count = 0; count < full; count += 1) {
    line(ink, [middle, at], [middle + span, at - step * 0.6], 1.2);
    at += step;
  }
  if (half) {
    // A half feather sits inboard of the tip, never at it, so a lone five
    // knots cannot be mistaken for a full barb drawn short.
    if (at === head) at += step;
    line(ink, [middle, at], [middle + span / 2, at - step * 0.3], 1.2);
  }
  return { id: barbId(knots), width: size, height: size, data: ink.data };
}

/** One sky-cover disc. */
export function skyImage(cover: string): PlotImage {
  const size = PLOT_SIZE * PLOT_SCALE;
  const ink = blank(size, size);
  const middle = PLOT_SIZE / 2;
  disc(ink, middle, middle, 5, SKY_FILL[cover] ?? 0);
  return {
    id: `station-sky-${cover}`,
    width: size,
    height: size,
    data: ink.data,
  };
}

/**
 * Every image the layer needs, built once.
 *
 * A fixed set rather than one per station: there are twenty-one speeds a barb
 * can be drawn at and nine coverage codes, so the map holds thirty images
 * however many stations are on screen.
 */
let built: PlotImage[] | null = null;

export function stationPlotImages(): PlotImage[] {
  // Built once. These are drawn pixel by pixel, which costs about four
  // milliseconds and a megabyte of buffers, and the map asks for the set
  // whenever it republishes its layer stack: on every sweep of a radar loop,
  // for every reader, whether or not the layer has ever been switched on.
  if (built) return built;
  const images: PlotImage[] = [];
  for (let knots = 0; knots <= BARB_MAX_KNOTS; knots += 5) {
    images.push(barbImage(knots));
  }
  for (const cover of Object.keys(SKY_FILL)) images.push(skyImage(cover));
  built = images;
  return built;
}

import {
  dewpointFromMixingRatio,
  dryAdiabat,
  moistAdiabat,
  potentialTemperature,
  celsiusToKelvin,
  type SoundingLevel,
} from "./thermo";

/**
 * The geometry of a Skew-T log-P chart.
 *
 * Pressure runs down the page on a logarithmic scale, and the isotherms are
 * skewed to the right as they rise so that the temperature and dewpoint
 * traces of an ordinary atmosphere separate instead of lying on top of each
 * other. The skew is what makes the chart readable and it is the only reason
 * it is not simply a graph.
 *
 * All of it is arithmetic on a unit square, so the component above can draw
 * at whatever size it is given and a test can hold the geometry to what it
 * claims without a canvas.
 */

export interface ChartBox {
  width: number;
  height: number;
  /** Pressure at the bottom and the top of the drawn area, in hectopascals. */
  bottom: number;
  top: number;
  /** Temperature at the bottom left and bottom right, in degrees Celsius. */
  left: number;
  right: number;
  /**
   * How far right a line is pushed per decade of pressure, as a fraction of
   * the chart's width. Zero would be an ordinary graph.
   */
  skew: number;
}

export const DEFAULT_BOX: ChartBox = {
  width: 1,
  height: 1,
  bottom: 1050,
  top: 100,
  left: -40,
  right: 50,
  skew: 0.9,
};

/** Where a pressure sits down the page, from 0 at the top to 1 at the bottom. */
export function pressureFraction(box: ChartBox, pressure: number): number {
  const span = Math.log(box.bottom) - Math.log(box.top);
  return (Math.log(box.bottom) - Math.log(pressure)) / span;
}

/** A point on the chart, in the box's own units. */
export function plot(
  box: ChartBox,
  temperature: number,
  pressure: number,
): { x: number; y: number } {
  const up = pressureFraction(box, pressure);
  const y = box.height * (1 - up);
  const across = (temperature - box.left) / (box.right - box.left);
  // The skew: every step up the page moves an isotherm to the right, which
  // is what turns a near-vertical temperature trace into a readable one.
  const x = box.width * (across + box.skew * up * (1 / 1));
  return { x, y };
}

/** One trace, as points in the box's units. */
export function traceOf(
  box: ChartBox,
  levels: SoundingLevel[],
  read: (level: SoundingLevel) => number,
): Array<{ x: number; y: number }> {
  return levels
    .filter(
      (level) =>
        level.pressure <= box.bottom &&
        level.pressure >= box.top &&
        Number.isFinite(read(level)),
    )
    .map((level) => plot(box, read(level), level.pressure));
}

/** The isotherms, every ten degrees across the chart and beyond it. */
export function isotherms(box: ChartBox): number[] {
  const out: number[] = [];
  // Wide enough that a skewed line still crosses the top of the chart.
  for (let t = box.left - 120; t <= box.right + 60; t += 10) out.push(t);
  return out;
}

/** The pressure lines a reader expects to see labelled. */
export const PRESSURE_LINES = [
  1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100,
];

/** A line down the chart, as the points to join. */
function curve(
  box: ChartBox,
  at: (pressure: number) => number,
  step = 25,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let p = box.bottom; p >= box.top; p -= step) {
    const t = at(p);
    if (!Number.isFinite(t)) continue;
    points.push(plot(box, t, p));
  }
  return points;
}

/** Dry adiabats, one per potential temperature, in the chart's own units. */
export function dryAdiabats(
  box: ChartBox,
  fromC = -30,
  toC = 160,
  stepC = 10,
): Array<Array<{ x: number; y: number }>> {
  const lines: Array<Array<{ x: number; y: number }>> = [];
  for (let t = fromC; t <= toC; t += stepC) {
    const theta = celsiusToKelvin(t);
    lines.push(curve(box, (p) => dryAdiabat(theta, p)));
  }
  return lines;
}

/**
 * Moist adiabats, one per starting temperature at the bottom of the chart.
 *
 * Each is integrated once at the chart's own step rather than per pixel: the
 * integration is the expensive part of this file and the answer does not
 * change while a reader looks at it.
 */
export function moistAdiabats(
  box: ChartBox,
  fromC = -20,
  toC = 40,
  stepC = 5,
): Array<Array<{ x: number; y: number }>> {
  const lines: Array<Array<{ x: number; y: number }>> = [];
  for (let t = fromC; t <= toC; t += stepC) {
    const points: Array<{ x: number; y: number }> = [];
    let temperature = t;
    let pressure = box.bottom;
    points.push(plot(box, temperature, pressure));
    while (pressure > box.top) {
      const next = Math.max(pressure - 25, box.top);
      temperature = moistAdiabat(temperature, pressure, next);
      pressure = next;
      points.push(plot(box, temperature, pressure));
    }
    lines.push(points);
  }
  return lines;
}

/** The mixing ratio lines, which is where the moisture is read off. */
export const MIXING_RATIOS = [0.4, 1, 2, 4, 7, 10, 16, 24, 32];

export function mixingRatioLines(
  box: ChartBox,
): Array<{ value: number; points: Array<{ x: number; y: number }> }> {
  return MIXING_RATIOS.map((value) => ({
    value,
    // Only over the part of the chart where they mean anything: above about
    // 400 hPa there is no moisture to speak of and the lines crowd the left.
    points: curve(box, (p) =>
      p < 400 ? Number.NaN : dewpointFromMixingRatio(value, p),
    ),
  }));
}

/** A path, for an SVG that wants one string. */
export function pathOf(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  return points
    .map(
      (point, at) =>
        `${at === 0 ? "M" : "L"}${point.x.toFixed(4)},${point.y.toFixed(4)}`,
    )
    .join(" ");
}

/** Potential temperature, re-exported so a caller drawing labels has it. */
export { potentialTemperature };

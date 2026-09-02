import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOX,
  MIXING_RATIOS,
  PRESSURE_LINES,
  dryAdiabats,
  isotherms,
  mixingRatioLines,
  moistAdiabats,
  pathOf,
  plot,
  pressureFraction,
  traceOf,
} from "./skewt";
import type { SoundingLevel } from "./thermo";

const BOX = { ...DEFAULT_BOX, width: 100, height: 100 };

function level(
  pressure: number,
  temperature: number,
  dewpoint: number,
): SoundingLevel {
  return {
    pressure,
    height: 0,
    temperature,
    dewpoint,
    windKnots: null,
    windFrom: null,
  };
}

describe("where a Skew-T puts things", () => {
  it("runs pressure down the page on a log scale", () => {
    // The bottom of the chart is the bottom of the page.
    expect(pressureFraction(BOX, BOX.bottom)).toBeCloseTo(0, 6);
    expect(pressureFraction(BOX, BOX.top)).toBeCloseTo(1, 6);
    // Logarithmic, not linear: the halfway point up the page is the
    // geometric mean of the two ends rather than the arithmetic one.
    const geometric = Math.sqrt(BOX.bottom * BOX.top);
    expect(pressureFraction(BOX, geometric)).toBeCloseTo(0.5, 6);
    // And halfway up the page in pressure terms is not halfway up in height:
    // the plain average of the two ends sits well below the middle, which is
    // what a log scale is for.
    const arithmetic = (BOX.bottom + BOX.top) / 2;
    expect(pressureFraction(BOX, arithmetic)).toBeLessThan(0.35);
  });

  it("skews the isotherms, which is the whole point of the chart", () => {
    // The same temperature, twice, at two heights. On an ordinary graph the
    // two would be at the same x; here the upper one is further right, which
    // is what separates a temperature trace from its dewpoint.
    const low = plot(BOX, 0, BOX.bottom);
    const high = plot(BOX, 0, BOX.top);
    expect(high.x).toBeGreaterThan(low.x + 50);
    expect(high.y).toBeLessThan(low.y);
    // And warmer is still to the right of colder at the same level.
    expect(plot(BOX, 10, 500).x).toBeGreaterThan(plot(BOX, 0, 500).x);
  });

  it("puts the bottom left corner where the box says", () => {
    const corner = plot(BOX, BOX.left, BOX.bottom);
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(BOX.height, 6);
  });
});

describe("the lines behind a sounding", () => {
  it("draws a dry adiabat that leans the way it should", () => {
    const [first] = dryAdiabats(BOX, 20, 20, 10);
    expect(first.length).toBeGreaterThan(10);
    // A dry adiabat cools upward faster than the skew pushes it right, so on
    // a Skew-T it leans back to the left as it climbs.
    const bottom = first[0];
    const top = first[first.length - 1];
    expect(top.y).toBeLessThan(bottom.y);
    expect(top.x).toBeLessThan(bottom.x);
  });

  it("draws a moist adiabat inside its dry one", () => {
    // Same starting point: the saturated parcel stays warmer, so its line is
    // to the right of the dry one all the way up.
    const [dry] = dryAdiabats(BOX, 20, 20, 10);
    const [moist] = moistAdiabats(BOX, 20, 20, 5);
    const dryTop = dry[dry.length - 1];
    const moistTop = moist[moist.length - 1];
    expect(moistTop.x).toBeGreaterThan(dryTop.x);
  });

  it("draws the mixing ratio lines only where moisture is worth reading", () => {
    const lines = mixingRatioLines(BOX);
    expect(lines).toHaveLength(MIXING_RATIOS.length);
    for (const line of lines) {
      expect(line.points.length).toBeGreaterThan(3);
      // Nothing above 400 hPa, where the values crowd into the left margin
      // and mean almost nothing.
      const highest = Math.min(...line.points.map((point) => point.y));
      expect(highest).toBeGreaterThan(0);
    }
    // A wetter line is to the right of a drier one.
    const dry = mixingRatioLines(BOX)[0].points[0];
    const wet = mixingRatioLines(BOX)[MIXING_RATIOS.length - 1].points[0];
    expect(wet.x).toBeGreaterThan(dry.x);
  });

  it("offers the isotherms and pressure lines a reader expects", () => {
    const lines = isotherms(BOX);
    expect(lines).toContain(0);
    expect(lines).toContain(-20);
    expect(lines).toContain(20);
    // Every ten degrees, and wide enough that a skewed line still crosses
    // the top of the chart.
    expect(Math.min(...lines)).toBeLessThan(BOX.left - 60);
    expect(PRESSURE_LINES).toContain(500);
    expect(PRESSURE_LINES).toContain(850);
  });
});

describe("a sounding on the chart", () => {
  const levels = [
    level(1000, 30, 22),
    level(850, 20, 17),
    level(700, 9, 2),
    level(500, -8, -20),
    level(300, -38, -50),
    // Above the chart's own top, so it should not be drawn.
    level(50, -60, -70),
  ];

  it("draws the levels inside the chart and none outside it", () => {
    const trace = traceOf(BOX, levels, (held) => held.temperature);
    expect(trace).toHaveLength(5);
    for (const point of trace) {
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(BOX.height);
    }
  });

  it("keeps the dewpoint left of the temperature", () => {
    const temperature = traceOf(BOX, levels, (held) => held.temperature);
    const dewpoint = traceOf(BOX, levels, (held) => held.dewpoint);
    for (let at = 0; at < dewpoint.length; at += 1) {
      expect(dewpoint[at].x).toBeLessThanOrEqual(temperature[at].x);
      // Same level, so the same height on the page.
      expect(dewpoint[at].y).toBeCloseTo(temperature[at].y, 6);
    }
  });

  it("writes a path an SVG can use, and nothing for nothing", () => {
    const path = pathOf(traceOf(BOX, levels, (held) => held.temperature));
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("L")).toHaveLength(5);
    expect(pathOf([])).toBe("");
  });
});

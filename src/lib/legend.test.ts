import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HIGH_CONTRAST_REFLECTIVITY_RAMP,
  HIGH_CONTRAST_VELOCITY_RAMP,
  HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
  legendScale,
  paletteLegend,
  rampGradient,
  stopPosition,
  type LegendScale,
} from "./legend";
import { parsePalette } from "./palette";
import { RAIN_RATE_RAMP, RAIN_RATE_STOPS } from "./providers/geomet";

const reflectivity: LegendScale = {
  min: 5,
  max: 75,
  stops: [5, 20, 35, 50, 65],
  unit: "dBZ",
  ramp: "legend-ramp",
};

const rainRate: LegendScale = {
  min: RAIN_RATE_RAMP[0][0],
  max: RAIN_RATE_RAMP[RAIN_RATE_RAMP.length - 1][0],
  stops: RAIN_RATE_STOPS,
  unit: "mm/h",
  ramp: "legend-ramp legend-ramp--rain-rate",
  logarithmic: true,
};

/**
 * The gradient in index.css is written out by hand from the same ramp, so
 * these are the positions the CSS stops have to carry. If this changes, the
 * `.legend-ramp--rain-rate` gradient has to change with it or the labels sit
 * where the colours are not.
 */
const CSS_STOPS: Array<[number, string]> = [
  [0.1, "0.0"],
  [1, "30.3"],
  [8, "57.7"],
  [24, "72.1"],
  [64, "85.0"],
  [200, "100.0"],
];

describe("placing a label on a legend", () => {
  it("spaces a linear scale evenly", () => {
    expect(stopPosition(reflectivity, 5)).toBe(0);
    expect(stopPosition(reflectivity, 75)).toBe(100);
    expect(stopPosition(reflectivity, 40)).toBeCloseTo(50, 5);
  });

  it("puts a rain rate where its decade is", () => {
    // A linear scale would put 1 mm/h half a percent along and every useful
    // value in the first tenth of the bar.
    expect(stopPosition(rainRate, 0.1)).toBe(0);
    expect(stopPosition(rainRate, 200)).toBe(100);
    expect(stopPosition(rainRate, 1)).toBeGreaterThan(25);
    // Each decade is the same width.
    const decade = stopPosition(rainRate, 10) - stopPosition(rainRate, 1);
    expect(
      stopPosition(rainRate, 100) - stopPosition(rainRate, 10),
    ).toBeCloseTo(decade, 5);
  });

  it("agrees with the gradient the stylesheet draws", () => {
    for (const [value, css] of CSS_STOPS) {
      expect(stopPosition(rainRate, value).toFixed(1)).toBe(css);
    }
  });
});

describe("a loaded table's legend", () => {
  it("draws the ramp the map is painted with", () => {
    const palette = parsePalette(
      [
        "Units: dBZ",
        "Color: 5 4 233 231 1 159 244",
        "SolidColor: 20 253 0 0",
        "Color: 50 253 253 253",
      ].join("\n"),
      "ramp.pal",
    )!;
    const legend = paletteLegend(palette, "dBZ");
    // Five to twenty blends to the line's own second colour, twenty to fifty
    // holds flat red, and the bar ends on the last stop's colour.
    expect(legend.gradient).toBe(
      "linear-gradient(90deg, #04e9e7 0%, #019ff4 33.33333333333333%, #fd0000 33.33333333333333%, " +
        "#fd0000 100%, #fdfdfd 100%)",
    );
    expect(legend.min).toBe(5);
    expect(legend.max).toBe(50);
    expect(legend.unit).toBe("dBZ");
  });

  it("labels the top of the scale even when the spacing skips it", () => {
    const values = [0, 10, 20, 30, 40, 50];
    const palette = parsePalette(
      values.map((value) => `Color: ${value} 255 0 0`).join("\n"),
      "six.pal",
    )!;
    const legend = paletteLegend(palette, "dBZ");
    expect(legend.stops.at(-1)).toBe(50);
    expect(legend.stops.length).toBeLessThanOrEqual(5);
  });

  it("survives a table with one colour in it", () => {
    const palette = parsePalette("Color: 30 255 0 0", "one.pal")!;
    const legend = paletteLegend(palette, "dBZ");
    // One colour is not a gradient, and a bar with a single stop draws nothing.
    expect(legend.gradient).toBe(
      "linear-gradient(90deg, #ff0000 0%, #ff0000 100%)",
    );
    expect(legend.max).toBeGreaterThan(legend.min);
    expect(stopPosition(legend, 30)).toBe(0);
  });
});

/**
 * The high-contrast bars are built from stops copied out of the Rust that
 * draws the picture. A copy drifts, so it is read back out of the source and
 * compared rather than trusted: a bar drawn from one ramp beside a map drawn
 * from another describes a picture nobody is looking at.
 */
function rustRamp(name: string): Array<[number, string]> {
  const source = readFileSync("src-tauri/src/level2.rs", "utf8");
  const start = source.indexOf(`const ${name}: &[(f32, [u8; 3])] = &[`);
  if (start < 0) throw new Error(`${name} is gone from level2.rs`);
  const end = source.indexOf("];", start);
  const body = source.slice(start, end);
  const stops: Array<[number, string]> = [];
  const line = /\(\s*(-?[\d.]+)\s*,\s*\[([^\]]+)\]\s*\)/g;
  let found = line.exec(body);
  while (found) {
    const channels = found[2]
      .split(",")
      .map((part) => Number(part.trim()))
      .map((value) => value.toString(16).padStart(2, "0"));
    stops.push([Number(found[1]), `#${channels.join("")}`]);
    found = line.exec(body);
  }
  return stops;
}

describe("the bars a reader who asked for more contrast reads", () => {
  it("is drawn from the ramps the native side paints with", () => {
    expect(HIGH_CONTRAST_REFLECTIVITY_RAMP).toEqual(
      rustRamp("HIGH_CONTRAST_REFLECTIVITY_RAMP"),
    );
    expect(HIGH_CONTRAST_VELOCITY_RAMP).toEqual(
      rustRamp("HIGH_CONTRAST_VELOCITY_RAMP"),
    );
    expect(HIGH_CONTRAST_WIDE_VELOCITY_RAMP).toEqual(
      rustRamp("HIGH_CONTRAST_WIDE_VELOCITY_RAMP"),
    );
  });

  it("replaces the ordinary bar for every locally drawn scale", () => {
    for (const id of ["reflectivity", "velocity", "velocity-wide"] as const) {
      const ordinary = legendScale(id);
      const contrast = legendScale(id, true);
      expect(contrast).not.toBe(ordinary);
      expect(contrast?.gradient).toBeTruthy();
      // Same ground, so asking for contrast never changes what is on the bar.
      expect(contrast?.min).toBe(ordinary?.min);
      expect(contrast?.max).toBe(ordinary?.max);
      expect(contrast?.unit).toBe(ordinary?.unit);
    }
  });

  it("leaves a bar it did not paint alone", () => {
    // Canada's and Germany's tiles arrive already coloured, so their bars are
    // the ones they were coloured with whatever the reader asked for.
    for (const id of ["rain-rate", "dwd-reflectivity"] as const) {
      expect(legendScale(id, true)).toBe(legendScale(id));
    }
    expect(legendScale("none", true)).toBeNull();
  });

  it("spaces a bar the way the values are spaced", () => {
    // Velocity is not evenly stepped: the stop either side of still air is
    // five metres a second and the next is twenty.
    const gradient = rampGradient(HIGH_CONTRAST_VELOCITY_RAMP);
    expect(gradient.startsWith("linear-gradient(90deg, #0078ba 0%")).toBe(true);
    expect(gradient).toContain("#e8e8e8 50%");
    expect(gradient.endsWith("#b34f1f 100%)")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { stopPosition, type LegendScale } from "./legend";
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

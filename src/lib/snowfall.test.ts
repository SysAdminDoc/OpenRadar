import { afterEach, describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { fr } from "../i18n/fr";
import {
  SNOWFALL_WINDOWS,
  formatSnowDepth,
  isSnowfallWindow,
  snowfallBandLabel,
  snowfallCorners,
  snowfallWindowKey,
  snowfallWindowName,
  type SnowfallAnalysis,
} from "./snowfall";
import { setUnits } from "./units";

/** An answer in the shape the native side sends one. */
function analysis(over: Partial<SnowfallAnalysis> = {}): SnowfallAnalysis {
  return {
    hours: 24,
    valid: "2026-09-09T12:00:00+00:00",
    west: -126,
    south: 21,
    east: -66,
    north: 55,
    image: "data:image/png;base64,",
    bands: [
      { inches: 0.1, color: "#dbeafe" },
      { inches: 1, color: "#93c5fd" },
      { inches: 48, color: "#fed7aa" },
    ],
    attribution: "NOAA National Operational Hydrologic Remote Sensing Center",
    attributionUrl: "https://www.nohrsc.noaa.gov/snowfall/",
    ...over,
  };
}

afterEach(() => setUnits("imperial"));

describe("how much snow landed", () => {
  it("takes only the three windows the office publishes", () => {
    for (const window of SNOWFALL_WINDOWS) {
      expect(isSnowfallWindow(window)).toBe(true);
    }
    // Anything else is refused here as well as natively, because this guard
    // is what a stored settings file is read through: a window is part of
    // the address the native side builds, and a name nobody vouched for is
    // the one thing that must not reach it.
    expect(isSnowfallWindow("6h")).toBe(false);
    expect(isSnowfallWindow("../../etc/passwd")).toBe(false);
    expect(isSnowfallWindow("")).toBe(false);
    expect(isSnowfallWindow(24)).toBe(false);
    expect(isSnowfallWindow(null)).toBe(false);
  });

  it("names every window in all three catalogues", () => {
    // The key is built from the window, so a fourth window added natively
    // without a line here would render as a raw key on the buttons.
    for (const window of SNOWFALL_WINDOWS) {
      const key = snowfallWindowKey(window);
      for (const [which, catalogue] of [
        ["en", en],
        ["es", es],
        ["fr", fr],
      ] as const) {
        expect(
          catalogue[key as keyof typeof catalogue],
          `${which} ${key}`,
        ).toBeTruthy();
      }
    }
  });

  it("pins the picture clockwise from the top left", () => {
    // MapLibre takes the four corners in that order and silently draws a
    // mirrored or upside-down picture if they arrive in any other, which on
    // a national grid puts every snowfall total in the wrong state.
    expect(snowfallCorners(analysis())).toEqual([
      [-126, 55],
      [-66, 55],
      [-66, 21],
      [-126, 21],
    ]);
  });

  it("says a depth in the units the reader is reading in", () => {
    setUnits("imperial");
    expect(formatSnowDepth(0.1)).toBe("0.1 in");
    expect(formatSnowDepth(48)).toBe("48 in");
    setUnits("metric");
    // A tenth of an inch is a quarter of a centimetre, and rounding it to a
    // whole one writes "0 cm" against the band that means a dusting.
    expect(formatSnowDepth(0.1)).toBe("0.3 cm");
    expect(formatSnowDepth(48)).toBe("122 cm");
  });

  it("reads each band as a range, and the last one as a floor", () => {
    const bands = analysis().bands;
    expect(snowfallBandLabel(bands, 0)).toBe("0.1 in to 1 in");
    // The top of the scale is where the scale stops, not where snow does.
    expect(snowfallBandLabel(bands, bands.length - 1)).toBe("48 in and more");
  });

  it("names a window from the hours a picture arrived carrying", () => {
    expect(snowfallWindowName(24)).toBe(en["snowfall.24h"]);
    expect(snowfallWindowName(72)).toBe(en["snowfall.72h"]);
    // A length nothing publishes still reads as a length rather than as a
    // missing catalogue key.
    expect(snowfallWindowName(6)).toBe("6 h");
  });
});

import { isDesktopRuntime } from "./runtime";
import { formatClock, isMetric } from "./units";
import {
  formatMeasure,
  formatNumber,
  translate,
  type StringKey,
} from "../i18n";

/**
 * How much snow actually landed, over the last day, two days or three.
 *
 * The precipitation type layer says what is falling right now. Nothing in the
 * app said how much of it had accumulated, which is the question anybody
 * looking at a winter map is really asking. This is the office's own national
 * analysis: gauge reports, radar and the model reconciled into one grid, the
 * number the Weather Service itself quotes. It is a floating point GeoTIFF
 * with no CORS headers on it, so it is fetched and coloured natively and
 * arrives here as a picture pinned to its own corners.
 *
 * A total is not a forecast and not an instrument reading. It is an analysis,
 * published twice a day, and the legend says when it was valid so a reader is
 * never guessing how old the number under their town is.
 */

export type SnowfallWindow = "24h" | "48h" | "72h";

/** Shortest first, which is the order the buttons are drawn in. */
export const SNOWFALL_WINDOWS: SnowfallWindow[] = ["24h", "48h", "72h"];

export function isSnowfallWindow(value: unknown): value is SnowfallWindow {
  return value === "24h" || value === "48h" || value === "72h";
}

/** One step of the key beside the map, at the depth where it begins. */
export interface SnowfallBand {
  inches: number;
  color: string;
}

export interface SnowfallAnalysis {
  /** The window the total covers, in hours. */
  hours: number;
  /** When the analysis was valid, which is what the legend names. */
  valid: string;
  west: number;
  south: number;
  east: number;
  north: number;
  /** A PNG data URL, clear where nothing fell and where nothing was analysed. */
  image: string;
  /** The scale it was painted with, sent with it so the legend cannot drift. */
  bands: SnowfallBand[];
  attribution: string;
  attributionUrl: string;
}

/**
 * How solid the picture is drawn.
 *
 * The painter already leaves a little of the ground showing through each
 * cell, so this stays near the top: two thinnings multiply, and a foot of
 * snow drawn at half strength over a dark basemap is unreadable.
 */
export const SNOWFALL_OPACITY = 0.85;

/** The grid is decoded natively, so a browser preview has none of it. */
export function snowfallAvailable(): boolean {
  return isDesktopRuntime();
}

/**
 * The catalogue line naming a window.
 *
 * Keyed on the window's own name, which is the name the file carries and the
 * one `SNOWFALL_WINDOWS` writes down, so the three lines cannot drift from
 * the three windows.
 */
export function snowfallWindowKey(window: SnowfallWindow): StringKey {
  return `snowfall.${window}` as StringKey;
}

/** The same, for a picture that arrived carrying its length in hours. */
export function snowfallWindowName(hours: number): string {
  const window = `${hours}h`;
  return isSnowfallWindow(window)
    ? translate(snowfallWindowKey(window))
    : `${formatNumber(hours)} h`;
}

export async function fetchSnowfall(
  window: SnowfallWindow,
  highContrast: boolean,
): Promise<SnowfallAnalysis> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SnowfallAnalysis>("snowfall_analysis", {
    window,
    highContrast,
  });
}

/** The picture's corners, clockwise from the top left, as the map takes them. */
export function snowfallCorners(
  analysis: SnowfallAnalysis,
): Array<[number, number]> {
  return [
    [analysis.west, analysis.north],
    [analysis.east, analysis.north],
    [analysis.east, analysis.south],
    [analysis.west, analysis.south],
  ];
}

/**
 * A depth of snow, in whatever the reader measures in.
 *
 * Snow is the one depth in this app read in centimetres rather than
 * millimetres or metres by everybody outside the United States, and the
 * numbers that matter run from a tenth of an inch to four feet. So a value
 * below ten keeps a decimal and one above it does not: "0,3 cm" is how a
 * person says a dusting and "0 cm" is not, while "121,9 cm" is a precision
 * an analysis of snow depth does not have.
 *
 * The rounded number is written out at its own precision rather than at a
 * fixed one, so a whole band boundary stays whole: the key reads "1 in to 3
 * in" rather than "1.0 in to 3.0 in".
 */
export function formatSnowDepth(inches: number): string {
  const metric = isMetric();
  const shown = metric ? inches * 2.54 : inches;
  const rounded = shown < 10 ? Math.round(shown * 10) / 10 : Math.round(shown);
  return `${formatMeasure(rounded)} ${metric ? "cm" : translate("units.inches")}`;
}

/**
 * When the analysis was valid, said with the day on it.
 *
 * The other legends in the workspace carry a time of day, because what they
 * are drawn from is minutes or hours old and the day is today. This one can
 * be three days back, and the office publishes at 00Z and 12Z: a 24-hour
 * total and a 72-hour total from the same run both read "8:00 AM" without
 * the date, so a reader switching between them saw the same words over two
 * different pictures.
 */
export function snowfallValidLabel(analysis: SnowfallAnalysis): string {
  const at = Date.parse(analysis.valid);
  if (!Number.isFinite(at)) return translate("wind.unknownHour");
  return formatClock(at, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** One line of the key: everything from this depth up to the next one. */
export function snowfallBandLabel(bands: SnowfallBand[], at: number): string {
  const band = bands[at];
  const next = bands[at + 1];
  return next
    ? translate("snowfall.band", {
        low: formatSnowDepth(band.inches),
        high: formatSnowDepth(next.inches),
      })
    : translate("snowfall.bandTop", { low: formatSnowDepth(band.inches) });
}

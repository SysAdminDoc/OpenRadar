import { isDesktopRuntime } from "./settings";
import { utcHourLabel } from "./units";
import { translate } from "../i18n";
import type { RadarFrame } from "./providers/types";

/**
 * Where the HRRR model expects smoke near the ground to go, an hour at a
 * time, for the forecast tail.
 *
 * The analysis layer says where smoke was seen today. This is a model's
 * expectation of the hours ahead, decoded natively off NOAA's bucket and
 * painted into a picture pinned to the model's own grid. It is drawn only on
 * a forecast frame, and the analysis is hidden while it is, so the two are
 * never on screen together: a reader looking at a plume must be able to say
 * which of the two kinds of statement it is.
 */

export interface SmokeRampStop {
  /** Micrograms a cubic metre, the bottom of the step. */
  at: number;
  color: string;
  /** How solid the step is painted, 0 to 255: faint smoke is drawn faint. */
  alpha: number;
}

export interface SmokeField {
  /** When the cycle started. */
  init: string;
  leadHours: number;
  /** The hour the field is for. */
  valid: string;
  west: number;
  south: number;
  east: number;
  north: number;
  columns: number;
  rows: number;
  /** The most smoke anywhere in the field. */
  maxUgm3: number;
  /** The scale the picture was painted with, sent with it so the legend cannot drift. */
  ramp: SmokeRampStop[];
  /** A PNG data URL, clear where the model says clear. */
  image: string;
}

export const FORECAST_SMOKE_UNIT = "µg/m³";

/**
 * How solid the picture is drawn on the map. The legend's swatches carry the
 * same figure, times each step's own alpha, so a colour a reader matches
 * against the scale is the colour that is on the map.
 */
export const FORECAST_SMOKE_OPACITY = 0.9;

/** What a step's swatch is drawn at, to match the picture. */
export function swatchOpacity(stop: SmokeRampStop): number {
  return (
    (Math.min(255, Math.max(0, stop.alpha)) / 255) * FORECAST_SMOKE_OPACITY
  );
}

/** The field is decoded natively, so a browser preview has none of it. */
export function forecastSmokeAvailable(): boolean {
  return isDesktopRuntime();
}

/** Whether two times name the same instant, however they are written. */
export function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && a === b;
}

/**
 * The hour of smoke that stands for a frame, or null for an observed one.
 *
 * The tail is drawn every quarter hour and the model publishes whole hours,
 * so a frame takes the nearest hour. Never the cycle's own hour: that is the
 * model's picture of the past, and the tail is about what comes next.
 */
export function forecastSmokeValid(
  frame: RadarFrame | undefined,
): string | null {
  if (!frame?.forecast) return null;
  const init = Date.parse(frame.forecast.initUtc);
  if (!Number.isFinite(init)) return null;
  const hours = Math.max(1, Math.round(frame.forecast.leadMinutes / 60));
  return new Date(init + hours * 3_600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

export async function fetchForecastSmoke(
  valid: string,
  preferredInit: string | null,
): Promise<SmokeField> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SmokeField>("hrrr_smoke", { valid, preferredInit });
}

/** The picture's corners, clockwise from the top left, as the map takes them. */
export function forecastSmokeCorners(
  field: SmokeField,
): Array<[number, number]> {
  return [
    [field.west, field.north],
    [field.east, field.north],
    [field.east, field.south],
    [field.west, field.south],
  ];
}

/** What the legend says: the cycle, its lead, and how old the cycle is. */
export function forecastSmokeLabel(field: SmokeField, nowMs: number): string {
  const init = Date.parse(field.init);
  const hour = Number.isFinite(init)
    ? utcHourLabel(init)
    : translate("wind.unknownHour");
  const age = Number.isFinite(init)
    ? Math.max(0, Math.floor((nowMs - init) / 3_600_000))
    : 0;
  return translate("forecastSmoke.label", {
    hour,
    lead: field.leadHours,
    age,
  });
}

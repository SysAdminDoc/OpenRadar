import { useSyncExternalStore } from "react";
import { formatMeasure, formatNumber, locale, translate } from "../i18n";

/**
 * Which units the workspace shows, and which clock it reads.
 *
 * The radar's own scales are not here. Reflectivity is in dBZ and velocity in
 * metres a second wherever you are, because that is what the products are, and
 * putting a hail size in millimetres does not make an inch of hail metric.
 * What changes is the weather a person reads: temperature, wind, rain,
 * distance, and the height of the tide.
 */
export type UnitSystem = "imperial" | "metric";
export type ClockZone = "local" | "utc";

/** How much larger than the design size the interface is drawn. */
export const TEXT_SCALES = [100, 115, 130] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

let units: UnitSystem = "imperial";
let zone: ClockZone = "local";

/**
 * Which choice is in force, as a value that changes when the choice does.
 *
 * This used to be plain module state on the reasoning that a settings change
 * unmounts whatever was showing a measurement. That is not true: the map and
 * the strip along the top of it are mounted for the life of the window, and
 * they went on showing miles after the switch to kilometres until something
 * else happened to redraw them.
 */
let generation = "imperial|local";
const listeners = new Set<() => void>();

function moved() {
  generation = `${units}|${zone}`;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Redraws a component when the units or the clock change.
 *
 * Anything that formats a measurement and stays on screen has to call this.
 * A panel that only opens after the change reads the new choice anyway.
 */
export function useMeasurements(): string {
  return useSyncExternalStore(
    subscribe,
    () => generation,
    () => generation,
  );
}

export function setUnits(next: UnitSystem) {
  if (units === next) return;
  units = next;
  moved();
}

export function setClockZone(next: ClockZone) {
  if (zone === next) return;
  zone = next;
  moved();
}

const MILES_TO_KM = 1.609344;
const FEET_TO_METRES = 0.3048;

/**
 * What to ask Open-Meteo for, so the numbers arrive in the units they will be
 * shown in rather than being converted twice.
 */
export function forecastUnits(): Record<string, string> {
  return units === "metric"
    ? {
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        precipitation_unit: "mm",
      }
    : {
        temperature_unit: "fahrenheit",
        wind_speed_unit: "mph",
        precipitation_unit: "inch",
      };
}

/**
 * A speed the reader can set, in the units they are reading in.
 *
 * The radar works in metres a second and the setting is stored that way, so
 * this is only for the box they type into.
 */
export function speedFromMetres(metresPerSecond: number): number {
  return units === "metric"
    ? metresPerSecond * 3.6
    : metresPerSecond * 2.2369363;
}

/** The same conversion back, for what they typed. */
export function speedToMetres(shown: number): number {
  return units === "metric" ? shown / 3.6 : shown / 2.2369363;
}

/**
 * A storm report as the spotter measured it, in the units of the reader.
 *
 * The feed names its own unit per report: hail in inches, wind in miles an
 * hour, snow in inches. Leaving those as they arrive puts an inch of hail in
 * front of somebody who set the workspace to metric.
 */
export function formatReportMagnitude(value: number, unit: string): string {
  const named = unit.trim().toUpperCase();
  if (units === "imperial") {
    return translate("reports.measured", {
      value: formatMeasure(value),
      unit: unit || "",
    }).trim();
  }
  if (named === "MPH" || named === "KTS" || named === "KNOTS") {
    const mph = named === "MPH" ? value : value * 1.15078;
    return translate("reports.measured", {
      value: formatNumber(Math.round(mph * 1.609344)),
      unit: "km/h",
    });
  }
  if (named === "INCH" || named === "IN" || named === "INCHES") {
    return translate("reports.measured", {
      value: formatNumber(value * 2.54, 1),
      unit: "cm",
    });
  }
  if (named === "F") {
    return translate("reports.measured", {
      value: formatNumber(((value - 32) * 5) / 9, 0),
      unit: "°C",
    });
  }
  return translate("reports.measured", {
    value: formatMeasure(value),
    unit: unit || "",
  }).trim();
}

/**
 * A temperature that arrived in Celsius, in the reader's own scale.
 *
 * Most of the app asks a service for the units it wants and never converts.
 * Surface observations are the exception: METAR is Celsius by the standard
 * that defines it, whoever is reading.
 */
export function temperatureFromCelsius(celsius: number): number {
  return units === "metric" ? celsius : celsius * 1.8 + 32;
}

/** The degree sign the reader is reading in. */
export function temperatureUnit(): string {
  return units === "metric" ? "°C" : "°F";
}

/** What a depth of rain arrives in, which is what it has to be labelled as. */
export function precipitationUnit(): string {
  return units === "metric" ? "mm" : "in";
}

export function speedUnit(): string {
  return units === "metric" ? "km/h" : "mph";
}

/** A distance the service gave in miles, in whichever units are asked for. */
export function formatDistance(miles: number): string {
  if (units === "metric") {
    const km = miles * MILES_TO_KM;
    if (km < 1) return `${formatNumber(Math.round(km * 1000))} m`;
    if (km < 10) return `${formatNumber(km, 1)} km`;
    return `${formatNumber(Math.round(km))} km`;
  }
  if (miles < 0.1) return `${formatNumber(Math.round(miles * 5280))} ft`;
  if (miles < 10) return `${formatNumber(miles, 1)} mi`;
  return `${formatNumber(Math.round(miles))} mi`;
}

/** Miles, rounded, for the places that want a bare number with a word. */
export function distanceValue(miles: number): number {
  return Math.round(units === "metric" ? miles * MILES_TO_KM : miles);
}

/** The same conversion back, for a control the reader types or drags in. */
export function milesFromDistance(shown: number): number {
  return units === "metric" ? shown / MILES_TO_KM : shown;
}

/** Whether the reader is in metric, for a control that has to size itself. */
export function isMetric(): boolean {
  return units === "metric";
}

/**
 * A slider over a range given in miles, expressed in the reader's own units.
 *
 * The stops have to be round numbers in whatever is being read, and every one
 * of them has to survive being stored. The range is given in miles and the
 * stored value is clamped to it, so a metric slider running to 330 bounced
 * its top stop back to 320 the moment it was dragged there: 330 km is 205
 * miles and the setting only holds 200.
 *
 * So both ends move *inward* to a whole step. Five to two hundred miles
 * becomes ten to three hundred and twenty kilometres, every stop of which is
 * inside what the setting accepts and none of which moves under the reader.
 */
export function distanceSlider(
  fromMiles: number,
  toMiles: number,
): { min: number; max: number; step: number } {
  const step = units === "metric" ? 10 : 5;
  const min = Math.ceil(distanceValue(fromMiles) / step) * step;
  const max = Math.floor(distanceValue(toMiles) / step) * step;
  return { min: Math.max(step, min), max: Math.max(min, max), step };
}

export function distanceUnit(): string {
  return units === "metric"
    ? translate("units.kilometres")
    : translate("units.miles");
}

/** A height the service gave in feet. */
export function formatHeight(feet: number): string {
  if (units === "metric") {
    return `${Math.round(feet * FEET_TO_METRES).toLocaleString(locale())} m`;
  }
  return `${Math.round(feet).toLocaleString(locale())} ft`;
}

/**
 * A depth of water on the ground, which is a small number and has to stay one.
 *
 * `formatHeight` rounds to whole metres, which is right for a beam two
 * kilometres up and wrong here: the surge bands at three, six and nine feet
 * come out as one, two and three metres, so the first two rows of the legend
 * both read "1 m" for a boundary that is nine tenths of one. This keeps a
 * decimal below ten, which is where the difference matters.
 */
export function formatDepth(feet: number): string {
  if (units === "metric") {
    const metres = feet * FEET_TO_METRES;
    return metres < 10
      ? `${formatNumber(metres, 1)} m`
      : `${Math.round(metres).toLocaleString(locale())} m`;
  }
  return `${formatNumber(Math.round(feet))} ft`;
}

/** A tide, which NOAA publishes in feet and which is read to a tenth. */
export function formatTideHeight(feet: number): string {
  if (units === "metric") return `${formatNumber(feet * FEET_TO_METRES, 2)} m`;
  return `${formatNumber(feet, 2)} ft`;
}

/**
 * A model cycle, named by the UTC hour it started.
 *
 * A run is called 12Z by everybody who works with one, and the marker is the
 * same one a clock carries, so it is the same string: a French window that
 * says "18 h 05 UTC" on the clock must not say "12Z" in the legend beside it.
 */
export function utcHourLabel(atMs: number): string {
  const hour = String(new Date(atMs).getUTCHours()).padStart(2, "0");
  return `${hour}${translate("time.utcSuffix")}`;
}

/**
 * A time, in the clock the reader asked for.
 *
 * UTC is what a forecaster works in and what every product is stamped with, so
 * reading the map in it rather than converting in your head is worth the
 * setting.
 */
export function formatClock(
  at: number | Date,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" },
): string {
  const settings: Intl.DateTimeFormatOptions = { ...options };
  if (zone === "utc") {
    settings.timeZone = "UTC";
    settings.hour12 = false;
  }
  const text = new Intl.DateTimeFormat(locale(), settings).format(
    typeof at === "number" ? new Date(at) : at,
  );
  // The marker goes on anything carrying a clock and on nothing that does
  // not. A format already asking for the zone by name says it once. What the
  // marker is depends on the language: a bare Z is what a forecaster writes
  // in English, and French writes the time as "14 h 35", where a letter on
  // the end is not a time anybody recognises.
  const marks =
    options.hour !== undefined && options.timeZoneName === undefined;
  return zone === "utc" && marks
    ? `${text}${translate("time.utcSuffix")}`
    : text;
}

/**
 * How old something is, in a unit somebody reads at a glance.
 *
 * Every age in the app was a minute count that never changed unit, so a view
 * cached over a long weekend said "Updated 4908 min ago" in the header and
 * "Radar is stale, 4908 min old" under the map, three times on one screen.
 * Nobody reads 4908 minutes as three and a half days, and the number gets
 * longer the more stale the picture is, which is exactly when it matters most.
 *
 * The minute count itself is still what the staleness comparisons use. This
 * is only how it is said.
 */
export function formatAge(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return translate("age.minutes", { count: whole });
  const hours = Math.round(whole / 60);
  if (hours < 48) return translate("age.hours", { count: hours });
  return translate("age.days", { count: Math.round(hours / 24) });
}

/** A speed given in miles an hour, said in whichever units are asked for. */
export function formatSpeedFromMph(mph: number): string {
  const shown = units === "metric" ? mph * MILES_TO_KM : mph;
  return `${formatNumber(Math.round(shown))} ${speedUnit()}`;
}

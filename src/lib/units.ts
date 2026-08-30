import { useSyncExternalStore } from "react";
import { locale, translate } from "../i18n";

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
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** Miles, rounded, for the places that want a bare number with a word. */
export function distanceValue(miles: number): number {
  return Math.round(units === "metric" ? miles * MILES_TO_KM : miles);
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

/** A tide, which NOAA publishes in feet and which is read to a tenth. */
export function formatTideHeight(feet: number): string {
  if (units === "metric") return `${(feet * FEET_TO_METRES).toFixed(2)} m`;
  return `${feet.toFixed(2)} ft`;
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
  // Z marks a time, so it goes on anything carrying a clock and on nothing
  // that does not. A format already asking for the zone by name says it once.
  const marks =
    options.hour !== undefined && options.timeZoneName === undefined;
  return zone === "utc" && marks ? `${text}Z` : text;
}

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
 * Only one panel is on screen at a time, so a change made in Settings always
 * unmounts whatever was showing a measurement and the next one to open reads
 * the new choice. That is why this is plain module state and not a store with
 * subscribers: nothing stays mounted across the change that would need telling.
 */
export function setUnits(next: UnitSystem) {
  units = next;
}

export function setClockZone(next: ClockZone) {
  zone = next;
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
  return zone === "utc" ? `${text}Z` : text;
}

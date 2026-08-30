import { haversineMiles, type GeoPoint } from "./geo";
import { translate } from "../i18n";

/** Open-Meteo allows 600 requests a minute, and a pan burst can reach it. */
export const FORECAST_DEBOUNCE_MS = 1500;
const FORECAST_MOVE_THRESHOLD_MILES = 3.1;

/**
 * A forecast for a point three miles away reads the same, so a small pan is
 * not worth a request.
 */
export function shouldRefetchForecast(
  requested: GeoPoint | null,
  next: GeoPoint,
  thresholdMiles = FORECAST_MOVE_THRESHOLD_MILES,
): boolean {
  if (!requested) return true;
  return haversineMiles(requested, next) >= thresholdMiles;
}

export interface PlaceResult extends GeoPoint {
  id: number;
  name: string;
  region: string;
  country: string;
}

export interface ForecastDay {
  date: string;
  high: number;
  low: number;
  precipitationChance: number;
  weatherCode: number;
}

export interface ForecastData {
  currentTemperature: number;
  apparentTemperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  updatedAt: string;
  days: ForecastDay[];
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Place search returned ${response.status}.`);
  const payload = (await response.json()) as { results?: unknown };
  if (!Array.isArray(payload.results)) return [];

  return payload.results.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.id !== "number" ||
      typeof raw.name !== "string" ||
      typeof raw.latitude !== "number" ||
      typeof raw.longitude !== "number"
    ) {
      return [];
    }
    return [
      {
        id: raw.id,
        name: raw.name,
        lat: raw.latitude,
        lon: raw.longitude,
        region: typeof raw.admin1 === "string" ? raw.admin1 : "",
        country: typeof raw.country === "string" ? raw.country : "",
      },
    ];
  });
}

function numericArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item))
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function fetchForecast(
  point: GeoPoint,
  signal?: AbortSignal,
): Promise<ForecastData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", point.lat.toFixed(4));
  url.searchParams.set("longitude", point.lon.toFixed(4));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Forecast returned ${response.status}.`);
  const payload = (await response.json()) as Record<string, unknown>;
  const current = (payload.current ?? {}) as Record<string, unknown>;
  const daily = (payload.daily ?? {}) as Record<string, unknown>;
  const dates = stringArray(daily.time);
  const highs = numericArray(daily.temperature_2m_max);
  const lows = numericArray(daily.temperature_2m_min);
  const chances = numericArray(daily.precipitation_probability_max);
  const codes = numericArray(daily.weather_code);

  const currentTemperature = Number(current.temperature_2m);
  if (!Number.isFinite(currentTemperature) || !dates.length) {
    throw new Error("Forecast response was incomplete.");
  }

  return {
    currentTemperature,
    apparentTemperature:
      Number(current.apparent_temperature) || currentTemperature,
    precipitation: Number(current.precipitation) || 0,
    windSpeed: Number(current.wind_speed_10m) || 0,
    weatherCode: Number(current.weather_code) || 0,
    updatedAt:
      typeof current.time === "string"
        ? current.time
        : new Date().toISOString(),
    days: dates.map((date, index) => ({
      date,
      high: highs[index] ?? 0,
      low: lows[index] ?? 0,
      precipitationChance: chances[index] ?? 0,
      weatherCode: codes[index] ?? 0,
    })),
  };
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return translate("weather.clear");
  if (code <= 3) return translate("weather.partlyCloudy");
  if (code === 45 || code === 48) return translate("weather.fog");
  if (code >= 51 && code <= 67) return translate("weather.rain");
  if (code >= 71 && code <= 77) return translate("weather.snow");
  if (code >= 80 && code <= 82) return translate("weather.showers");
  if (code >= 85 && code <= 86) return translate("weather.snowShowers");
  if (code >= 95) return translate("weather.thunderstorms");
  return translate("weather.mixed");
}

/**
 * What several forecast models say about the same place at the same hour.
 *
 * A single forecast reads like a fact. Three of them side by side read like
 * what they are: guidance that the models themselves do not agree on. When
 * they agree the number is worth something, and when they do not, that is the
 * more useful thing to know.
 *
 * The values come from Open-Meteo, which serves the same variables out of each
 * centre's own run rather than blending them, so what is compared here is the
 * models and not a smoothing of them.
 */
import { cachedUrl } from "./tileCache";
import { translate, type StringKey } from "../i18n";
import type { GeoPoint } from "./geo";
import { forecastUnits } from "./units";

/** The models worth putting beside each other, with what to call them. */
export const GUIDANCE_MODELS = [
  { id: "gfs_seamless", key: "guidance.gfs", centre: "NOAA" },
  { id: "ecmwf_ifs025", key: "guidance.ecmwf", centre: "ECMWF" },
  { id: "icon_seamless", key: "guidance.icon", centre: "DWD" },
  { id: "gem_seamless", key: "guidance.gem", centre: "ECCC" },
] as const satisfies ReadonlyArray<{
  id: string;
  key: StringKey;
  centre: string;
}>;

export type GuidanceModelId = (typeof GUIDANCE_MODELS)[number]["id"];

/** The variables the panel draws, in the order it draws them. */
const VARIABLES = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
] as const;

export type GuidanceVariable = (typeof VARIABLES)[number];

export interface GuidanceHour {
  /** Milliseconds, UTC, which is what the whole app times things in. */
  time: number;
  /** One reading per model, in the order of GUIDANCE_MODELS. Null where the
   * model does not reach this point or this hour. */
  values: Array<number | null>;
}

export interface GuidanceReading {
  variable: GuidanceVariable;
  unit: string;
  hours: GuidanceHour[];
  /** The largest gap between models at any hour, which is the disagreement. */
  spread: number;
}

export interface Guidance {
  point: GeoPoint;
  models: GuidanceModelId[];
  readings: GuidanceReading[];
}

/** Every third hour of the day, which is as many columns as the panel holds. */
const STEP_HOURS = 3;
const FORECAST_DAYS = 3;

function toMillis(value: unknown): number {
  // Open-Meteo returns naive ISO times, and asks for UTC by parameter, so the
  // Z has to be put back or the browser reads them as local.
  if (typeof value !== "string") return Number.NaN;
  const at = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isFinite(at) ? at : Number.NaN;
}

function reading(value: unknown): number | null {
  // A gap in a model is a gap, not a zero. Number(null) is 0, which would draw
  // a hard freeze and no rain wherever the model had nothing to say.
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * The reply, in the shape the panel draws. Open-Meteo suffixes every variable
 * with the model it came from when more than one model is asked for, and drops
 * the suffix when only one is, so both shapes are read here.
 */
export function parseGuidance(
  payload: unknown,
  point: GeoPoint,
  models: readonly GuidanceModelId[],
): Guidance {
  const raw = payload as {
    hourly?: Record<string, unknown>;
    hourly_units?: Record<string, unknown>;
  };
  const hourly = raw?.hourly ?? {};
  const units = raw?.hourly_units ?? {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];

  const readings: GuidanceReading[] = [];
  for (const variable of VARIABLES) {
    const columns = models.map((model) => {
      const suffixed = hourly[`${variable}_${model}`];
      const plain = models.length === 1 ? hourly[variable] : undefined;
      const column = Array.isArray(suffixed)
        ? suffixed
        : Array.isArray(plain)
          ? plain
          : [];
      return column;
    });

    const hours: GuidanceHour[] = [];
    let spread = 0;
    for (let index = 0; index < times.length; index += 1) {
      const time = toMillis(times[index]);
      if (!Number.isFinite(time)) continue;
      // Chosen by the hour it names rather than by its place in the array, so
      // the columns land on 00, 03, 06 whatever spacing the reply arrives in.
      if ((time / 3_600_000) % STEP_HOURS !== 0) continue;
      const values = columns.map((column) => reading(column[index]));
      const present = values.filter((value): value is number => value !== null);
      if (present.length) {
        spread = Math.max(spread, Math.max(...present) - Math.min(...present));
      }
      hours.push({ time, values });
    }

    readings.push({
      variable,
      unit:
        typeof units[`${variable}_${models[0]}`] === "string"
          ? String(units[`${variable}_${models[0]}`])
          : typeof units[variable] === "string"
            ? String(units[variable])
            : "",
      hours,
      spread,
    });
  }

  return { point, models: [...models], readings };
}

export async function fetchGuidance(
  point: GeoPoint,
  models: readonly GuidanceModelId[],
  signal?: AbortSignal,
): Promise<Guidance> {
  if (!models.length) {
    throw new Error(translate("guidance.noModels"));
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", point.lat.toFixed(4));
  url.searchParams.set("longitude", point.lon.toFixed(4));
  url.searchParams.set("hourly", VARIABLES.join(","));
  url.searchParams.set("models", models.join(","));
  for (const [key, value] of Object.entries(forecastUnits())) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("timezone", "UTC");

  const response = await fetch(cachedUrl(url.toString()), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(translate("guidance.failed", { status: response.status }));
  }
  return parseGuidance(await response.json(), point, models);
}

/** The models that answered with at least one reading. */
export function modelsThatAnswered(guidance: Guidance): GuidanceModelId[] {
  return guidance.models.filter((_, index) =>
    guidance.readings.some((reading) =>
      reading.hours.some((hour) => hour.values[index] !== null),
    ),
  );
}

/**
 * How far apart the models are, as a share of the range they cover.
 *
 * A two degree spread means one thing in a forecast that runs from ten to
 * thirty and another in one that barely moves, so the number the panel shows
 * is scaled by what the models are actually doing.
 */
export function disagreement(reading: GuidanceReading): number {
  const all = reading.hours.flatMap((hour) =>
    hour.values.filter((value): value is number => value !== null),
  );
  if (all.length < 2) return 0;
  const range = Math.max(...all) - Math.min(...all);
  if (range <= 0) return 0;
  return Math.min(1, reading.spread / range);
}

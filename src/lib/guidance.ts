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
import { serviceAnswer } from "./serviceAnswer";
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
  /**
   * What each model said about this same hour a day ago, when a comparison
   * was asked for. Null where that run had nothing for the hour, and absent
   * entirely when nobody asked.
   */
  previous?: Array<number | null>;
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
  /**
   * True when this was asked for with a previous run beside it. The hours
   * still carry no previous values where the archive had none, which is a
   * different thing from nobody having asked.
   */
  comparedWithPreviousRun?: boolean;
}

/** How far back a comparison reaches. One day, which every model has. */
export const PREVIOUS_DAYS = 1;

/**
 * Where each model's own run metadata lives.
 *
 * Open-Meteo names a model one thing in the forecast request and another in
 * its data directory, and the directory is the only place that says when the
 * model last ran. A seamless model is a blend, so the directory named here is
 * the global member the blend is built out of: that is the run the far end of
 * the forecast comes from, and it is the one worth reporting the age of.
 *
 * Verified against the live service on 2026-08-31. `gfs_global` answers 500;
 * `ncep_gfs013` is the one that answers.
 */
const MODEL_DIRECTORY: Record<GuidanceModelId, string> = {
  gfs_seamless: "ncep_gfs013",
  ecmwf_ifs025: "ecmwf_ifs025",
  icon_seamless: "dwd_icon",
  gem_seamless: "cmc_gem_gdps",
};

/** When a model last ran, as the service reports it. */
export interface ModelRun {
  /** The run's own initialisation moment, in milliseconds UTC. */
  initUtc: number;
  /** When that run finished arriving, which is later and sometimes much later. */
  availableUtc: number;
  /** How often the model is supposed to run, in seconds. */
  intervalSeconds: number;
}

/**
 * Whether a reported run is older than the model's own schedule allows.
 *
 * Three times the interval rather than one: a run is normally a few hours old
 * by the time it has finished arriving, and a model that has skipped one cycle
 * is not news. Past three, either the model has stopped or the service has
 * stopped recording it, and either way the number beside it is not what a
 * reader would assume.
 */
export function runIsStale(run: ModelRun, now: number): boolean {
  if (!run.intervalSeconds) return false;
  return now - run.initUtc > run.intervalSeconds * 3000;
}

/**
 * When each model last ran.
 *
 * One small request per model, which is four at most and is why the panel
 * asks once per session rather than per forecast. A model that does not answer
 * is absent rather than guessed at: "this model's run is unknown" is a true
 * statement and a made-up initialisation time is not.
 */
export async function fetchModelRuns(
  models: readonly GuidanceModelId[],
  signal?: AbortSignal,
): Promise<Partial<Record<GuidanceModelId, ModelRun>>> {
  const found: Partial<Record<GuidanceModelId, ModelRun>> = {};
  await Promise.all(
    models.map(async (model) => {
      const directory = MODEL_DIRECTORY[model];
      if (!directory) return;
      try {
        const response = await fetch(
          cachedUrl(
            `https://api.open-meteo.com/data/${directory}/static/meta.json`,
          ),
          { signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) return;
        const run = parseModelRun(await response.json());
        if (run) found[model] = run;
      } catch (failure) {
        // A run time nobody could fetch is a run time nobody knows, and the
        // forecast itself is not affected by it. An abort is the caller's.
        if (failure instanceof DOMException && failure.name === "AbortError") {
          throw failure;
        }
      }
    }),
  );
  return found;
}

export function parseModelRun(payload: unknown): ModelRun | null {
  const raw = payload as Record<string, unknown> | null;
  const init = Number(raw?.last_run_initialisation_time);
  const available = Number(raw?.last_run_availability_time);
  if (!Number.isFinite(init) || init <= 0) return null;
  return {
    initUtc: init * 1000,
    availableUtc: Number.isFinite(available) ? available * 1000 : init * 1000,
    intervalSeconds: Number.isFinite(Number(raw?.update_interval_seconds))
      ? Number(raw?.update_interval_seconds)
      : 0,
  };
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
  /** Whether the reply was asked for with the previous run beside it. */
  withPrevious = false,
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
    const columnFor = (name: string) =>
      models.map((model) => {
        const suffixed = hourly[`${name}_${model}`];
        const plain = models.length === 1 ? hourly[name] : undefined;
        return Array.isArray(suffixed)
          ? suffixed
          : Array.isArray(plain)
            ? plain
            : [];
      });
    const columns = columnFor(variable);
    // The previous run arrives as its own variable rather than its own
    // request, so the two are already aligned on the same hours: the service
    // answers what that run said about these exact valid times.
    const before = withPrevious
      ? columnFor(`${variable}_previous_day${PREVIOUS_DAYS}`)
      : null;

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
      const hour: GuidanceHour = { time, values };
      if (before) {
        hour.previous = before.map((column) => reading(column[index]));
      }
      hours.push(hour);
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

  return {
    point,
    models: [...models],
    readings,
    ...(withPrevious ? { comparedWithPreviousRun: true } : {}),
  };
}

export async function fetchGuidance(
  point: GeoPoint,
  models: readonly GuidanceModelId[],
  signal?: AbortSignal,
  /**
   * Ask for what each model said about these same hours a day ago.
   *
   * A different host, because that is where Open-Meteo keeps the previous
   * runs, and the same request otherwise: the earlier run arrives as extra
   * variables beside the current one rather than as a second call, so the two
   * are aligned on the same valid hours by the service rather than by us.
   */
  withPrevious = false,
): Promise<Guidance> {
  if (!models.length) {
    throw new Error(translate("guidance.noModels"));
  }
  const url = new URL(
    withPrevious
      ? "https://previous-runs-api.open-meteo.com/v1/forecast"
      : "https://api.open-meteo.com/v1/forecast",
  );
  url.searchParams.set("latitude", point.lat.toFixed(4));
  url.searchParams.set("longitude", point.lon.toFixed(4));
  url.searchParams.set(
    "hourly",
    withPrevious
      ? VARIABLES.flatMap((variable) => [
          variable,
          `${variable}_previous_day${PREVIOUS_DAYS}`,
        ]).join(",")
      : VARIABLES.join(","),
  );
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
    throw new Error(
      translate("guidance.failed", { answer: serviceAnswer(response.status) }),
    );
  }
  return parseGuidance(await response.json(), point, models, withPrevious);
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

import { LoaderCircle, Rows3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import {
  GUIDANCE_MODELS,
  disagreement,
  fetchGuidance,
  fetchModelRuns,
  modelsThatAnswered,
  runIsStale,
  type Guidance,
  type GuidanceModelId,
  type GuidanceVariable,
  type ModelRun,
} from "../lib/guidance";
import { FORECAST_DEBOUNCE_MS, shouldRefetchForecast } from "../lib/weather";
import { formatNumber, translate, useT, type StringKey } from "../i18n";
import { formatClock } from "../lib/units";
import { useMinuteClock } from "../hooks/useClock";

interface GuidancePanelProps {
  point: GeoPoint;
  onClose: () => void;
}

const VARIABLE_KEYS: Record<GuidanceVariable, StringKey> = {
  temperature_2m: "guidance.temperature",
  precipitation: "guidance.precipitation",
  wind_speed_10m: "guidance.wind",
};

/** A reading rounded the way each variable is worth reading. */
function show(variable: GuidanceVariable, value: number): string {
  return variable === "precipitation"
    ? formatNumber(value, 1)
    : formatNumber(Math.round(value), 0);
}

export function GuidancePanel({ point, onClose }: GuidancePanelProps) {
  const t = useT();
  const clock = useMinuteClock();
  const [chosen, setChosen] = useState<GuidanceModelId[]>([
    "gfs_seamless",
    "ecmwf_ifs025",
    "icon_seamless",
  ]);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  // Off until asked for. The comparison is a second set of numbers over the
  // same table, and most of the time the question is what the models say now.
  const [comparing, setComparing] = useState(false);
  const [runs, setRuns] = useState<Partial<Record<GuidanceModelId, ModelRun>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestedRef = useRef<GeoPoint | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const latitude = point.lat;
  const longitude = point.lon;
  const models = chosen.join(",");

  useEffect(() => {
    const next = { lat: latitude, lon: longitude };
    const moved = shouldRefetchForecast(requestedRef.current, next);
    // A change of model is a new question even where the map has not moved.
    if (!moved && guidanceModels(guidance) === models) return;

    const first = requestedRef.current === null;
    requestedRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    inFlightRef.current?.abort();

    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    timerRef.current = window.setTimeout(
      () => {
        void fetchGuidance(
          next,
          models.split(",").filter(Boolean) as GuidanceModelId[],
          controller.signal,
          comparing,
        )
          .then((reply) => {
            setGuidance(reply);
            setError(null);
            setLoading(false);
          })
          .catch((reason: unknown) => {
            if (reason instanceof DOMException && reason.name === "AbortError")
              return;
            requestedRef.current = null;
            setLoading(false);
            setError(
              reason instanceof Error
                ? reason.message
                : translate("guidance.unknown"),
            );
          });
      },
      first ? 0 : FORECAST_DEBOUNCE_MS,
    );

    return () => {
      // Cleared along with the abort, so a run that was cancelled before it
      // started, which is every first run under StrictMode, is asked again
      // rather than left as an answer nobody ever gave.
      window.clearTimeout(timerRef.current ?? undefined);
      controller.abort();
      if (requestedRef.current === next) requestedRef.current = null;
    };
    // `guidance` is read to decide whether the answer on screen already covers
    // the question; depending on it would refetch on every reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparing, latitude, longitude, models]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      inFlightRef.current?.abort();
    },
    [],
  );

  // When each model last ran. Four small requests, asked once for the life of
  // the panel: a run time does not move while somebody is reading it, and the
  // forecast itself is unaffected by whether they arrive.
  useEffect(() => {
    const controller = new AbortController();
    void fetchModelRuns(
      GUIDANCE_MODELS.map((model) => model.id),
      controller.signal,
    )
      .then(setRuns)
      .catch(() => {
        // A run time nobody could fetch is a run time nobody knows, which the
        // panel says rather than filling in.
      });
    return () => controller.abort();
  }, []);

  const hourLabel = (at: Date) =>
    formatClock(at, { weekday: "short", hour: "numeric" });

  const answered = guidance ? modelsThatAnswered(guidance) : [];
  // The shared minute clock rather than a reading taken during a render: an
  // age in hours does not need finer, and the workspace already has one tick
  // everything follows.

  return (
    <PanelShell
      eyebrow={t("guidance.eyebrow")}
      title={t("guidance.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <div
        className="segmented-control segmented-control--full"
        role="group"
        aria-label={t("guidance.models")}
        aria-describedby="guidance-model-minimum"
      >
        {GUIDANCE_MODELS.map((model) => {
          const on = chosen.includes(model.id);
          const required = on && chosen.length <= 2;
          return (
            <button
              key={model.id}
              type="button"
              className={on ? "is-active" : ""}
              aria-pressed={on}
              disabled={required}
              onClick={() =>
                setChosen((current) =>
                  current.includes(model.id)
                    ? current.filter((id) => id !== model.id)
                    : [...current, model.id],
                )
              }
            >
              {t(model.key)}
            </button>
          );
        })}
      </div>

      <p className="source-note" id="guidance-model-minimum">
        {t("guidance.keepTwo")}
      </p>

      <label className="toggle-row toggle-row--plain">
        <span>
          <strong>{t("guidance.compare")}</strong>
          <small>{t("guidance.compareDetail")}</small>
        </span>
        <input
          type="checkbox"
          checked={comparing}
          onChange={(event) => setComparing(event.target.checked)}
        />
        <i className="toggle-track" aria-hidden="true" />
      </label>

      {/* When each model last ran, which is the difference between two models
          disagreeing and one of them being twelve hours behind the other. */}
      <ul role="list" className="model-runs">
        {GUIDANCE_MODELS.filter((model) => chosen.includes(model.id)).map(
          (model) => {
            const run = runs[model.id];
            if (!run) {
              return (
                <li key={model.id}>
                  {t("guidance.runUnknown", { model: t(model.key) })}
                </li>
              );
            }
            const hours = Math.max(
              0,
              Math.round((clock - run.initUtc) / 3_600_000),
            );
            return (
              <li key={model.id} data-stale={runIsStale(run, clock)}>
                {t("guidance.runAt", {
                  model: t(model.key),
                  when: formatClock(new Date(run.initUtc), {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                  }),
                  hours,
                })}
                {runIsStale(run, clock) ? ` ${t("guidance.runStale")}` : ""}
              </li>
            );
          },
        )}
      </ul>

      {loading && !guidance ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          <span>{t("guidance.loading")}</span>
        </div>
      ) : null}

      {error ? (
        <div className="panel-error">
          <Rows3 size={24} />
          <strong>{t("guidance.failedTitle")}</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {guidance
        ? guidance.readings.map((reading) => {
            const spread = disagreement(reading);
            return (
              <div
                className="guidance-block"
                key={reading.variable}
                data-guidance={reading.variable}
                data-spread={spread.toFixed(2)}
              >
                <div className="settings-section__title">
                  <span>{t(VARIABLE_KEYS[reading.variable])}</span>
                  <small>
                    {spread > 0.35
                      ? t("guidance.disagree", { unit: reading.unit })
                      : t("guidance.agree", { unit: reading.unit })}
                  </small>
                </div>
                <table className="guidance-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("guidance.model")}</th>
                      {reading.hours.slice(0, 8).map((hour) => (
                        <th scope="col" key={hour.time}>
                          {hourLabel(new Date(hour.time))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {guidance.models.map((model, index) => {
                      const named = GUIDANCE_MODELS.find(
                        (entry) => entry.id === model,
                      );
                      if (!named || !answered.includes(model)) return null;
                      return (
                        <tr key={model}>
                          <th scope="row">{t(named.key)}</th>
                          {reading.hours.slice(0, 8).map((hour) => {
                            const now = hour.values[index];
                            const before = hour.previous?.[index] ?? null;
                            // The change since the previous run, when both
                            // ends of it exist. A model that has nothing for
                            // this hour in one run or the other has no change
                            // to report, which is not the same as no change.
                            const moved =
                              now !== null && before !== null
                                ? now - before
                                : null;
                            return (
                              <td key={hour.time}>
                                {now === null
                                  ? t("guidance.noValue")
                                  : show(reading.variable, now)}
                                {guidance.comparedWithPreviousRun ? (
                                  <small
                                    className="guidance-change"
                                    data-direction={
                                      moved === null
                                        ? "unknown"
                                        : moved > 0
                                          ? "up"
                                          : moved < 0
                                            ? "down"
                                            : "same"
                                    }
                                  >
                                    {moved === null
                                      ? t("guidance.noPrevious")
                                      : `${moved > 0 ? "+" : ""}${show(
                                          reading.variable,
                                          moved,
                                        )}`}
                                  </small>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })
        : null}

      <p className="source-note">{t("guidance.note")}</p>
    </PanelShell>
  );
}

/** The models an answer was built from, as the key the effect compares. */
function guidanceModels(guidance: Guidance | null): string {
  return guidance ? guidance.models.join(",") : "";
}

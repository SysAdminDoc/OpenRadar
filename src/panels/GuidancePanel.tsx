import { LoaderCircle, Rows3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import {
  GUIDANCE_MODELS,
  disagreement,
  fetchGuidance,
  modelsThatAnswered,
  type Guidance,
  type GuidanceModelId,
  type GuidanceVariable,
} from "../lib/guidance";
import { FORECAST_DEBOUNCE_MS, shouldRefetchForecast } from "../lib/weather";
import { locale, translate, useLanguage, useT, type StringKey } from "../i18n";

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
    ? value.toFixed(1)
    : String(Math.round(value));
}

export function GuidancePanel({ point, onClose }: GuidancePanelProps) {
  const t = useT();
  const language = useLanguage();
  const [chosen, setChosen] = useState<GuidanceModelId[]>([
    "gfs_seamless",
    "ecmwf_ifs025",
    "icon_seamless",
  ]);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
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
  }, [latitude, longitude, models]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      inFlightRef.current?.abort();
    },
    [],
  );

  const hourLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale(language), {
        weekday: "short",
        hour: "numeric",
      }),
    [language],
  );

  const answered = guidance ? modelsThatAnswered(guidance) : [];

  return (
    <PanelShell
      eyebrow={t("guidance.eyebrow")}
      title={t("guidance.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <div
        className="segmented-control segmented-control--full"
        aria-label={t("guidance.models")}
      >
        {GUIDANCE_MODELS.map((model) => {
          const on = chosen.includes(model.id);
          return (
            <button
              key={model.id}
              type="button"
              className={on ? "is-active" : ""}
              aria-pressed={on}
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

      {!chosen.length ? (
        <p className="inline-error">{t("guidance.noModels")}</p>
      ) : null}

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
                          {hourLabel.format(new Date(hour.time))}
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
                          {reading.hours.slice(0, 8).map((hour) => (
                            <td key={hour.time}>
                              {hour.values[index] === null
                                ? t("guidance.noValue")
                                : show(reading.variable, hour.values[index]!)}
                            </td>
                          ))}
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

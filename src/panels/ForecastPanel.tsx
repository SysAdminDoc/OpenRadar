import {
  CloudRain,
  CloudSun,
  Droplets,
  LoaderCircle,
  Navigation,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import {
  FORECAST_DEBOUNCE_MS,
  fetchForecast,
  shouldRefetchForecast,
  weatherCodeLabel,
  type ForecastData,
} from "../lib/weather";
import { locale, useLanguage, useT } from "../i18n";
import { precipitationUnit, speedUnit } from "../lib/units";

interface ForecastPanelProps {
  point: GeoPoint;
  onClose: () => void;
}

export function ForecastPanel({ point, onClose }: ForecastPanelProps) {
  const t = useT();
  const language = useLanguage();
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [error, setError] = useState(false);
  const requestedRef = useRef<GeoPoint | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const latitude = point.lat;
  const longitude = point.lon;

  useEffect(() => {
    const next = { lat: latitude, lon: longitude };
    // A pan that lands close to the last request is not a new forecast, and
    // aborting on every move would cancel the request already on its way.
    if (!shouldRefetchForecast(requestedRef.current, next)) return;

    const first = requestedRef.current === null;
    requestedRef.current = next;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    inFlightRef.current?.abort();

    const controller = new AbortController();
    inFlightRef.current = controller;
    timerRef.current = window.setTimeout(
      () => {
        void fetchForecast(next, controller.signal)
          .then((data) => {
            setForecast(data);
            setError(false);
          })
          .catch((reason: unknown) => {
            if (reason instanceof DOMException && reason.name === "AbortError")
              return;
            // Let the next move try again rather than waiting out the threshold.
            requestedRef.current = null;
            setError(true);
          });
      },
      first ? 0 : FORECAST_DEBOUNCE_MS,
    );
  }, [latitude, longitude]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      inFlightRef.current?.abort();
      timerRef.current = null;
      inFlightRef.current = null;
      requestedRef.current = null;
    },
    [],
  );

  return (
    <PanelShell
      eyebrow={t("forecast.eyebrow")}
      title={t("forecast.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {!forecast && !error ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          <span>{t("forecast.loading")}</span>
        </div>
      ) : null}
      {error ? (
        <div className="panel-error">
          <CloudRain size={24} />
          <strong>{t("forecast.failedTitle")}</strong>
          <span>{t("forecast.failedBody")}</span>
        </div>
      ) : null}
      {forecast ? (
        <>
          <div className="current-forecast">
            <CloudSun size={34} />
            <div>
              <span className="current-forecast__temp">
                {Math.round(forecast.currentTemperature)}°
              </span>
              <strong>{weatherCodeLabel(forecast.weatherCode)}</strong>
              <small>
                {t("forecast.feelsLike", {
                  value: Math.round(forecast.apparentTemperature),
                })}
              </small>
            </div>
          </div>
          <div className="forecast-facts">
            <span>
              <Navigation size={15} />{" "}
              {t("forecast.wind", {
                value: Math.round(forecast.windSpeed),
                unit: speedUnit(),
              })}
            </span>
            <span>
              <Droplets size={15} />{" "}
              {t("forecast.rainNow", {
                value: forecast.precipitation.toFixed(2),
                unit: precipitationUnit(),
              })}
            </span>
          </div>
          <div className="forecast-days">
            {forecast.days.map((day) => (
              <div className="forecast-day" key={day.date}>
                <span>
                  {new Intl.DateTimeFormat(locale(language), {
                    weekday: "short",
                  }).format(new Date(`${day.date}T12:00:00`))}
                </span>
                <CloudSun size={18} />
                <small>{day.precipitationChance}%</small>
                <strong>{Math.round(day.high)}°</strong>
                <em>{Math.round(day.low)}°</em>
              </div>
            ))}
          </div>
          <p className="source-note">{t("forecast.note")}</p>
        </>
      ) : null}
    </PanelShell>
  );
}

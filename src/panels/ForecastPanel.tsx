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

interface ForecastPanelProps {
  point: GeoPoint;
  onClose: () => void;
}

export function ForecastPanel({ point, onClose }: ForecastPanelProps) {
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
    },
    [],
  );

  return (
    <PanelShell
      eyebrow="Map center"
      title="Forecast"
      onClose={onClose}
      className="surface-panel--right"
    >
      {!forecast && !error ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Loading the latest forecast</span>
        </div>
      ) : null}
      {error ? (
        <div className="panel-error">
          <CloudRain size={24} />
          <strong>Forecast is unavailable</strong>
          <span>The radar and map are still live.</span>
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
                Feels like {Math.round(forecast.apparentTemperature)}°
              </small>
            </div>
          </div>
          <div className="forecast-facts">
            <span>
              <Navigation size={15} /> {Math.round(forecast.windSpeed)} mph wind
            </span>
            <span>
              <Droplets size={15} /> {forecast.precipitation.toFixed(2)} in now
            </span>
          </div>
          <div className="forecast-days">
            {forecast.days.map((day) => (
              <div className="forecast-day" key={day.date}>
                <span>
                  {new Intl.DateTimeFormat(undefined, {
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
          <p className="source-note">
            Forecast by Open-Meteo. Check official warnings for safety
            decisions.
          </p>
        </>
      ) : null}
    </PanelShell>
  );
}

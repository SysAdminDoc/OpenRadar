import { LoaderCircle, Route, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import {
  fetchRoute,
  fetchRouteForecast,
  routeGeoJson,
  sampleRoute,
  type RouteConditions,
} from "../lib/route";
import {
  searchPlaces,
  weatherCodeLabel,
  type PlaceResult,
} from "../lib/weather";

interface RoutePanelProps {
  onRoute: (route: Record<string, unknown> | null) => void;
  onClose: () => void;
}

function departureValue(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function clockLabel(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export function RoutePanel({ onRoute, onClose }: RoutePanelProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departure, setDeparture] = useState(() => departureValue(new Date()));
  const [conditions, setConditions] = useState<RouteConditions[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const onRouteRef = useRef(onRoute);

  useEffect(() => {
    onRouteRef.current = onRoute;
  }, [onRoute]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      onRouteRef.current(null);
    },
    [],
  );

  const plan = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("working");
    setError(null);

    try {
      const [start, end] = await Promise.all([
        searchPlaces(from, controller.signal),
        searchPlaces(to, controller.signal),
      ]);
      const origin: PlaceResult | undefined = start[0];
      const destination: PlaceResult | undefined = end[0];
      if (!origin || !destination) {
        throw new Error("One of those places could not be found.");
      }

      const route = await fetchRoute(origin, destination, controller.signal);
      const samples = sampleRoute(route);
      const departAt = new Date(departure).getTime();
      const forecast = await fetchRouteForecast(
        samples,
        Number.isFinite(departAt) ? departAt : Date.now(),
        controller.signal,
      );

      if (controller.signal.aborted) return;
      setConditions(forecast);
      setSummary(
        `${origin.name} to ${destination.name} · ${Math.round(route.distanceMiles)} miles · ${Math.round(route.durationSeconds / 60)} min`,
      );
      setStatus("idle");
      onRouteRef.current(routeGeoJson(route, forecast));
    } catch (failure) {
      if (controller.signal.aborted) return;
      setStatus("failed");
      setError(
        failure instanceof Error
          ? failure.message
          : "The route could not be planned.",
      );
    }
  }, [departure, from, to]);

  return (
    <PanelShell
      eyebrow="Weather along the way"
      title="Route"
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <label className="route-field">
        <span>Start</span>
        <input
          type="text"
          value={from}
          placeholder="Dallas"
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className="route-field">
        <span>Destination</span>
        <input
          type="text"
          value={to}
          placeholder="Houston"
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <label className="route-field">
        <span>Leaving</span>
        <input
          type="datetime-local"
          value={departure}
          onChange={(event) => setDeparture(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="secondary-button"
        disabled={from.trim().length < 2 || to.trim().length < 2}
        onClick={() => void plan()}
      >
        {status === "working" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Search size={16} />
        )}
        Plan the drive
      </button>

      {error ? (
        <div className="panel-error">
          <Route size={24} />
          <strong>The route could not be planned</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {summary ? <p className="source-note">{summary}</p> : null}

      {conditions?.length ? (
        <div className="route-table">
          {conditions.map((sample) => (
            <div className="route-row" key={sample.index}>
              <span>{clockLabel(sample.arrival)}</span>
              <strong>{Math.round(sample.distanceMiles)} mi</strong>
              <span>
                {sample.temperature === null
                  ? "—"
                  : `${Math.round(sample.temperature)}°`}
              </span>
              <span>
                {sample.precipitationChance === null
                  ? "—"
                  : `${sample.precipitationChance}%`}
              </span>
              <small>
                {sample.weatherCode === null
                  ? ""
                  : weatherCodeLabel(sample.weatherCode)}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      <p className="source-note">
        Roads from the OSRM demo server, weather from Open-Meteo. Every stop on
        the drive is covered by a single forecast request, so give the servers a
        moment between tries.
      </p>
    </PanelShell>
  );
}

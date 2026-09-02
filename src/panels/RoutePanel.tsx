import { LoaderCircle, Route, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import {
  ESTIMATED_MPH,
  fetchRoute,
  fetchRouteForecast,
  straightRoute,
  routeGeoJson,
  sampleRoute,
  type RouteConditions,
} from "../lib/route";
import {
  searchPlaces,
  weatherCodeLabel,
  type PlaceResult,
} from "../lib/weather";
import { translate, useT } from "../i18n";
import {
  distanceUnit,
  distanceValue,
  formatClock,
  formatSpeedFromMph,
} from "../lib/units";

interface RoutePanelProps {
  onRoute: (route: Record<string, unknown> | null) => void;
  onClose: () => void;
}

function departureValue(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function clockLabel(at: number): string {
  return formatClock(at, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RoutePanel({ onRoute, onClose }: RoutePanelProps) {
  const t = useT();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departure, setDeparture] = useState(() => departureValue(new Date()));
  const [conditions, setConditions] = useState<RouteConditions[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [canEstimate, setCanEstimate] = useState(false);
  const [estimated, setEstimated] = useState(false);
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

  const plan = useCallback(
    async (straight = false) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("working");
      setError(null);
      setCanEstimate(false);
      setEstimated(false);
      setConditions(null);
      setSummary(null);
      onRouteRef.current(null);

      let routerFailed = false;

      try {
        const [start, end] = await Promise.all([
          searchPlaces(from, controller.signal),
          searchPlaces(to, controller.signal),
        ]);
        const origin: PlaceResult | undefined = start[0];
        const destination: PlaceResult | undefined = end[0];
        if (!origin || !destination) {
          throw new Error(translate("route.placeMissing"));
        }

        let route;
        if (straight) {
          route = straightRoute(origin, destination);
        } else {
          try {
            route = await fetchRoute(origin, destination, controller.signal);
          } catch (failure) {
            routerFailed = true;
            throw failure;
          }
        }
        const samples = sampleRoute(route);
        const departAt = new Date(departure).getTime();
        const forecast = await fetchRouteForecast(
          samples,
          Number.isFinite(departAt) ? departAt : Date.now(),
          controller.signal,
        );

        if (controller.signal.aborted) return;
        setEstimated(route.estimated === true);
        setConditions(forecast);
        setSummary(
          translate("route.summary", {
            from: origin.name,
            to: destination.name,
            miles: distanceValue(route.distanceMiles),
            unit: distanceUnit(),
            minutes: Math.round(route.durationSeconds / 60),
          }),
        );
        setStatus("idle");
        onRouteRef.current(routeGeoJson(route, forecast));
      } catch (failure) {
        if (controller.signal.aborted) return;
        setStatus("failed");
        // A router that refused is not the end of the question: the weather along
        // the way does not depend on which road it is.
        setCanEstimate(routerFailed && !straight);
        setError(
          failure instanceof Error
            ? failure.message
            : translate("route.failed"),
        );
      }
    },
    [departure, from, to],
  );

  return (
    <PanelShell
      eyebrow={t("route.eyebrow")}
      title={t("route.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <label className="route-field">
        <span>{t("route.start")}</span>
        <input
          type="text"
          value={from}
          placeholder={t("route.startPlaceholder")}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className="route-field">
        <span>{t("route.destination")}</span>
        <input
          type="text"
          value={to}
          placeholder={t("route.destinationPlaceholder")}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <label className="route-field">
        <span>{t("route.leaving")}</span>
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
        {t("route.plan")}
      </button>

      {error ? (
        <div className="panel-error">
          <Route size={24} />
          <strong>{t("route.failedTitle")}</strong>
          <span>{error}</span>
          {canEstimate ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void plan(true)}
            >
              {t("route.straightOffer")}
            </button>
          ) : null}
        </div>
      ) : null}

      {estimated ? (
        <p className="source-note">
          {t("route.straightNote", {
            speed: formatSpeedFromMph(ESTIMATED_MPH),
          })}
        </p>
      ) : null}

      {summary ? <p className="source-note">{summary}</p> : null}

      {conditions?.length ? (
        <div className="route-table">
          {conditions.map((sample) => (
            <div className="route-row" key={sample.index}>
              <span>{clockLabel(sample.arrival)}</span>
              <strong>
                {t("route.miles", {
                  value: distanceValue(sample.distanceMiles),
                  unit: distanceUnit(),
                })}
              </strong>
              <span>
                {sample.temperature === null
                  ? t("route.noValue")
                  : `${Math.round(sample.temperature)}°`}
              </span>
              <span>
                {sample.precipitationChance === null
                  ? t("route.noValue")
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

      <p className="source-note">{t("route.note")}</p>
    </PanelShell>
  );
}

import { ArrowDown, ArrowUp, LoaderCircle, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import type { GeoPoint } from "../lib/geo";
import {
  MAX_STATION_MILES,
  fetchTides,
  loadStations,
  nearestStation,
  state,
  upcoming,
  type TideReading,
} from "../lib/tides";
import { locale, useLanguage, useT } from "../i18n";
import { translate } from "../i18n";
import { distanceUnit, distanceValue, formatTideHeight } from "../lib/units";

interface TidesPanelProps {
  point: GeoPoint;
  /** Ticks once a minute, so "next high water" stays true while the panel is open. */
  clock: number;
  onClose: () => void;
}

/** Far enough that the tide is a different piece of water. */
const REFETCH_MILES = 8;

export function TidesPanel({ point, clock, onClose }: TidesPanelProps) {
  const t = useT();
  const language = useLanguage();
  const [reading, setReading] = useState<TideReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooFar, setTooFar] = useState(false);
  const requestedRef = useRef<GeoPoint | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  const latitude = point.lat;
  const longitude = point.lon;

  useEffect(() => {
    const next = { lat: latitude, lon: longitude };
    const last = requestedRef.current;
    if (
      last &&
      Math.abs(last.lat - next.lat) < REFETCH_MILES / 69 &&
      Math.abs(last.lon - next.lon) < REFETCH_MILES / 50
    ) {
      return;
    }
    requestedRef.current = next;
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);

    void loadStations()
      .then((stations) => {
        const found = nearestStation(stations, next);
        if (controller.signal.aborted) return;
        if (!found) {
          setTooFar(true);
          setReading(null);
          setError(null);
          setLoading(false);
          return;
        }
        setTooFar(false);
        return fetchTides(
          found.station,
          found.distanceMiles,
          new Date(),
          controller.signal,
        ).then((next) => {
          if (controller.signal.aborted) return;
          setReading(next);
          setError(null);
          setLoading(false);
        });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        // Let the next move try again rather than sitting on the failure.
        requestedRef.current = null;
        setLoading(false);
        setError(
          reason instanceof Error ? reason.message : translate("tides.unknown"),
        );
      });

    return () => {
      // Cleared along with the abort. Without this a run that was cancelled,
      // which is every first run under StrictMode, leaves its point recorded
      // and the re-run decides there is nothing to ask for: the panel sits on
      // "finding the nearest station" for ever.
      controller.abort();
      if (requestedRef.current === next) requestedRef.current = null;
    };
  }, [latitude, longitude]);

  const clockLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale(language), {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    [language],
  );

  const next = reading ? upcoming(reading.extremes, clock, 6) : [];
  const now = reading ? state(reading.extremes, clock) : null;

  return (
    <PanelShell
      eyebrow={t("tides.eyebrow")}
      title={t("tides.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      {loading && !reading ? (
        <div className="panel-loading">
          <LoaderCircle className="spin" size={22} />
          <span>{t("tides.loading")}</span>
        </div>
      ) : null}

      {tooFar ? (
        <div className="feature-card">
          <Waves size={24} />
          <div>
            <strong>{t("tides.inlandTitle")}</strong>
            <span>{t("tides.inlandBody", { miles: MAX_STATION_MILES })}</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="panel-error">
          <Waves size={24} />
          <strong>{t("tides.failedTitle")}</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {reading ? (
        <>
          <div className="storm-row" data-tide-station={reading.station.id}>
            <div>
              <strong>
                {reading.station.state
                  ? t("tides.stationWithState", {
                      name: reading.station.name,
                      state: reading.station.state,
                    })
                  : reading.station.name}
              </strong>
              <small>
                {t("tides.distance", {
                  unit: distanceUnit(),
                  miles: distanceValue(reading.distanceMiles),
                })}
              </small>
              {now ? (
                <small data-tide-state={now.rising ? "rising" : "falling"}>
                  {now.rising ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                  {now.rising ? t("tides.rising") : t("tides.falling")}
                </small>
              ) : null}
            </div>
          </div>

          {next.length ? (
            <div className="route-table">
              {next.map((extreme) => (
                <div className="route-row" key={extreme.time}>
                  <span>{clockLabel.format(new Date(extreme.time))}</span>
                  <strong>
                    {extreme.high ? t("tides.high") : t("tides.low")}
                  </strong>
                  <span>{formatTideHeight(extreme.feet)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-copy">{t("tides.noneLeft")}</p>
          )}
        </>
      ) : null}

      <p className="source-note">{t("tides.note")}</p>
    </PanelShell>
  );
}

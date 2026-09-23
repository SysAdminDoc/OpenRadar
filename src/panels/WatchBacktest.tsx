import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { fetchArchiveWarnings } from "../hooks/useArchiveWarnings";
import type { AlertType } from "../lib/alertTypes";
import { backtestWarnings, type PlaceBacktest } from "../lib/backtest";
import { failureSentence } from "../lib/serviceAnswer";
import { formatClock } from "../lib/units";
import { watchAlertBody, type WatchPlace } from "../lib/watch";
import { useT } from "../i18n";

interface WatchBacktestProps {
  /** Every place being watched, home first, as the watch itself reads them. */
  places: WatchPlace[];
  /** The kinds of warning the reader has left switched on. */
  kinds: Partial<Record<AlertType, boolean>>;
  /** The replayed window, first frame to last, in milliseconds. */
  from: number;
  to: number;
}

/** A replay can cross midnight, so every time carries its day. */
const WHEN: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

interface Answer {
  /** The window it was worked out for, so a new replay never shows an old one. */
  window: string;
  result: PlaceBacktest[] | null;
  error: string | null;
}

/**
 * What the warning watch would have said at each watched place over the
 * replay on screen, and when.
 *
 * Asked for rather than worked out on open: it reads the archive's warnings
 * for the whole window, which the replayed layer has usually fetched already
 * and the cache then answers, but a reader who never asks should not pay for
 * it. Nothing here is delivered anywhere. The lines are the notification text
 * the watch would have sent, word for word, with the time it would have gone.
 */
export function WatchBacktest({ places, kinds, from, to }: WatchBacktestProps) {
  const t = useT();
  const span = `${from}:${to}`;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const watching = places.filter((place) => place.enabled);
  const shown = answer?.window === span ? answer : null;
  const loading = busy === span;

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(span);
    try {
      const { data } = await fetchArchiveWarnings(from, to, controller.signal);
      if (controller.signal.aborted) return;
      setAnswer({
        window: span,
        result: backtestWarnings(data, watching, kinds, from, to),
        error: null,
      });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setAnswer({
        window: span,
        result: null,
        error: failureSentence(failure, t("backtest.failed")),
      });
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  };

  return (
    <div className="settings-section" data-watch-backtest>
      <div className="settings-section__title">
        <span>{t("backtest.heading")}</span>
      </div>
      <p className="source-note">{t("backtest.note")}</p>
      {watching.length ? (
        <div className="storm-row__actions">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Play size={14} />
            )}{" "}
            {t("backtest.run")}
          </button>
        </div>
      ) : (
        <p className="empty-copy">{t("backtest.noPlaces")}</p>
      )}
      {shown?.error ? <p className="inline-error">{shown.error}</p> : null}
      {shown?.result?.map((place) => (
        <div
          key={place.placeId}
          className="backtest-place"
          data-backtest-place={place.placeId}
        >
          <strong>{place.name}</strong>
          {place.lines.length ? (
            <ul className="backtest-lines">
              {place.lines.map((line, at) => (
                <li key={`${line.alert.id}:${at}`}>
                  <time>
                    {line.said === null
                      ? t("backtest.notSaid")
                      : formatClock(line.said, WHEN)}
                  </time>
                  <span>{watchAlertBody(line.alert)}</span>
                  {line.heldFrom === null ? null : (
                    <small>
                      {t(
                        line.said === null
                          ? "backtest.heldThrough"
                          : "backtest.heldUntil",
                        { from: formatClock(line.heldFrom, WHEN) },
                      )}
                    </small>
                  )}
                  {line.alert.reason.upgradedFrom === null ? null : (
                    <small>{t("watch.whyUpgraded")}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">{t("backtest.nothing")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

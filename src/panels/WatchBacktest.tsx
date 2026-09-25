import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { fetchArchiveWarnings } from "../hooks/useArchiveWarnings";
import { approachBody, approachTitle } from "../hooks/useApproachWatch";
import { lightningAvailable } from "../hooks/useLightning";
import { lightningBody, lightningTitle } from "../hooks/useLightningWatch";
import type { AlertType } from "../lib/alertTypes";
import type { Approach, ApproachSettings } from "../lib/approach";
import {
  backtestApproaches,
  backtestLightning,
  backtestWarnings,
  type BacktestLine,
  type NoticeLine,
  type NoticeLines,
  type PlaceBacktest,
} from "../lib/backtest";
import { cellsAvailable, fetchCellsReplay } from "../lib/cells";
import { fetchFlashReplay } from "../lib/lightningReplay";
import type { LightningNotice, LightningRule } from "../lib/lightningWatch";
import { log } from "../lib/log";
import { failureSentence } from "../lib/serviceAnswer";
import { formatClock } from "../lib/units";
import { watchAlertBody, type WatchPlace } from "../lib/watch";
import { useT } from "../i18n";

interface WatchBacktestProps {
  /** Every place being watched, home first, as the watch itself reads them. */
  places: WatchPlace[];
  /** The kinds of warning the reader has left switched on. */
  kinds: Partial<Record<AlertType, boolean>>;
  /** The lightning notice as the reader has set it. */
  lightning: LightningRule;
  /** The storm-approach notice as the reader has set it. */
  approach: ApproachSettings;
  /** The radar site whose storm tracking the approach notice reads, if any. */
  station: string | null;
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

/** How one of the two notices that are not warnings came out. */
type Part<T> =
  | { state: "done"; lines: NoticeLines<T>; empty: boolean }
  | { state: "off" | "desktop" | "noStation" }
  | { state: "failed" };

interface Answer {
  /** The window it was worked out for, so a new replay never shows an old one. */
  window: string;
  warnings: PlaceBacktest[] | null;
  error: string | null;
  lightning: Part<LightningNotice>;
  approach: Part<Approach>;
}

type Entry =
  | { kind: "warning"; line: BacktestLine }
  | { kind: "lightning"; line: NoticeLine<LightningNotice> }
  | { kind: "approach"; line: NoticeLine<Approach> };

function linesAt<T>(part: Part<T>, placeId: string): NoticeLine<T>[] {
  return part.state === "done" ? (part.lines.get(placeId) ?? []) : [];
}

/** Everything one place would have been told, soonest first. */
function entriesFor(answer: Answer, placeId: string): Entry[] {
  const entries: Entry[] = [
    ...(
      answer.warnings?.find((place) => place.placeId === placeId)?.lines ?? []
    ).map((line) => ({ kind: "warning" as const, line })),
    ...linesAt(answer.lightning, placeId).map((line) => ({
      kind: "lightning" as const,
      line,
    })),
    ...linesAt(answer.approach, placeId).map((line) => ({
      kind: "approach" as const,
      line,
    })),
  ];
  const when = (entry: Entry) => entry.line.said ?? entry.line.heldFrom ?? 0;
  return entries.sort((left, right) => when(left) - when(right));
}

/**
 * What the watch would have said at each watched place over the replay on
 * screen, and when: the warnings, the lightning notice and the storm-approach
 * notice, each by its own rules.
 *
 * Asked for rather than worked out on open: it reads the archive's warnings
 * for the whole window, and with the other two notices on, every lightning
 * file the satellite wrote over it and every storm tracking product the radar
 * site published. A reader who never asks should not pay for that. Nothing
 * here is delivered anywhere. The lines are the notification text the watch
 * would have sent, word for word, with the time it would have gone.
 */
export function WatchBacktest({
  places,
  kinds,
  lightning,
  approach,
  station,
  from,
  to,
}: WatchBacktestProps) {
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

    // The three are asked for together and each answers for itself: an
    // archive that had nothing for one of them is no reason to lose the
    // other two.
    const warnings = fetchArchiveWarnings(from, to, controller.signal).then(
      ({ data }) => backtestWarnings(data, watching, kinds, from, to),
    );
    const flashes: Promise<Part<LightningNotice>> = !lightning.enabled
      ? Promise.resolve({ state: "off" })
      : !lightningAvailable()
        ? Promise.resolve({ state: "desktop" })
        : fetchFlashReplay(from, to, watching, lightning.radiusMiles).then(
            (replay) => ({
              state: "done",
              lines: backtestLightning(replay, watching, lightning, from, to),
              empty: !replay.files.length,
            }),
            (failure: unknown) => {
              log.warn("lightning", `replay: ${String(failure)}`);
              return { state: "failed" };
            },
          );
    const cells: Promise<Part<Approach>> = !approach.enabled
      ? Promise.resolve({ state: "off" })
      : !cellsAvailable()
        ? Promise.resolve({ state: "desktop" })
        : !station
          ? Promise.resolve({ state: "noStation" })
          : fetchCellsReplay(station, from, to).then(
              (replay) => ({
                state: "done",
                lines: backtestApproaches(replay, watching, approach, from, to),
                empty: !replay.reports.length,
              }),
              (failure: unknown) => {
                log.warn("approach", `${station} replay: ${String(failure)}`);
                return { state: "failed" };
              },
            );

    try {
      const [warned, lightningPart, approachPart] = await Promise.all([
        warnings.then(
          (result) => ({ result, error: null }),
          (failure: unknown) => ({
            result: null,
            error: failureSentence(failure, t("backtest.failed")),
          }),
        ),
        flashes,
        cells,
      ]);
      if (controller.signal.aborted) return;
      setAnswer({
        window: span,
        warnings: warned.result,
        error: warned.error,
        lightning: lightningPart,
        approach: approachPart,
      });
    } finally {
      if (controllerRef.current === controller) setBusy(null);
    }
  };

  const lightningNote = (part: Part<LightningNotice>) => {
    if (part.state === "off") return t("backtest.lightningOff");
    if (part.state === "desktop") return t("backtest.desktopOnly");
    if (part.state === "failed") return t("backtest.lightningFailed");
    if (part.state === "done" && part.empty)
      return t("backtest.lightningNoArchive");
    return null;
  };
  const approachNote = (part: Part<Approach>) => {
    if (part.state === "off") return t("backtest.approachOff");
    if (part.state === "desktop") return t("backtest.desktopOnly");
    if (part.state === "noStation") return t("backtest.approachNoStation");
    if (part.state === "failed")
      return t("backtest.approachFailed", { station: station ?? "" });
    if (part.state === "done" && part.empty)
      return t("backtest.approachNoArchive", { station: station ?? "" });
    return t("backtest.approachFrom", { station: station ?? "" });
  };
  // One line per reason rather than one per notice: two notices that are both
  // for the desktop app say so once.
  const notes = shown
    ? [
        ...new Set(
          [lightningNote(shown.lightning), approachNote(shown.approach)].filter(
            (note): note is string => note !== null,
          ),
        ),
      ]
    : [];

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
      {notes.map((note) => (
        <p key={note} className="source-note" data-backtest-note>
          {note}
        </p>
      ))}
      {shown &&
      (shown.warnings ||
        shown.lightning.state === "done" ||
        shown.approach.state === "done")
        ? watching.map((place) => {
            const entries = entriesFor(shown, place.id);
            return (
              <div
                key={place.id}
                className="backtest-place"
                data-backtest-place={place.id}
              >
                <strong>{place.name}</strong>
                {entries.length ? (
                  <ul className="backtest-lines">
                    {entries.map((entry, at) => (
                      <li key={at} data-backtest-kind={entry.kind}>
                        <time>
                          {entry.line.said === null
                            ? t("backtest.notSaid")
                            : formatClock(entry.line.said, WHEN)}
                        </time>
                        <span>
                          {entry.kind === "warning"
                            ? watchAlertBody(entry.line.alert)
                            : entry.kind === "lightning"
                              ? `${lightningTitle(entry.line.notice)}. ${lightningBody(entry.line.notice)}`
                              : `${approachTitle(entry.line.notice)}. ${approachBody(entry.line.notice)}`}
                        </span>
                        {entry.line.heldFrom === null ? null : (
                          <small>
                            {t(
                              entry.line.said === null
                                ? "backtest.heldThrough"
                                : "backtest.heldUntil",
                              { from: formatClock(entry.line.heldFrom, WHEN) },
                            )}
                          </small>
                        )}
                        {entry.kind === "warning" &&
                        entry.line.alert.reason.upgradedFrom !== null ? (
                          <small>{t("watch.whyUpgraded")}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-copy">{t("backtest.nothing")}</p>
                )}
              </div>
            );
          })
        : null}
    </div>
  );
}

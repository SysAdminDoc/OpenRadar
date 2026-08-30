import { useEffect, useMemo, useRef, useState } from "react";
import { History, Play, Search, X } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import {
  ARCHIVE_FIRST_YEAR,
  canReplay,
  categoryLabel,
  loadStorms,
  replayFocus,
  searchStorms,
  trackColor,
  type Storm,
} from "../lib/hurdat";
import { locale, translate, useT } from "../i18n";

interface HistoryPanelProps {
  selectedId: string | null;
  replayId: string | null;
  onSelect: (storm: Storm | null) => void;
  onReplay: (storm: Storm) => void;
  onStopReplay: () => void;
  onClose: () => void;
}

function dateLabel(seconds: number): string {
  return new Intl.DateTimeFormat(locale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(seconds * 1000));
}

export function HistoryPanel({
  selectedId,
  replayId,
  onSelect,
  onReplay,
  onStopReplay,
  onClose,
}: HistoryPanelProps) {
  const t = useT();
  const [storms, setStorms] = useState<Storm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let open = true;
    void loadStorms()
      .then((loaded) => {
        if (open) setStorms(loaded);
      })
      .catch((failure: unknown) => {
        if (!open) return;
        setError(
          failure instanceof Error
            ? failure.message
            : translate("history.failedBody"),
        );
      });
    inputRef.current?.focus();
    return () => {
      open = false;
    };
  }, []);

  const results = useMemo(
    () => (storms ? searchStorms(storms, query) : []),
    [query, storms],
  );
  const selected = useMemo(
    () => storms?.find((storm) => storm.id === selectedId) ?? null,
    [selectedId, storms],
  );
  // What a replay would be about, which is what the note at the bottom names.
  const focus = useMemo(
    () => (selected && canReplay(selected) ? replayFocus(selected) : null),
    [selected],
  );

  return (
    <PanelShell
      eyebrow={t("history.eyebrow")}
      title={t("history.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <label className="search-field">
        <Search size={17} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("history.placeholder")}
          autoComplete="off"
          aria-label={t("history.searchLabel")}
        />
      </label>

      {error ? (
        <div className="feature-card">
          <History size={24} />
          <div>
            <strong>{t("history.failedTitle")}</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="storm-row" data-history-storm={selected.id}>
          <div>
            <strong>
              {selected.name} {selected.year}
            </strong>
            <small>
              <i
                className="track-swatch"
                style={{ background: trackColor(selected.peakWindKt) }}
              />
              {t("history.peak", {
                category: categoryLabel(selected.peakWindKt),
                knots: selected.peakWindKt,
              })}
            </small>
            <small data-history-ace={selected.ace.toFixed(2)}>
              {t("history.ace", {
                ace: selected.ace.toFixed(2),
                fixes: selected.track.length,
                start: dateLabel(selected.start),
                end: dateLabel(selected.end),
              })}
            </small>
          </div>
          <div className="storm-row__actions">
            {canReplay(selected) ? (
              replayId === selected.id ? (
                <button type="button" onClick={onStopReplay}>
                  <X size={14} /> {t("history.liveRadar")}
                </button>
              ) : (
                <button type="button" onClick={() => onReplay(selected)}>
                  <Play size={14} /> {t("history.replayRadar")}
                </button>
              )
            ) : null}
            <button type="button" onClick={() => onSelect(null)}>
              <X size={14} /> {t("history.clear")}
            </button>
          </div>
        </div>
      ) : null}

      {selected && !canReplay(selected) ? (
        <p className="inline-error">
          {selected.year < ARCHIVE_FIRST_YEAR
            ? t("history.tooOld", { year: ARCHIVE_FIRST_YEAR })
            : t("history.outside")}
        </p>
      ) : null}

      <div className="result-list">
        {results.map((storm) => (
          <button
            type="button"
            className="result-row"
            key={storm.id}
            onClick={() => onSelect(storm)}
          >
            <i
              className="track-swatch"
              style={{ background: trackColor(storm.peakWindKt) }}
            />
            <span>
              <strong>
                {storm.name} {storm.year}
              </strong>
              <small>
                {t("history.result", {
                  basin:
                    storm.basin === "AL"
                      ? t("history.basinAtlantic")
                      : t("history.basinPacific"),
                  category: categoryLabel(storm.peakWindKt),
                  ace: storm.ace.toFixed(2),
                })}
              </small>
            </span>
          </button>
        ))}
        {storms && !error && query.trim().length >= 2 && !results.length ? (
          <p className="empty-copy">{t("history.none")}</p>
        ) : null}
      </div>

      <p className="source-note">
        {storms
          ? t("history.noteCount", { count: storms.length })
          : t("history.noteLoading")}{" "}
        {focus
          ? t("history.noteReplay", {
              moment: focus.landfall
                ? t("history.landfall")
                : t("history.closestApproach"),
              date: dateLabel(focus.point[0]),
            })
          : t("history.noteReplaySource")}
      </p>
    </PanelShell>
  );
}

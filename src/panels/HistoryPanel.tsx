import { useEffect, useMemo, useRef, useState } from "react";
import { History, Play, Search, X } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import {
  ARCHIVE_FIRST_YEAR,
  canReplay,
  categoryLabel,
  loadStorms,
  peakPoint,
  searchStorms,
  trackColor,
  type Storm,
} from "../lib/hurdat";

interface HistoryPanelProps {
  selectedId: string | null;
  replayId: string | null;
  onSelect: (storm: Storm | null) => void;
  onReplay: (storm: Storm) => void;
  onStopReplay: () => void;
  onClose: () => void;
}

function dateLabel(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
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
            : "The storm archive did not load.",
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

  return (
    <PanelShell
      eyebrow="HURDAT2 best track"
      title="Storm history"
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
          placeholder="Ian 2022"
          autoComplete="off"
          aria-label="Search past storms by name or year"
        />
      </label>

      {error ? (
        <div className="feature-card">
          <History size={24} />
          <div>
            <strong>The storm archive did not load</strong>
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
              {categoryLabel(selected.peakWindKt)} · {selected.peakWindKt} kt
              peak
            </small>
            <small data-history-ace={selected.ace.toFixed(2)}>
              ACE {selected.ace.toFixed(2)} · {selected.track.length} fixes ·{" "}
              {dateLabel(selected.start)} to {dateLabel(selected.end)}
            </small>
          </div>
          <div className="storm-row__actions">
            {canReplay(selected) ? (
              replayId === selected.id ? (
                <button type="button" onClick={onStopReplay}>
                  <X size={14} /> Live radar
                </button>
              ) : (
                <button type="button" onClick={() => onReplay(selected)}>
                  <Play size={14} /> Replay radar
                </button>
              )
            ) : null}
            <button type="button" onClick={() => onSelect(null)}>
              <X size={14} /> Clear
            </button>
          </div>
        </div>
      ) : null}

      {selected && !canReplay(selected) ? (
        <p className="inline-error">
          The radar archive starts in {ARCHIVE_FIRST_YEAR}, so there is nothing
          to replay for this one. The track is still on the map.
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
                {storm.basin === "AL" ? "Atlantic" : "East Pacific"} ·{" "}
                {categoryLabel(storm.peakWindKt)} · ACE {storm.ace.toFixed(2)}
              </small>
            </span>
          </button>
        ))}
        {storms && !error && query.trim().length >= 2 && !results.length ? (
          <p className="empty-copy">
            Nothing matches that. Try a name, a year, or both.
          </p>
        ) : null}
      </div>

      <p className="source-note">
        {storms
          ? `${storms.length} storms back to 1851, from the NOAA HURDAT2 best track.`
          : "Loading the best track archive."}{" "}
        {selected && canReplay(selected)
          ? `A replay covers three hours either side of the peak on ${dateLabel(peakPoint(selected)[0])}, from the Iowa State radar archive.`
          : "Replays come from the Iowa State radar archive."}
      </p>
    </PanelShell>
  );
}

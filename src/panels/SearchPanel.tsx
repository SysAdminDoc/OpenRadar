import { LoaderCircle, MapPin, Search, Wind } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchPlaces, type PlaceResult } from "../lib/weather";
import {
  categoryLabel,
  loadStorms,
  searchStorms,
  type StormSummary,
} from "../lib/hurdat";
import { PanelShell } from "../components/PanelShell";
import { formatNumber, useT } from "../i18n";

/**
 * How many storms are shown before the rest are put behind a press.
 *
 * More than this and the places somebody asked for are pushed off the panel.
 * Fewer than all of them is only acceptable because the rest are one press
 * away and the press says how many there are: fifteen storms have been called
 * Florence, and answering with six of them and no sign of the other nine is
 * answering a different question.
 */
const STORM_RESULTS = 6;

interface SearchPanelProps {
  onClose: () => void;
  onSelect: (place: PlaceResult) => void;
  /**
   * A storm out of the bundled record, chosen by name.
   *
   * Typing Katrina into a place search asks a geocoder about a town, which is
   * not what anybody meant. The best track record ships with the app and
   * covers every Atlantic and eastern Pacific cyclone since 1851, so the
   * question can be answered here instead. Choosing one hands it to Storm
   * history, which draws the track and offers the replay exactly where the
   * archive reaches; nothing is decided about that here.
   */
  onSelectStorm: (id: string) => void;
}

export function SearchPanel({
  onClose,
  onSelect,
  onSelectStorm,
}: SearchPanelProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // The index that ships with the app. `fetch` on a same-origin path is the
  // file on the disk, so this answers with networking off, and a failure to
  // read it leaves the place search exactly as it was.
  const [storms, setStorms] = useState<StormSummary[]>([]);
  useEffect(() => {
    let open = true;
    void loadStorms()
      .then((found) => {
        if (open) setStorms(found);
      })
      .catch(() => undefined);
    return () => {
      open = false;
    };
  }, []);

  // Every storm that carried the name, not the first one: five storms have
  // been called Bonnie, and answering with one of them is answering a
  // different question.
  const named = useMemo(
    () => (query.trim().length >= 2 ? searchStorms(storms, query) : []),
    [storms, query],
  );

  // Which question "all of them" was asked about, rather than a flag to be
  // cleared. Derived during render, so changing the query collapses the list
  // without an effect writing state and cascading a render to do it.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const shownStorms =
    expandedFor === query ? named : named.slice(0, STORM_RESULTS);

  useEffect(() => {
    if (query.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void searchPlaces(query, controller.signal)
        .then((next) => {
          setResults(next);
          setStatus("idle");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setResults([]);
          setStatus("error");
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <PanelShell
      eyebrow={t("search.eyebrow")}
      title={t("search.title")}
      onClose={onClose}
      className="surface-panel--left"
    >
      <label className="search-field">
        <Search size={17} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setResults([]);
            if (next.trim().length < 2) {
              setStatus("idle");
            } else {
              setStatus("loading");
            }
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
        />
        {status === "loading" ? (
          <LoaderCircle className="spin" size={17} />
        ) : null}
      </label>
      {status === "error" ? (
        <p className="inline-error">{t("search.unavailable")}</p>
      ) : null}
      <div className="result-list">
        {named.length ? (
          <div className="result-group" data-search-storms>
            <p className="result-group__title">{t("search.storms")}</p>
            {shownStorms.map((storm) => (
              <button
                type="button"
                className="result-row"
                key={storm.id}
                data-search-storm={storm.id}
                onClick={() => onSelectStorm(storm.id)}
              >
                <Wind size={18} />
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
                      ace: formatNumber(storm.ace, 2),
                    })}
                  </small>
                </span>
              </button>
            ))}
            {named.length > shownStorms.length ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setExpandedFor(query)}
              >
                {t("search.stormsMore", {
                  count: named.length - shownStorms.length,
                })}
              </button>
            ) : null}
            {/* Every one of these is a record of something that has already
                happened. Nothing here is a storm now, and a search result
                that could be read as one would be the worst kind of wrong. */}
            <p className="source-note">{t("search.stormsNote")}</p>
          </div>
        ) : null}
        {results.map((place) => (
          <button
            type="button"
            className="result-row"
            key={place.id}
            onClick={() => onSelect(place)}
          >
            <MapPin size={18} />
            <span>
              <strong>{place.name}</strong>
              <small>
                {[place.region, place.country].filter(Boolean).join(", ")}
              </small>
            </span>
          </button>
        ))}
        {query.trim().length >= 2 &&
        status === "idle" &&
        results.length === 0 &&
        named.length === 0 ? (
          <p className="empty-copy">{t("search.none")}</p>
        ) : null}
      </div>
      <p className="source-note">{t("search.note")}</p>
    </PanelShell>
  );
}

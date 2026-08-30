import { LoaderCircle, MapPin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchPlaces, type PlaceResult } from "../lib/weather";
import { PanelShell } from "../components/PanelShell";

interface SearchPanelProps {
  onClose: () => void;
  onSelect: (place: PlaceResult) => void;
}

export function SearchPanel({ onClose, onSelect }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

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
      eyebrow="Find a place"
      title="Search"
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
            if (next.trim().length < 2) {
              setResults([]);
              setStatus("idle");
            }
          }}
          placeholder="City, region, or postal code"
          aria-label="Search for a place"
        />
        {status === "loading" ? (
          <LoaderCircle className="spin" size={17} />
        ) : null}
      </label>
      {status === "error" ? (
        <p className="inline-error">
          Place search is unavailable. The map stays usable.
        </p>
      ) : null}
      <div className="result-list">
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
        results.length === 0 ? (
          <p className="empty-copy">No matching places found.</p>
        ) : null}
      </div>
      <p className="source-note">Location search by Open-Meteo and GeoNames.</p>
    </PanelShell>
  );
}

import { Check, Globe2, Map } from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import { MAP_STYLE_OPTIONS } from "../lib/mapStyles";
import type { MapStyleId, ProjectionMode } from "../lib/settings";
import { useT } from "../i18n";

interface MapTypePanelProps {
  mapStyle: MapStyleId;
  projection: ProjectionMode;
  onMapStyle: (style: MapStyleId) => void;
  onProjection: (projection: ProjectionMode) => void;
  onClose: () => void;
}

export function MapTypePanel({
  mapStyle,
  projection,
  onMapStyle,
  onProjection,
  onClose,
}: MapTypePanelProps) {
  const t = useT();
  return (
    <PanelShell
      eyebrow={t("mapType.eyebrow")}
      title={t("mapType.title")}
      onClose={onClose}
      className="surface-panel--left surface-panel--wide"
    >
      <div
        className="segmented-control"
        role="group"
        aria-label={t("mapType.projection")}
      >
        <button
          type="button"
          className={projection === "mercator" ? "is-active" : ""}
          aria-pressed={projection === "mercator"}
          onClick={() => onProjection("mercator")}
        >
          <Map size={17} /> {t("mapType.flat")}
        </button>
        <button
          type="button"
          className={projection === "globe" ? "is-active" : ""}
          aria-pressed={projection === "globe"}
          onClick={() => onProjection("globe")}
        >
          <Globe2 size={17} /> {t("mapType.globe")}
        </button>
      </div>
      <div className="map-style-grid">
        {MAP_STYLE_OPTIONS.map((style) => (
          <button
            type="button"
            className={`map-style-card ${mapStyle === style.id ? "is-active" : ""}`}
            key={style.id}
            aria-pressed={mapStyle === style.id}
            onClick={() => onMapStyle(style.id)}
          >
            <i style={{ background: style.swatch }} />
            <span>
              <strong>{t(style.key)}</strong>
              <small>{t(style.detailKey)}</small>
            </span>
            {mapStyle === style.id ? <Check size={16} /> : null}
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

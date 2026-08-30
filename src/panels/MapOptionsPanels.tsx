import {
  BellRing,
  Check,
  CloudHail,
  Crosshair,
  Flame,
  Globe2,
  Map,
  RadioTower,
  RotateCcw,
  Satellite,
  Tornado,
  Waves,
  Zap,
} from "lucide-react";
import { PanelShell } from "../components/PanelShell";
import { MAP_STYLE_OPTIONS } from "../lib/mapStyles";
import type {
  AppSettings,
  LayerSettings,
  MapStyleId,
  ProjectionMode,
} from "../lib/settings";

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
  return (
    <PanelShell
      eyebrow="Basemap and camera"
      title="Map Type"
      onClose={onClose}
      className="surface-panel--left surface-panel--wide"
    >
      <div className="segmented-control" aria-label="Map projection">
        <button
          type="button"
          className={projection === "mercator" ? "is-active" : ""}
          aria-pressed={projection === "mercator"}
          onClick={() => onProjection("mercator")}
        >
          <Map size={17} /> Flat
        </button>
        <button
          type="button"
          className={projection === "globe" ? "is-active" : ""}
          aria-pressed={projection === "globe"}
          onClick={() => onProjection("globe")}
        >
          <Globe2 size={17} /> Globe
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
              <strong>{style.label}</strong>
              <small>{style.detail}</small>
            </span>
            {mapStyle === style.id ? <Check size={16} /> : null}
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

interface LayersPanelProps {
  layers: LayerSettings;
  onLayers: (layers: LayerSettings) => void;
  onClose: () => void;
}

const LAYER_OPTIONS: Array<{
  key: keyof LayerSettings;
  label: string;
  detail: string;
  icon: typeof BellRing;
}> = [
  {
    key: "weatherAlerts",
    label: "Weather Alerts",
    detail: "Official watches and warnings",
    icon: BellRing,
  },
  {
    key: "earthquakes",
    label: "Earthquakes",
    detail: "USGS events above magnitude 2.5 in the past day",
    icon: Waves,
  },
  {
    key: "wildfires",
    label: "Wildfires",
    detail: "NIFC perimeters over 100 acres",
    icon: Flame,
  },
  {
    key: "tropical",
    label: "Tropical",
    detail: "NHC cones, tracks, and development outlooks",
    icon: Tornado,
  },
  {
    key: "satellite",
    label: "Satellite",
    detail: "GOES-East GeoColor under the radar",
    icon: Satellite,
  },
  {
    key: "rotationTracks",
    label: "Rotation Tracks",
    detail: "MRMS azimuthal shear over the past hour",
    icon: Tornado,
  },
  {
    key: "hail",
    label: "Hail Size",
    detail: "MRMS maximum estimated hail size",
    icon: CloudHail,
  },
  {
    key: "lightningDensity",
    label: "Lightning Density",
    detail: "MRMS cloud-to-ground flashes over the past five minutes",
    icon: Zap,
  },
  {
    key: "lightningFlashes",
    label: "Lightning Flashes",
    detail: "GOES-East total lightning, cloud flashes included",
    icon: Zap,
  },
  {
    key: "customOverlay",
    label: "Custom Overlay",
    detail: "Local GeoJSON workspace",
    icon: RadioTower,
  },
];

export function LayersPanel({ layers, onLayers, onClose }: LayersPanelProps) {
  return (
    <PanelShell
      eyebrow="Visible information"
      title="Layers"
      onClose={onClose}
      className="surface-panel--left"
    >
      <div className="setting-list">
        {LAYER_OPTIONS.map(({ key, label, detail, icon: Icon }) => (
          <label className="toggle-row" key={key}>
            <Icon size={19} />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={(event) =>
                onLayers({ ...layers, [key]: event.target.checked })
              }
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        ))}
      </div>
      <p className="source-note">
        Layer switches save immediately and take effect on the map right away.
        Alerts come from the NWS, earthquakes from the USGS, and fire perimeters
        from NIFC.
      </p>
    </PanelShell>
  );
}

interface SettingsPanelProps {
  settings: AppSettings;
  onSettings: (settings: AppSettings) => void;
  onWatchHere: () => void;
  onReset: () => void;
  onClose: () => void;
}

interface ToggleSettingProps {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSetting({
  label,
  detail,
  checked,
  onChange,
}: ToggleSettingProps) {
  return (
    <label className="toggle-row toggle-row--plain">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function SettingsPanel({
  settings,
  onSettings,
  onWatchHere,
  onReset,
  onClose,
}: SettingsPanelProps) {
  const updateRadar = (patch: Partial<AppSettings["radar"]>) =>
    onSettings({ ...settings, radar: { ...settings.radar, ...patch } });

  return (
    <PanelShell
      eyebrow="OpenRadar preferences"
      title="Settings"
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <div className="settings-section">
        <div className="settings-section__title">
          <span>Appearance</span>
          <small>Applies immediately</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label="Theme"
        >
          <button
            type="button"
            className={settings.theme === "dark" ? "is-active" : ""}
            aria-pressed={settings.theme === "dark"}
            onClick={() => onSettings({ ...settings, theme: "dark" })}
          >
            Dark
          </button>
          <button
            type="button"
            className={settings.theme === "light" ? "is-active" : ""}
            aria-pressed={settings.theme === "light"}
            onClick={() => onSettings({ ...settings, theme: "light" })}
          >
            Light
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>Composite Radar</span>
          <small>Base reflectivity</small>
        </div>
        <label className="range-row">
          <span>
            <strong>Opacity</strong>
            <output>{Math.round(settings.radar.opacity * 100)}%</output>
          </span>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            aria-label="Radar opacity"
            value={settings.radar.opacity}
            onChange={(event) =>
              updateRadar({ opacity: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>Animation speed</strong>
            <output>{settings.radar.animationSpeed.toFixed(1)}</output>
          </span>
          <input
            type="range"
            min="-0.8"
            max="0.5"
            step="0.1"
            aria-label="Radar animation speed"
            value={settings.radar.animationSpeed}
            onChange={(event) =>
              updateRadar({ animationSpeed: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>Loop length</strong>
            <output>{settings.radar.loopMinutes} min</output>
          </span>
          <input
            type="range"
            min="60"
            max="120"
            step="10"
            aria-label="Loop length in minutes"
            value={settings.radar.loopMinutes}
            onChange={(event) =>
              updateRadar({ loopMinutes: Number(event.target.value) })
            }
          />
        </label>
        <ToggleSetting
          label="Future radar"
          detail="Extend the loop with HRRR forecast reflectivity over the lower forty-eight"
          checked={settings.radar.futureRadar}
          onChange={(futureRadar) => updateRadar({ futureRadar })}
        />
        <ToggleSetting
          label="Show radar"
          detail="Keep the basemap visible when radar is hidden"
          checked={settings.radar.enabled}
          onChange={(enabled) => updateRadar({ enabled })}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>Watched area</span>
          <small>Warnings near one place</small>
        </div>
        <ToggleSetting
          label="Tell me about warnings"
          detail="Watch one point even when the map is looking elsewhere"
          checked={settings.watch.enabled}
          onChange={(enabled) =>
            onSettings({ ...settings, watch: { ...settings.watch, enabled } })
          }
        />
        <label className="range-row">
          <span>
            <strong>Radius</strong>
            <output>{settings.watch.radiusMiles} mi</output>
          </span>
          <input
            type="range"
            min="5"
            max="200"
            step="5"
            aria-label="Watched radius in miles"
            value={settings.watch.radiusMiles}
            onChange={(event) =>
              onSettings({
                ...settings,
                watch: {
                  ...settings.watch,
                  radiusMiles: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={onWatchHere}
        >
          <Crosshair size={16} /> Watch the map centre
        </button>
        <p className="source-note">
          Watching {settings.watch.center[1].toFixed(2)},{" "}
          {settings.watch.center[0].toFixed(2)} for warnings and worse.
        </p>
      </div>

      <div className="settings-section settings-section--camera">
        <div className="settings-section__title">
          <span>Camera state</span>
          <small>{settings.projection === "globe" ? "Globe" : "Flat"}</small>
        </div>
        <dl className="camera-grid">
          <div>
            <dt>Zoom</dt>
            <dd>{settings.camera.zoom.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Bearing</dt>
            <dd>{settings.camera.bearing.toFixed(1)}°</dd>
          </div>
          <div>
            <dt>Pitch</dt>
            <dd>{settings.camera.pitch.toFixed(1)}°</dd>
          </div>
          <div>
            <dt>Center</dt>
            <dd>
              {settings.camera.center[1].toFixed(2)},{" "}
              {settings.camera.center[0].toFixed(2)}
            </dd>
          </div>
        </dl>
      </div>

      <button type="button" className="secondary-button" onClick={onReset}>
        <RotateCcw size={16} /> Reset settings
      </button>
    </PanelShell>
  );
}

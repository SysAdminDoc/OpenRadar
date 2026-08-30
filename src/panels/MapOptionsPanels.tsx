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
  Wind,
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
import { LANGUAGES, useT, type StringKey } from "../i18n";
import {
  SURGE_CATEGORIES,
  SURGE_RAMP,
  surgeCategoryKey,
  type SurgeCategory,
} from "../lib/surge";

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
      <div className="segmented-control" aria-label={t("mapType.projection")}>
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

interface LayersPanelProps {
  layers: LayerSettings;
  /** Which hurricane the surge picture is about. */
  surgeCategory: SurgeCategory;
  onLayers: (layers: LayerSettings) => void;
  onSurgeCategory: (category: SurgeCategory) => void;
  onClose: () => void;
}

const LAYER_OPTIONS: Array<{
  key: keyof LayerSettings;
  labelKey: StringKey;
  detailKey: StringKey;
  icon: typeof BellRing;
}> = [
  {
    key: "weatherAlerts",
    labelKey: "layer.weatherAlerts",
    detailKey: "layers.alertsDetail",
    icon: BellRing,
  },
  {
    key: "earthquakes",
    labelKey: "layer.earthquakes",
    detailKey: "layers.earthquakesDetail",
    icon: Waves,
  },
  {
    key: "wildfires",
    labelKey: "layer.wildfires",
    detailKey: "layers.wildfiresDetail",
    icon: Flame,
  },
  {
    key: "tropical",
    labelKey: "layer.tropical",
    detailKey: "layers.tropicalDetail",
    icon: Tornado,
  },
  {
    key: "satellite",
    labelKey: "layer.satellite",
    detailKey: "layers.satelliteDetail",
    icon: Satellite,
  },
  {
    key: "rotationTracks",
    labelKey: "layer.rotationTracks",
    detailKey: "layers.rotationDetail",
    icon: Tornado,
  },
  {
    key: "hail",
    labelKey: "layer.hail",
    detailKey: "layers.hailDetail",
    icon: CloudHail,
  },
  {
    key: "lightningDensity",
    labelKey: "layer.lightningDensity",
    detailKey: "layers.lightningDensityDetail",
    icon: Zap,
  },
  {
    key: "lightningFlashes",
    labelKey: "layer.lightningFlashes",
    detailKey: "layers.lightningFlashesDetail",
    icon: Zap,
  },
  {
    key: "wind",
    labelKey: "layers.wind",
    detailKey: "layers.windDetail",
    icon: Wind,
  },
  {
    key: "surge",
    labelKey: "layer.surge",
    detailKey: "layers.surgeDetail",
    icon: Waves,
  },
  {
    key: "customOverlay",
    labelKey: "layer.customOverlay",
    detailKey: "layers.customDetail",
    icon: RadioTower,
  },
];

export function LayersPanel({
  layers,
  surgeCategory,
  onLayers,
  onSurgeCategory,
  onClose,
}: LayersPanelProps) {
  const t = useT();
  return (
    <PanelShell
      eyebrow={t("layers.eyebrow")}
      title={t("layers.title")}
      onClose={onClose}
      className="surface-panel--left"
    >
      <div className="setting-list">
        {LAYER_OPTIONS.map(({ key, labelKey, detailKey, icon: Icon }) => (
          <label className="toggle-row" key={key}>
            <Icon size={19} />
            <span>
              <strong>{t(labelKey)}</strong>
              <small>{t(detailKey)}</small>
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
      {layers.surge ? (
        <div className="settings-section" data-surge-category={surgeCategory}>
          <div className="settings-section__title">
            <span>{t("layers.surgeCategory")}</span>
            <small>{t(surgeCategoryKey(surgeCategory))}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.surgeCategory")}
          >
            {SURGE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={surgeCategory === category ? "is-active" : ""}
                aria-pressed={surgeCategory === category}
                onClick={() => onSurgeCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <ol className="surge-ramp">
            {SURGE_RAMP.map(([color, key]) => (
              <li key={key}>
                <i style={{ background: color }} aria-hidden="true" />
                {t(key)}
              </li>
            ))}
          </ol>
          <p className="source-note">{t("layers.surgeNote")}</p>
        </div>
      ) : null}

      <p className="source-note">{t("layers.note")}</p>
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
  const t = useT();
  const updateRadar = (patch: Partial<AppSettings["radar"]>) =>
    onSettings({ ...settings, radar: { ...settings.radar, ...patch } });

  return (
    <PanelShell
      eyebrow={t("settings.eyebrow")}
      title={t("settings.title")}
      onClose={onClose}
      className="surface-panel--right surface-panel--settings"
    >
      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.appearance")}</span>
          <small>{t("settings.appliesNow")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label={t("settings.theme")}
        >
          <button
            type="button"
            className={settings.theme === "dark" ? "is-active" : ""}
            aria-pressed={settings.theme === "dark"}
            onClick={() => onSettings({ ...settings, theme: "dark" })}
          >
            {t("settings.dark")}
          </button>
          <button
            type="button"
            className={settings.theme === "light" ? "is-active" : ""}
            aria-pressed={settings.theme === "light"}
            onClick={() => onSettings({ ...settings, theme: "light" })}
          >
            {t("settings.light")}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.language")}</span>
          <small>{t("settings.languageNote")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label={t("settings.language")}
        >
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={settings.language === option.id ? "is-active" : ""}
              aria-pressed={settings.language === option.id}
              onClick={() => onSettings({ ...settings, language: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.radar")}</span>
          <small>{t("settings.baseReflectivity")}</small>
        </div>
        <label className="range-row">
          <span>
            <strong>{t("settings.opacity")}</strong>
            <output>{Math.round(settings.radar.opacity * 100)}%</output>
          </span>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            aria-label={t("settings.opacityLabel")}
            value={settings.radar.opacity}
            onChange={(event) =>
              updateRadar({ opacity: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.animationSpeed")}</strong>
            <output>{settings.radar.animationSpeed.toFixed(1)}</output>
          </span>
          <input
            type="range"
            min="-0.8"
            max="0.5"
            step="0.1"
            aria-label={t("settings.animationSpeedLabel")}
            value={settings.radar.animationSpeed}
            onChange={(event) =>
              updateRadar({ animationSpeed: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.loopLength")}</strong>
            <output>
              {t("settings.minutes", { count: settings.radar.loopMinutes })}
            </output>
          </span>
          <input
            type="range"
            min="60"
            max="120"
            step="10"
            aria-label={t("settings.loopLengthLabel")}
            value={settings.radar.loopMinutes}
            onChange={(event) =>
              updateRadar({ loopMinutes: Number(event.target.value) })
            }
          />
        </label>
        <ToggleSetting
          label={t("settings.futureRadar")}
          detail={t("settings.futureRadarDetail")}
          checked={settings.radar.futureRadar}
          onChange={(futureRadar) => updateRadar({ futureRadar })}
        />
        <ToggleSetting
          label={t("settings.showRadar")}
          detail={t("settings.showRadarDetail")}
          checked={settings.radar.enabled}
          onChange={(enabled) => updateRadar({ enabled })}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.watchedArea")}</span>
          <small>{t("settings.watchedAreaNote")}</small>
        </div>
        <ToggleSetting
          label={t("settings.tellMe")}
          detail={t("settings.tellMeDetail")}
          checked={settings.watch.enabled}
          onChange={(enabled) =>
            onSettings({ ...settings, watch: { ...settings.watch, enabled } })
          }
        />
        <label className="range-row">
          <span>
            <strong>{t("settings.radius")}</strong>
            <output>
              {t("settings.radiusValue", { count: settings.watch.radiusMiles })}
            </output>
          </span>
          <input
            type="range"
            min="5"
            max="200"
            step="5"
            aria-label={t("settings.radiusLabel")}
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
          <Crosshair size={16} /> {t("settings.watchCentre")}
        </button>
        <p className="source-note">
          {t("settings.watching", {
            lat: settings.watch.center[1].toFixed(2),
            lon: settings.watch.center[0].toFixed(2),
          })}
        </p>
      </div>

      <div className="settings-section settings-section--camera">
        <div className="settings-section__title">
          <span>{t("settings.camera")}</span>
          <small>
            {settings.projection === "globe"
              ? t("mapType.globe")
              : t("mapType.flat")}
          </small>
        </div>
        <dl className="camera-grid">
          <div>
            <dt>{t("settings.zoom")}</dt>
            <dd>{settings.camera.zoom.toFixed(2)}</dd>
          </div>
          <div>
            <dt>{t("settings.bearing")}</dt>
            <dd>{settings.camera.bearing.toFixed(1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.pitch")}</dt>
            <dd>{settings.camera.pitch.toFixed(1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.center")}</dt>
            <dd>
              {settings.camera.center[1].toFixed(2)},{" "}
              {settings.camera.center[0].toFixed(2)}
            </dd>
          </div>
        </dl>
      </div>

      <button type="button" className="secondary-button" onClick={onReset}>
        <RotateCcw size={16} /> {t("settings.reset")}
      </button>
    </PanelShell>
  );
}

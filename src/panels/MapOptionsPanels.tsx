import {
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  CloudFog,
  CloudHail,
  CloudRain,
  CloudSnow,
  Crosshair,
  Droplets,
  Cloudy,
  Flame,
  Thermometer,
  Globe2,
  Map,
  MapPin,
  MessageSquareWarning,
  MoveUp,
  RadioTower,
  RotateCcw,
  Satellite,
  ShieldAlert,
  Sigma,
  Snowflake,
  Tornado,
  Umbrella,
  Waves,
  Wind,
  X,
  Zap,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { MAP_STYLE_OPTIONS } from "../lib/mapStyles";
import { rangeFill } from "../lib/rangeFill";
import { MAX_LOOP_VOLUMES, MIN_LOOP_VOLUMES } from "../lib/siteLoop";
import { GAUGE_QPE_PERIODS, type GaugeQpePeriod } from "../lib/gaugeQpe";
import {
  AZ_SHEAR_LEVELS,
  ROTATION_PERIODS,
  type AzShearLevel,
  type RotationPeriod,
} from "../lib/rotationTrack";
import {
  distanceSlider,
  distanceUnit,
  distanceValue,
  formatAge,
  formatClock,
  formatDistance,
  milesFromDistance,
  TEXT_SCALES,
} from "../lib/units";
import type {
  AppSettings,
  LayerSettings,
  MapStyleId,
  ProjectionMode,
  WatchState,
} from "../lib/settings";
import type { PackBounds } from "../lib/incidentPacks";
import {
  moveOverlayFile,
  overlayShapeCount,
  type WorkspaceOverlayFile,
} from "../lib/workspaceOverlays";
import { useForcedColours } from "../hooks/useClock";
import { useOfflineSince } from "../hooks/useOffline";
import { IncidentPackManager } from "./IncidentPackManager";
import { StorageSection } from "./StorageSection";
import type { UndoableRemoval } from "../components/ToastHost";

/**
 * Minutes past midnight as a time field reads them, and back again.
 *
 * A time input speaks "HH:MM" and the setting is a single number, which is the
 * shape the midnight wrap is easiest to reason about. A field that is cleared
 * gives an empty string, so the previous value is kept rather than resetting
 * the window to midnight under the reader.
 */
function minuteToTime(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinute(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minute) && minute >= 0 && minute < 1440
    ? minute
    : fallback;
}
import { formatNumber, LANGUAGES, useT, type StringKey } from "../i18n";
import { themeAccent, themeFromAccent } from "../lib/theme";
import type { AmbientState } from "../hooks/useAmbient";
import { JournalSection } from "./JournalSection";
import { playAlertTone } from "../lib/sound";
import { openGlance } from "../lib/tray";
import { giveSpeculationBack, putSpeculationAway } from "../lib/calm";
import { WALLPAPER_EVERY, wallpaperAvailable } from "../lib/wallpaper";
import { RecapSection } from "./RecapSection";
import { CuriositySection } from "./CuriositySection";
import {
  SURGE_CATEGORIES,
  SURGE_RAMP,
  surgeDepthLabel,
  surgeCategoryKey,
  type SurgeCategory,
} from "../lib/surge";
import {
  SATELLITE_PRODUCTS,
  type SatelliteProductId,
} from "../lib/providers/satellite";
import { ALERT_TYPES, type AlertType } from "../lib/alertTypes";
import {
  MAX_WATCH_PLACES,
  WATCH_FAILURES_BEFORE_SAYING,
  WATCH_HEALTHY,
  type WatchHealth,
} from "../lib/watch";
import { overlayBandOrder } from "../lib/overlayOrder";
import { ERO_DAYS, WSSI_DAYS } from "../lib/overlays";

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

/**
 * The layer switches that draw an overlay, paired with the overlay they draw.
 *
 * Only these can be faded: the rest are pictures the native side draws, and a
 * picture already has its own opacity control beside the radar.
 */
const OVERLAY_LAYERS: Array<{
  key: keyof LayerSettings;
  overlayId: string;
  labelKey: StringKey;
}> = [
  {
    key: "weatherAlerts",
    overlayId: "alerts",
    labelKey: "layer.weatherAlerts",
  },
  {
    key: "spcOutlooks",
    overlayId: "spcOutlooks",
    labelKey: "layer.spcOutlooks",
  },
  {
    key: "wpcExcessiveRain",
    overlayId: "wpcExcessiveRain",
    labelKey: "layer.wpcExcessiveRain",
  },
  {
    key: "wpcWinterSeverity",
    overlayId: "wpcWinterSeverity",
    labelKey: "layer.wpcWinterSeverity",
  },
  {
    key: "spcDiscussions",
    overlayId: "spcDiscussions",
    labelKey: "layer.spcDiscussions",
  },
  {
    key: "stormReports",
    overlayId: "stormReports",
    labelKey: "layer.stormReports",
  },
  {
    key: "earthquakes",
    overlayId: "earthquakes",
    labelKey: "layer.earthquakes",
  },
  { key: "wildfires", overlayId: "wildfires", labelKey: "layer.wildfires" },
  { key: "smoke", overlayId: "smoke", labelKey: "layer.smoke" },
  { key: "metar", overlayId: "metar", labelKey: "layer.metar" },
  {
    key: "riverGauges",
    overlayId: "riverGauges",
    labelKey: "layer.riverGauges",
  },
  { key: "tropical", overlayId: "tropical", labelKey: "layer.tropical" },
];

interface LayersPanelProps {
  layers: LayerSettings;
  /**
   * What a switched-on layer has to say for itself, when it is not drawing.
   *
   * Shown in place of the layer's description, because that is where somebody
   * who just switched it on and saw nothing is looking. A layer that fails
   * silently looks like a quiet afternoon.
   */
  layerNotes?: Partial<Record<keyof LayerSettings, string | null>>;
  /** How solid each overlay is drawn, as a fraction of its own design. */
  overlayOpacity: Record<string, number>;
  onOverlayOpacity: (opacity: Record<string, number>) => void;
  /** The order the overlays are drawn in, bottom first. */
  overlayOrder: string[];
  onOverlayOrder: (order: string[]) => void;
  /** The local files on the map, bottom first. */
  overlayFiles: WorkspaceOverlayFile[];
  onOverlayFiles: (files: WorkspaceOverlayFile[]) => void;
  /** A file taken off the map, and the way back to it. */
  onRemoved: (removal: UndoableRemoval) => void;
  /** Which kinds of alert to draw, by the switches below the alert layer. */
  alertTypes: Partial<Record<AlertType, boolean>>;
  /** Which hurricane the surge picture is about. */
  surgeCategory: SurgeCategory;
  /** Which GOES-East view the satellite layer draws. */
  satelliteProduct: SatelliteProductId;
  onLayers: (layers: LayerSettings) => void;
  onAlertTypes: (types: Partial<Record<AlertType, boolean>>) => void;
  onSurgeCategory: (category: SurgeCategory) => void;
  onSatelliteProduct: (product: SatelliteProductId) => void;
  gaugeQpePeriod: GaugeQpePeriod;
  onGaugeQpePeriod: (period: GaugeQpePeriod) => void;
  /** How far back the rotation track reaches. */
  rotationPeriod: RotationPeriod;
  onRotationPeriod: (period: RotationPeriod) => void;
  /** Which slab the merged shear is measured through. */
  azShearLevel: AzShearLevel;
  onAzShearLevel: (level: AzShearLevel) => void;
  /** Which day of each of the two Weather Prediction Center outlooks. */
  wpcDay: number;
  onWpcDay: (day: number) => void;
  wssiDay: number;
  onWssiDay: (day: number) => void;
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
    key: "spcOutlooks",
    labelKey: "layer.spcOutlooks",
    detailKey: "layers.spcOutlooksDetail",
    icon: ShieldAlert,
  },
  {
    key: "wpcExcessiveRain",
    labelKey: "layer.wpcExcessiveRain",
    detailKey: "layers.wpcExcessiveRainDetail",
    icon: CloudRain,
  },
  {
    key: "wpcWinterSeverity",
    labelKey: "layer.wpcWinterSeverity",
    detailKey: "layers.wpcWinterSeverityDetail",
    icon: Snowflake,
  },
  {
    key: "spcDiscussions",
    labelKey: "layer.spcDiscussions",
    detailKey: "layers.spcDiscussionsDetail",
    icon: MessageSquareWarning,
  },
  {
    key: "stormReports",
    labelKey: "layer.stormReports",
    detailKey: "layers.stormReportsDetail",
    icon: MapPin,
  },
  {
    key: "stormCells",
    labelKey: "layer.stormCells",
    detailKey: "layers.stormCellsDetail",
    icon: Crosshair,
  },
  {
    key: "classification",
    labelKey: "layer.classification",
    detailKey: "layers.classificationDetail",
    icon: CloudSnow,
  },
  {
    key: "probSevere",
    labelKey: "layer.probSevere",
    detailKey: "layers.probSevereDetail",
    icon: Sigma,
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
    key: "smoke",
    labelKey: "layer.smoke",
    detailKey: "layers.smokeDetail",
    icon: Cloudy,
  },
  {
    key: "forecastSmoke",
    labelKey: "layer.forecastSmoke",
    detailKey: "layers.forecastSmokeDetail",
    icon: CloudFog,
  },
  {
    key: "metar",
    labelKey: "layer.metar",
    detailKey: "layers.metarDetail",
    icon: Thermometer,
  },
  {
    key: "riverGauges",
    labelKey: "layer.riverGauges",
    detailKey: "layers.riverGaugesDetail",
    icon: Waves,
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
    key: "azShear",
    labelKey: "layer.azShear",
    detailKey: "layers.azShearDetail",
    icon: Tornado,
  },
  {
    key: "hail",
    labelKey: "layer.hail",
    detailKey: "layers.hailDetail",
    icon: CloudHail,
  },
  {
    key: "hailSwath",
    labelKey: "layer.hailSwath",
    detailKey: "layers.hailSwathDetail",
    icon: CloudHail,
  },
  {
    key: "posh",
    labelKey: "layer.posh",
    detailKey: "layers.poshDetail",
    icon: CloudHail,
  },
  {
    key: "shi",
    labelKey: "layer.shi",
    detailKey: "layers.shiDetail",
    icon: CloudHail,
  },
  {
    key: "vilDensity",
    labelKey: "layer.vilDensity",
    detailKey: "layers.vilDensityDetail",
    icon: Droplets,
  },
  {
    key: "vii",
    labelKey: "layer.vii",
    detailKey: "layers.viiDetail",
    icon: Snowflake,
  },
  {
    key: "echoTops",
    labelKey: "layer.echoTops",
    detailKey: "layers.echoTopsDetail",
    icon: MoveUp,
  },
  {
    key: "vil",
    labelKey: "layer.vil",
    detailKey: "layers.vilDetail",
    icon: Droplets,
  },
  {
    key: "precipRate",
    labelKey: "layer.precipRate",
    detailKey: "layers.precipRateDetail",
    icon: CloudRain,
  },
  {
    key: "qpeHour",
    labelKey: "layer.qpeHour",
    detailKey: "layers.qpeHourDetail",
    icon: Umbrella,
  },
  {
    key: "qpeDay",
    labelKey: "layer.qpeDay",
    detailKey: "layers.qpeDayDetail",
    icon: Umbrella,
  },
  {
    key: "counties",
    labelKey: "layer.counties",
    detailKey: "layers.countiesDetail",
    icon: Map,
  },
  {
    key: "gaugeQpe",
    labelKey: "layer.gaugeQpe",
    detailKey: "layers.gaugeQpeDetail",
    icon: Umbrella,
  },
  {
    key: "ffgHour",
    labelKey: "layer.ffgHour",
    detailKey: "layers.ffgHourDetail",
    icon: Droplets,
  },
  {
    key: "ffgThreeHour",
    labelKey: "layer.ffgThreeHour",
    detailKey: "layers.ffgThreeHourDetail",
    icon: Droplets,
  },
  {
    key: "unitStreamflow",
    labelKey: "layer.unitStreamflow",
    detailKey: "layers.unitStreamflowDetail",
    icon: Waves,
  },
  {
    key: "precipType",
    labelKey: "layer.precipType",
    detailKey: "layers.precipTypeDetail",
    icon: Snowflake,
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
  layerNotes,
  overlayOpacity,
  onOverlayOpacity,
  overlayOrder,
  onOverlayOrder,
  overlayFiles,
  onOverlayFiles,
  onRemoved,
  alertTypes,
  surgeCategory,
  onLayers,
  onAlertTypes,
  onSurgeCategory,
  satelliteProduct,
  gaugeQpePeriod,
  onGaugeQpePeriod,
  rotationPeriod,
  onRotationPeriod,
  azShearLevel,
  onAzShearLevel,
  wpcDay,
  onWpcDay,
  wssiDay,
  onWssiDay,
  onSatelliteProduct,
  onClose,
}: LayersPanelProps) {
  const t = useT();
  // What the list holds now, for an undo pressed after the reader has already
  // moved on. The closure that offers it was made when the file went.
  const filesRef = useRef(overlayFiles);
  useEffect(() => {
    filesRef.current = overlayFiles;
  }, [overlayFiles]);
  // The overlays that are switched on and can be moved, bottom first.
  // Warnings are not among them: nothing should be able to put a wildfire
  // perimeter over somebody telling you to take cover.
  const arrangeable = overlayBandOrder(overlayOrder).filter(
    (overlayId) =>
      overlayId !== "alerts" &&
      OVERLAY_LAYERS.some(
        (entry) => entry.overlayId === overlayId && layers[entry.key],
      ),
  );
  const labelFor = (overlayId: string): StringKey =>
    OVERLAY_LAYERS.find((entry) => entry.overlayId === overlayId)?.labelKey ??
    "layer.weatherAlerts";

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
              {/* What went wrong, where the reader switched it on. A layer
                  that fails silently looks like a quiet afternoon, which for
                  a layer somebody might act on is the worst thing it could
                  look like. */}
              {layers[key] && layerNotes?.[key] ? (
                <small className="toggle-row__note">{layerNotes[key]}</small>
              ) : (
                <small>{t(detailKey)}</small>
              )}
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
      {arrangeable.length > 1 ? (
        <div className="settings-section" data-overlay-order>
          <div className="settings-section__title">
            <span>{t("layers.order")}</span>
            <small>{t("layers.orderDetail")}</small>
          </div>
          <ol role="list" className="layer-order">
            {[...arrangeable].reverse().map((overlayId, shown) => {
              const label = t(labelFor(overlayId));
              // Shown top first, which is how somebody thinks about what is
              // over what, while the list itself is stored bottom first.
              const at = arrangeable.length - 1 - shown;
              const move = (to: number) => {
                const next = [...arrangeable];
                const [taken] = next.splice(at, 1);
                next.splice(to, 0, taken);
                onOverlayOrder(next);
              };
              return (
                <li key={overlayId} data-overlay={overlayId}>
                  <span>{label}</span>
                  <button
                    type="button"
                    aria-label={t("layers.moveUp", { layer: label })}
                    disabled={at === arrangeable.length - 1}
                    onClick={() => move(at + 1)}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("layers.moveDown", { layer: label })}
                    disabled={at === 0}
                    onClick={() => move(at - 1)}
                  >
                    <ChevronDown size={15} />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {layers.customOverlay ? (
        <div className="settings-section" data-overlay-files>
          <div className="settings-section__title">
            <span>{t("layers.files")}</span>
            <small>{t("layers.filesDetail")}</small>
          </div>
          {overlayFiles.length ? (
            <ol role="list" className="overlay-files">
              {/* Top first, the way somebody thinks about what is over what,
                  while the list itself is held bottom first. */}
              {[...overlayFiles].reverse().map((file, shown) => {
                const at = overlayFiles.length - 1 - shown;
                const solid = Math.round(file.opacity * 100);
                const patch = (change: Partial<WorkspaceOverlayFile>) =>
                  onOverlayFiles(
                    overlayFiles.map((each) =>
                      each.id === file.id ? { ...each, ...change } : each,
                    ),
                  );
                return (
                  <li key={file.id} data-overlay-file={file.id}>
                    <div className="overlay-files__row">
                      <label className="overlay-files__name">
                        <input
                          type="checkbox"
                          checked={file.enabled}
                          aria-label={t("layers.fileShown", {
                            name: file.name,
                          })}
                          onChange={(event) =>
                            patch({ enabled: event.target.checked })
                          }
                        />
                        <i className="toggle-track" aria-hidden="true" />
                        <span>
                          <strong>{file.name}</strong>
                          <small>
                            {t("layers.fileShapes", {
                              count: overlayShapeCount(file.shapes),
                            })}
                          </small>
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label={t("layers.moveUp", { layer: file.name })}
                        disabled={at === overlayFiles.length - 1}
                        onClick={() =>
                          onOverlayFiles(
                            moveOverlayFile(overlayFiles, file.id, at + 1),
                          )
                        }
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("layers.moveDown", { layer: file.name })}
                        disabled={at === 0}
                        onClick={() =>
                          onOverlayFiles(
                            moveOverlayFile(overlayFiles, file.id, at - 1),
                          )
                        }
                      >
                        <ChevronDown size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("layers.fileRemove", {
                          name: file.name,
                        })}
                        onClick={() => {
                          onOverlayFiles(
                            overlayFiles.filter((each) => each.id !== file.id),
                          );
                          onRemoved({
                            title: t("layers.fileRemoved", {
                              name: file.name,
                            }),
                            detail: t("layers.fileRemovedBody"),
                            // This one file, back at the height it was drawn
                            // at, into the list as it stands when the undo is
                            // pressed. Restoring the list as it was would take
                            // back whatever the reader did in between: remove
                            // A, reorder B, undo A, and B moves too.
                            undo: () => {
                              const back = [...filesRef.current];
                              if (back.some((each) => each.id === file.id)) {
                                return;
                              }
                              back.splice(Math.min(at, back.length), 0, file);
                              onOverlayFiles(back);
                            },
                          });
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <label className="range-row">
                      <span>
                        <output>{solid}%</output>
                      </span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        style={rangeFill(solid, 10, 100)}
                        aria-label={t("layers.opacityFor", {
                          layer: file.name,
                          percent: solid,
                        })}
                        value={solid}
                        onChange={(event) =>
                          patch({ opacity: Number(event.target.value) / 100 })
                        }
                      />
                    </label>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="source-note">{t("layers.filesNone")}</p>
          )}
        </div>
      ) : null}

      {OVERLAY_LAYERS.some(({ key }) => layers[key]) ? (
        <div className="settings-section" data-overlay-opacity>
          <div className="settings-section__title">
            <span>{t("layers.opacity")}</span>
            <small>{t("layers.opacityDetail")}</small>
          </div>
          {OVERLAY_LAYERS.filter(({ key }) => layers[key]).map(
            ({ overlayId, labelKey }) => {
              const solid = Math.round((overlayOpacity[overlayId] ?? 1) * 100);
              return (
                <label className="range-row" key={overlayId}>
                  <span>
                    <strong>{t(labelKey)}</strong>
                    <output>{solid}%</output>
                  </span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    style={rangeFill(solid, 10, 100)}
                    aria-label={t("layers.opacityFor", {
                      layer: t(labelKey),
                      percent: solid,
                    })}
                    value={solid}
                    onChange={(event) => {
                      const next = { ...overlayOpacity };
                      const asked = Number(event.target.value) / 100;
                      // Full is the default, so it is stored as nothing.
                      if (asked >= 1) delete next[overlayId];
                      else next[overlayId] = asked;
                      onOverlayOpacity(next);
                    }}
                  />
                </label>
              );
            },
          )}
        </div>
      ) : null}

      {layers.weatherAlerts ? (
        <div className="settings-section" data-alert-kinds>
          <div className="settings-section__title">
            <span>{t("alerts.kinds")}</span>
            <small>{t("alerts.kindsDetail")}</small>
          </div>
          {ALERT_TYPES.map(({ id, key, detailKey }) => (
            <label className="toggle-row toggle-row--plain" key={id}>
              <span>
                <strong>{t(key)}</strong>
                {/* What the switch actually covers. Grouping is by hazard, so
                    a switch holds products whose names do not resemble its
                    own, and switching one off has to be a decision the reader
                    could have made knowingly. */}
                <small>{t(detailKey)}</small>
              </span>
              <input
                type="checkbox"
                // A kind nobody has touched is on, so only the ones switched
                // off are kept and a kind added later arrives switched on.
                checked={alertTypes[id] !== false}
                onChange={(event) => {
                  const next = { ...alertTypes };
                  if (event.target.checked) delete next[id];
                  else next[id] = false;
                  onAlertTypes(next);
                }}
              />
              <i className="toggle-track" aria-hidden="true" />
            </label>
          ))}
        </div>
      ) : null}

      {layers.satellite ? (
        <div
          className="settings-section"
          data-satellite-product={satelliteProduct}
        >
          <div className="settings-section__title">
            <span>{t("satellite.product")}</span>
            <small>
              {t(
                SATELLITE_PRODUCTS.find(
                  (product) => product.id === satelliteProduct,
                )?.detailKey ?? "satellite.geocolorDetail",
              )}
            </small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("satellite.product")}
          >
            {SATELLITE_PRODUCTS.map((product) => (
              <button
                key={product.id}
                type="button"
                className={satelliteProduct === product.id ? "is-active" : ""}
                aria-pressed={satelliteProduct === product.id}
                onClick={() => onSatelliteProduct(product.id)}
              >
                {t(product.key)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.wpcExcessiveRain ? (
        <div className="settings-section" data-wpc-day={wpcDay}>
          <div className="settings-section__title">
            <span>{t("layers.wpcDay")}</span>
            <small>{t("layers.wpcExcessiveRainDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.wpcDay")}
          >
            {ERO_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={wpcDay === day ? "is-active" : ""}
                aria-pressed={wpcDay === day}
                onClick={() => onWpcDay(day)}
              >
                {t("layers.outlookDay", { day })}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.wpcWinterSeverity ? (
        <div className="settings-section" data-wssi-day={wssiDay}>
          <div className="settings-section__title">
            <span>{t("layers.wssiDay")}</span>
            <small>{t("wpc.wssiNote")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.wssiDay")}
          >
            {WSSI_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={wssiDay === day ? "is-active" : ""}
                aria-pressed={wssiDay === day}
                onClick={() => onWssiDay(day)}
              >
                {t("layers.outlookDay", { day })}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.rotationTracks ? (
        <div className="settings-section" data-rotation-period={rotationPeriod}>
          <div className="settings-section__title">
            <span>{t("layers.rotationPeriod")}</span>
            <small>{t("layers.rotationDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.rotationPeriod")}
          >
            {ROTATION_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                className={rotationPeriod === period ? "is-active" : ""}
                aria-pressed={rotationPeriod === period}
                onClick={() => onRotationPeriod(period)}
              >
                {t(`rotationPeriod.${period}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.azShear ? (
        <div className="settings-section" data-az-shear-level={azShearLevel}>
          <div className="settings-section__title">
            <span>{t("layers.azShearLevel")}</span>
            {/* What the number on the map means, rather than only what it is.
                Per slab, because the threshold is not the same one: it was
                written for the mid-level and was being shown unchanged while
                the low one was drawn. */}
            {/* Both keys written out rather than built from the level, so
                the catalogue coverage gate can see them: a key assembled on a
                prefix is one nothing proves is still used. */}
            <small>
              {azShearLevel === "mid"
                ? t("azShearLevel.midNote")
                : t("azShearLevel.lowNote")}
            </small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.azShearLevel")}
          >
            {AZ_SHEAR_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={azShearLevel === level ? "is-active" : ""}
                aria-pressed={azShearLevel === level}
                onClick={() => onAzShearLevel(level)}
              >
                {t(`azShearLevel.${level}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.gaugeQpe ? (
        <div
          className="settings-section"
          data-gauge-qpe-period={gaugeQpePeriod}
        >
          <div className="settings-section__title">
            <span>{t("layers.gaugeQpePeriod")}</span>
            <small>{t("layers.gaugeQpeDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            aria-label={t("layers.gaugeQpePeriod")}
          >
            {GAUGE_QPE_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                className={gaugeQpePeriod === period ? "is-active" : ""}
                aria-pressed={gaugeQpePeriod === period}
                onClick={() => onGaugeQpePeriod(period)}
              >
                {t(`gaugeQpe.${period}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
          <ol role="list" className="surge-ramp">
            {SURGE_RAMP.map(([color, feet, over]) => (
              <li key={color}>
                <i style={{ background: color }} aria-hidden="true" />
                {surgeDepthLabel(feet, over)}
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
  bounds?: PackBounds | null;
  onSettings: (settings: AppSettings) => void;
  onSendWatchTest: () => void;
  /**
   * Whether the watch is still hearing back from the service.
   *
   * The watch is the one thing in the app that runs whether or not anybody
   * is looking, so it is the one thing that has to say when it has stopped.
   */
  watchHealth?: WatchHealth;
  /** What the chrome is drawing, so the switch can name its source. */
  ambient: AmbientState;
  /** The record was written to a file, at this path when there is one. */
  /** A backup chosen from the picker, read by the same reader Upload uses. */
  onImportSettings: (file: File) => void;
  onJournalSaved: (path: string | null) => void;
  onJournalFailed: (why: string) => void;
  /** How much came back from emptying the cache, already in words. */
  onStorageCleared: (freed: string) => void;
  onStorageFailed: (why: string) => void;
  onJournalCleared: (undo: () => void) => void;
  onJournalRemoved: (undo: () => void) => void;
  /** Something the reader removed here, and the way back to it. */
  onRemoved: (removal: UndoableRemoval) => void;
  /**
   * Whether the app is registered to start with the machine, or `null` when
   * nobody can say: a browser preview, or a machine that refused to answer.
   *
   * Not a setting. The registry entry is what decides what happens at the
   * next boot, so it is read from the machine rather than stored.
   */
  autostart: boolean | null;
  onAutostart: (on: boolean) => void;
  /** Ticks once a minute, so the record on screen notices a row arriving. */
  clock: number;
  onWatchHere: () => void;
  /** Adds the map centre as another watched place. */
  onAddWatchPlace: () => void;
  onReset: () => void;
  onExportSettings: () => Promise<void>;
  /** Asks for a sound file of the reader's own, or leaves it as it was. */
  onChooseSound: () => Promise<void>;
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

/**
 * What the colour control shows before anybody has chosen anything.
 *
 * The built-in accent per theme, copied from the LAST accent declaration in
 * `index.css` rather than the first: the stylesheet sets it twice and the
 * later pair is what a reader is looking at. A colour input has no "unset"
 * state, so it has to open on something, and opening on the colour actually
 * on screen is the only honest choice, so `theme.test.ts` holds these two in
 * step with the stylesheet.
 */
const BUILT_IN_ACCENT: Record<AppSettings["theme"], string> = {
  dark: "#4bc0ff",
  light: "#0879b8",
};

export function SettingsPanel({
  settings,
  bounds = null,
  onSettings,
  ambient,
  onImportSettings,
  onJournalSaved,
  onJournalFailed,
  onStorageCleared,
  onStorageFailed,
  onJournalCleared,
  onJournalRemoved,
  onRemoved,
  autostart,
  onAutostart,
  clock,
  onSendWatchTest,
  watchHealth = WATCH_HEALTHY,
  onWatchHere,
  onAddWatchPlace,
  onReset,
  onExportSettings,
  onChooseSound,
  onClose,
}: SettingsPanelProps) {
  const t = useT();
  // The settings as they stand, for an undo pressed after the reader has
  // changed something else. The closure offering it was made when the thing
  // went, so reading `settings` there would put its whole snapshot back.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  // Whether the system has taken the colours over, which is not a preference
  // this app can honour halfway.
  const forcedColours = useForcedColours();
  // Whether the machine can reach anything at all, which is a different
  // answer from whether a service is answering.
  const offlineSince = useOfflineSince();

  // Asked once: whether this machine can have its wallpaper set cannot change
  // while the app is running. Null until the answer comes back, so the
  // control neither promises nor refuses before it knows.
  const [wallpaperOk, setWallpaperOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void wallpaperAvailable().then((ok) => {
      if (alive) setWallpaperOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const accent = themeAccent(settings.workspaceTheme);

  // The watched radius is stored in miles, which is what the watch works in,
  // and read in whatever the reader reads in.
  const radiusSlider = distanceSlider(5, 200);
  const radiusShown = Math.min(
    radiusSlider.max,
    Math.max(
      radiusSlider.min,
      Math.round(
        distanceValue(settings.watch.radiusMiles) / radiusSlider.step,
      ) * radiusSlider.step,
    ),
  );
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
            disabled={forcedColours}
            onClick={() => onSettings({ ...settings, theme: "dark" })}
          >
            {t("settings.dark")}
          </button>
          <button
            type="button"
            className={settings.theme === "light" ? "is-active" : ""}
            aria-pressed={settings.theme === "light"}
            disabled={forcedColours}
            onClick={() => onSettings({ ...settings, theme: "light" })}
          >
            {t("settings.light")}
          </button>
        </div>
        {/* A contrast theme repaints everything in the system's own colours,
            so neither of those buttons would draw anything. Said out loud
            rather than left as two buttons that quietly do nothing. */}
        {forcedColours ? (
          <p className="source-note" data-forced-colours>
            {t("settings.systemColours")}
          </p>
        ) : null}
        <label className="accent-row">
          <span>
            <strong>{t("settings.accent")}</strong>
            <small>{t("settings.accentDetail")}</small>
          </span>
          <input
            type="color"
            value={accent ?? BUILT_IN_ACCENT[settings.theme]}
            aria-label={t("settings.accent")}
            onChange={(event) =>
              onSettings({
                ...settings,
                workspaceTheme:
                  themeFromAccent(
                    event.target.value,
                    settings.theme,
                    t("settings.accent"),
                  ) ?? settings.workspaceTheme,
              })
            }
          />
        </label>
        <ToggleSetting
          label={t("settings.ambient")}
          detail={t("settings.ambientDetail")}
          checked={settings.ambient}
          onChange={(on) => onSettings({ ...settings, ambient: on })}
        />
        {/* The source and the age, where the reader turned it on. An effect
            driven by an observation nobody can name is decoration pretending
            to be data. */}
        {settings.ambient ? (
          <p className="source-note">
            {!settings.watch.enabled
              ? // Nothing is fetched at all without one, so saying no station
                // is reporting weather would be a claim about the sky rather
                // than about the setting.
                t("settings.ambientNeedsWatch")
              : ambient.dropped
                ? t("settings.ambientDropped")
                : ambient.seen
                  ? t("settings.ambientSeen", {
                      station: ambient.seen.station,
                      when: formatClock(ambient.seen.observed),
                    })
                  : t("settings.ambientQuiet")}
          </p>
        ) : null}
        <div className="settings-field" data-ambient-screen-setting>
          <span>
            <strong>{t("ambientScreen.setting")}</strong>
            <small>{t("ambientScreen.settingDetail")}</small>
          </span>
          <label className="settings-field">
            <span>{t("ambientScreen.idle")}</span>
            <select
              value={String(settings.ambientIdleMinutes)}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  ambientIdleMinutes: Number(event.target.value),
                })
              }
            >
              {/* Never, by default. A workspace that takes itself over while
                  somebody is reading is a workspace they stop leaving open. */}
              <option value="0">{t("ambientScreen.idleOff")}</option>
              {[5, 15, 30, 60].map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {t("ambientScreen.idleMinutes", { minutes })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ToggleSetting
          label={t("tray.setting")}
          detail={t("tray.settingDetail")}
          checked={settings.tray}
          onChange={(tray) => onSettings({ ...settings, tray })}
        />
        {/* Only with the icon on. The entry opens the app to the tray, and
            with no icon there is nothing for it to open to: the switch says so
            rather than registering something that would start a window across
            the reader's screen at every boot. */}
        <div className="settings-field" data-autostart-setting>
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("autostart.setting")}</strong>
              <small>
                {!settings.tray
                  ? t("autostart.needsTray")
                  : autostart === null
                    ? t("autostart.unavailable")
                    : t("autostart.settingDetail")}
              </small>
            </span>
            <input
              type="checkbox"
              // The entry, not the reader's intent. With the icon off the
              // switch cannot be moved, and drawing a registered entry as off
              // would say the app will not start with the machine when it
              // will: it starts, and shows its window, because there is no
              // icon for it to open to.
              checked={autostart === true}
              disabled={!settings.tray || autostart === null}
              onChange={(event) => onAutostart(event.target.checked)}
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {settings.tray ? (
          <>
            <ToggleSetting
              label={t("tray.closeToTray")}
              detail={t("tray.closeToTrayDetail")}
              checked={settings.closeToTray}
              onChange={(closeToTray) =>
                onSettings({ ...settings, closeToTray })
              }
            />
            <ToggleSetting
              label={t("glance.onTop")}
              detail={t("glance.settingDetail")}
              checked={settings.glanceOnTop}
              onChange={(glanceOnTop) =>
                onSettings({ ...settings, glanceOnTop })
              }
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => void openGlance()}
            >
              {t("glance.setting")}
            </button>
          </>
        ) : null}
        {/* Windows only for now, and it says so rather than offering a
            control that would quietly do nothing. */}
        <div className="settings-field" data-wallpaper-setting>
          <span>
            <strong>{t("wallpaper.setting")}</strong>
            <small>
              {wallpaperOk === false
                ? t("wallpaper.unavailable")
                : t("wallpaper.settingDetail")}
            </small>
          </span>
          <label className="settings-field">
            <span>{t("wallpaper.every")}</span>
            <select
              value={String(settings.wallpaperMinutes)}
              disabled={wallpaperOk === false}
              onChange={(event) =>
                onSettings({
                  ...settings,
                  wallpaperMinutes: Number(event.target.value),
                })
              }
            >
              <option value="0">{t("wallpaper.never")}</option>
              {WALLPAPER_EVERY.filter((every) => every > 0).map((every) => (
                <option key={every} value={String(every)}>
                  {t("wallpaper.everyMinutes", { minutes: every })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ToggleSetting
          label={t("calm.setting")}
          detail={t("calm.settingDetail")}
          checked={settings.calm}
          onChange={(calm) =>
            onSettings(
              calm
                ? putSpeculationAway(settings)
                : giveSpeculationBack(settings),
            )
          }
        />
        <ToggleSetting
          label={t("curiosity.setting")}
          detail={t("curiosity.settingDetail")}
          checked={settings.curiosities}
          onChange={(curiosities) => onSettings({ ...settings, curiosities })}
        />
        <ToggleSetting
          label={t("catchUp.setting")}
          detail={t("catchUp.settingDetail")}
          checked={settings.catchUp}
          onChange={(catchUp) => onSettings({ ...settings, catchUp })}
        />
        <ToggleSetting
          label={t("settings.almanac")}
          detail={t("settings.almanacDetail")}
          checked={settings.almanac}
          onChange={(almanac) => onSettings({ ...settings, almanac })}
        />
        <ToggleSetting
          label={t("settings.occasions")}
          detail={t("settings.occasionsDetail")}
          checked={settings.occasions.enabled}
          onChange={(enabled) =>
            onSettings({
              ...settings,
              occasions: { ...settings.occasions, enabled },
            })
          }
        />
        {settings.workspaceTheme ? (
          <>
            <p className="source-note">
              {t("settings.themeInForce", {
                name: settings.workspaceTheme.name,
              })}
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                const removed = settings.workspaceTheme;
                onSettings({ ...settings, workspaceTheme: null });
                if (!removed) return;
                onRemoved({
                  title: t("settings.themeRemoved", { name: removed.name }),
                  detail: t("settings.themeRemovedBody"),
                  // Only the theme, put back over whatever else the reader
                  // changed while the toast was up.
                  undo: () =>
                    onSettings({
                      ...settingsRef.current,
                      workspaceTheme: removed,
                    }),
                });
              }}
            >
              {t("settings.themeClear")}
            </button>
          </>
        ) : (
          <p className="source-note">{t("settings.themeNote")}</p>
        )}
      </div>

      <JournalSection
        clock={clock}
        writing={settings.journal}
        onWriting={(journal) => onSettings({ ...settings, journal })}
        onSaved={(path) => onJournalSaved(path)}
        onFailed={(why) => onJournalFailed(why)}
        onCleared={onJournalCleared}
        onRemoved={onJournalRemoved}
      />

      {settings.curiosities ? (
        <CuriositySection
          found={settings.curiositiesFound}
          onForget={() => onSettings({ ...settings, curiositiesFound: [] })}
        />
      ) : null}

      <RecapSection
        clock={clock}
        onSaved={(path) => onJournalSaved(path)}
        onFailed={(why) => onJournalFailed(why)}
      />

      <IncidentPackManager
        settings={settings}
        bounds={bounds}
        onSettings={onSettings}
        onRemoved={onRemoved}
      />

      <StorageSection
        onCleared={(freed) => onStorageCleared(freed)}
        onFailed={(why) => onStorageFailed(why)}
      />

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
          <span>{t("settings.backup")}</span>
          <small>{t("settings.backupDetail")}</small>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void onExportSettings()}
        >
          {t("settings.export")}
        </button>
        {/* Beside Export, because the pair is the point. Restoring one worked
            already, by knowing to drop the file on the Upload panel, which
            nothing here said. The file goes through the very same reader, so
            a partial restore says so and the undo is the same undo. */}
        <label className="secondary-button settings-import">
          <span>{t("settings.import")}</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportSettings(file);
              // Cleared so choosing the same file twice is two imports.
              event.target.value = "";
            }}
          />
        </label>
        {/* Somebody who wants the greeting back can have it. Shown once is a
            rule about not repeating myself, not a rule about never again. */}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onSettings({ ...settings, seenWelcome: false, seenReveal: false })
          }
        >
          {t("opening.showAgain")}
        </button>
        <p className="source-note">{t("opening.showAgainDetail")}</p>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.units")}</span>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label={t("settings.units")}
        >
          {(["imperial", "metric"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={settings.units === option ? "is-active" : ""}
              aria-pressed={settings.units === option}
              onClick={() => onSettings({ ...settings, units: option })}
            >
              {option === "imperial"
                ? t("settings.unitsImperial")
                : t("settings.unitsMetric")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.clock")}</span>
          <small>{t("settings.clockDetail")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label={t("settings.clock")}
        >
          {(["local", "utc"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={settings.clock === option ? "is-active" : ""}
              aria-pressed={settings.clock === option}
              onClick={() => onSettings({ ...settings, clock: option })}
            >
              {option === "local"
                ? t("settings.clockLocal")
                : t("settings.clockUtc")}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">
          <span>{t("settings.textSize")}</span>
          <small>{t("settings.textSizeDetail")}</small>
        </div>
        <div
          className="segmented-control segmented-control--full"
          aria-label={t("settings.textSize")}
        >
          {TEXT_SCALES.map((option) => (
            <button
              key={option}
              type="button"
              className={settings.textScale === option ? "is-active" : ""}
              aria-pressed={settings.textScale === option}
              onClick={() => onSettings({ ...settings, textScale: option })}
            >
              {option}%
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
            style={rangeFill(settings.radar.opacity, 0.05, 1)}
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
            <output>{formatNumber(settings.radar.animationSpeed, 1)}</output>
          </span>
          <input
            type="range"
            min="-0.8"
            max="0.5"
            step="0.1"
            style={rangeFill(settings.radar.animationSpeed, -0.8, 0.5)}
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
            style={rangeFill(settings.radar.loopMinutes, 60, 120)}
            aria-label={t("settings.loopLengthLabel")}
            value={settings.radar.loopMinutes}
            onChange={(event) =>
              updateRadar({ loopMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label className="range-row">
          <span>
            <strong>{t("settings.siteLoopLength")}</strong>
            <output>
              {t("settings.volumes", { count: settings.radar.loopVolumes })}
            </output>
          </span>
          <input
            type="range"
            min={MIN_LOOP_VOLUMES}
            max={MAX_LOOP_VOLUMES}
            step="1"
            style={rangeFill(
              settings.radar.loopVolumes,
              MIN_LOOP_VOLUMES,
              MAX_LOOP_VOLUMES,
            )}
            aria-label={t("settings.siteLoopLengthLabel")}
            value={settings.radar.loopVolumes}
            onChange={(event) =>
              updateRadar({ loopVolumes: Number(event.target.value) })
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
        {/* Home is a coordinate pair until somebody calls it something, and
            a place with a name is the difference between a viewer and a
            workspace. It is a label and nothing else: nothing about what is
            polled, or how often, reads it. */}
        <label className="watch-place__name">
          <span>{t("settings.homeName")}</span>
          <input
            type="text"
            maxLength={60}
            value={settings.watch.name ?? ""}
            placeholder={t("watch.home")}
            aria-label={t("settings.homeName")}
            onChange={(event) =>
              onSettings({
                ...settings,
                watch: { ...settings.watch, name: event.target.value },
              })
            }
          />
        </label>
        <ToggleSetting
          label={t("alerts.sound")}
          detail={t("alerts.soundDetail")}
          checked={settings.watch.sound}
          onChange={(sound) =>
            onSettings({ ...settings, watch: { ...settings.watch, sound } })
          }
        />
        {settings.watch.sound ? (
          <>
            <label className="range-row">
              <span>
                <strong>{t("alerts.volume")}</strong>
                <output>
                  {t("alerts.volumeValue", {
                    percent: Math.round(settings.alertVolume * 100),
                  })}
                </output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                style={rangeFill(
                  Math.round(settings.alertVolume * 100),
                  0,
                  100,
                )}
                value={Math.round(settings.alertVolume * 100)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    alertVolume: Number(event.target.value) / 100,
                  })
                }
              />
            </label>
            <div className="sound-kit">
              {/* Heard before it is committed to. A sound somebody has not
                  heard is a sound they find out about during a warning,
                  which is the worst moment to discover it is wrong. */}
              <p className="source-note">{t("alerts.previewNote")}</p>
              <div className="sound-kit__row">
                {(["minor", "moderate", "severe", "extreme"] as const).map(
                  (severity) => (
                    <button
                      key={severity}
                      type="button"
                      className="secondary-button"
                      data-sound-preview={severity}
                      onClick={() =>
                        void playAlertTone(severity, { preview: true })
                      }
                    >
                      <Volume2 size={14} /> {t(`alerts.severity.${severity}`)}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="sound-kit">
              <p className="source-note">
                <strong>{t("alerts.soundFile")}</strong>
              </p>
              <p className="source-note">{t("alerts.soundFileDetail")}</p>
              {settings.alertSoundPath ? (
                <p className="source-note" data-alert-sound-path>
                  {settings.alertSoundPath}
                </p>
              ) : null}
              <div className="sound-kit__row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onChooseSound()}
                >
                  {t("alerts.soundFileChoose")}
                </button>
                {settings.alertSoundPath ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const removed = settings.alertSoundPath;
                      onSettings({ ...settings, alertSoundPath: null });
                      if (!removed) return;
                      onRemoved({
                        title: t("alerts.soundFileRemoved"),
                        detail: t("alerts.soundFileRemovedBody"),
                        undo: () =>
                          onSettings({
                            ...settingsRef.current,
                            alertSoundPath: removed,
                          }),
                      });
                    }}
                  >
                    {t("alerts.soundFileClear")}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
        <ToggleSetting
          label={t("watch.followNew")}
          detail={t("watch.followNewDetail")}
          checked={settings.followNewWarnings}
          onChange={(followNewWarnings) =>
            onSettings({ ...settings, followNewWarnings })
          }
        />
        <label className="range-row">
          <span>
            <strong>{t("settings.radius")}</strong>
            <output>
              {t("settings.radiusValue", {
                distance: formatDistance(milesFromDistance(radiusShown)),
              })}
            </output>
          </span>
          <input
            type="range"
            // The slider steps in whatever the reader is reading in, so a
            // metric reader gets round numbers of kilometres rather than the
            // eight, sixteen and twenty-four that stepping in miles produces.
            min={radiusSlider.min}
            max={radiusSlider.max}
            step={radiusSlider.step}
            style={rangeFill(radiusShown, radiusSlider.min, radiusSlider.max)}
            aria-label={t("settings.radiusLabel", { unit: distanceUnit() })}
            // Snapped to the slider's own stops, so the thumb and the readout
            // beside it cannot disagree about where it is.
            value={radiusShown}
            onChange={(event) =>
              onSettings({
                ...settings,
                watch: {
                  ...settings.watch,
                  // Stored in miles, which is what the watch works in.
                  radiusMiles: milesFromDistance(Number(event.target.value)),
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
        <ToggleSetting
          label={t("watch.quiet")}
          detail={t("watch.quietDetail")}
          checked={settings.watch.quietHours.enabled}
          onChange={(enabled) =>
            onSettings({
              ...settings,
              watch: {
                ...settings.watch,
                quietHours: { ...settings.watch.quietHours, enabled },
              },
            })
          }
        />
        {settings.watch.quietHours.enabled && (
          <div className="quiet-hours">
            <label>
              <span>{t("watch.quietFrom")}</span>
              <input
                type="time"
                value={minuteToTime(settings.watch.quietHours.startMinute)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        startMinute: timeToMinute(
                          event.target.value,
                          settings.watch.quietHours.startMinute,
                        ),
                      },
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t("watch.quietUntil")}</span>
              <input
                type="time"
                value={minuteToTime(settings.watch.quietHours.endMinute)}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        endMinute: timeToMinute(
                          event.target.value,
                          settings.watch.quietHours.endMinute,
                        ),
                      },
                    },
                  })
                }
              />
            </label>
            <label>
              <span>{t("watch.quietOverride")}</span>
              <select
                value={settings.watch.quietHours.overrideSeverity}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    watch: {
                      ...settings.watch,
                      quietHours: {
                        ...settings.watch.quietHours,
                        overrideSeverity: event.target
                          .value as WatchState["quietHours"]["overrideSeverity"],
                      },
                    },
                  })
                }
              >
                <option value="extreme">{t("alerts.severity.extreme")}</option>
                <option value="severe">{t("alerts.severity.severe")}</option>
                <option value="moderate">
                  {t("alerts.severity.moderate")}
                </option>
              </select>
            </label>
          </div>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={onSendWatchTest}
        >
          <BellRing size={16} /> {t("watch.sendTest")}
        </button>
        <p className="source-note">{t("watch.sendTestDetail")}</p>
        <p className="source-note">
          {t("settings.watching", {
            lat: formatNumber(settings.watch.center[1], 2),
            lon: formatNumber(settings.watch.center[0], 2),
          })}
        </p>
        {/* Whether it is actually working. The panel said it was watching
            whatever had happened, and a watch that had stopped reaching the
            service at two in the morning looked exactly like one that was
            hearing back every forty-five seconds. */}
        {watchHealth.lastCheckedAt !== null &&
        watchHealth.failing < WATCH_FAILURES_BEFORE_SAYING ? (
          <p className="source-note" data-watch-checked>
            {t("watch.lastChecked", {
              // The minute clock, not the wall clock: reading the time
              // during a render is impure, and this line only has to be
              // right to the minute.
              age: formatAge((clock - watchHealth.lastCheckedAt) / 60_000),
            })}
          </p>
        ) : null}
        {/* Why it is not reaching anything, when the answer is the machine
            rather than the service. "Not reaching the service for an hour"
            reads as a service that is down, and sends a reader looking in
            the wrong place. */}
        {offlineSince !== null ? (
          <p className="watch-not-reaching" data-watch-offline>
            {t("watch.cannotSee", {
              age: formatAge((clock - offlineSince) / 60_000),
            })}
          </p>
        ) : watchHealth.failing >= WATCH_FAILURES_BEFORE_SAYING &&
          watchHealth.failingSince !== null ? (
          <p className="watch-not-reaching" data-watch-failing>
            {t("watch.notReaching", {
              age: formatAge((clock - watchHealth.failingSince) / 60_000),
            })}
          </p>
        ) : null}

        {/* The places beside home. One point cannot be home, a school and the
            far end of tomorrow's drive, and a reader who wants all three
            should not have to pick. */}
        {/* No role when there is nothing in it: a list that owns no list
            items is a broken list rather than an empty one, and axe reports it
            as something it could not decide rather than as a failure, which
            every gate in the suite drops on the floor. */}
        <div
          className="watch-places"
          role={settings.watchPlaces.length ? "list" : undefined}
        >
          {settings.watchPlaces.map((place, index) => (
            <div className="watch-place" role="listitem" key={place.id}>
              <label className="watch-place__name">
                <span className="visually-hidden">
                  {t("settings.placeName")}
                </span>
                <input
                  type="text"
                  value={place.name}
                  maxLength={60}
                  aria-label={t("settings.placeName")}
                  onChange={(event) =>
                    onSettings({
                      ...settings,
                      watchPlaces: settings.watchPlaces.map((one, at) =>
                        at === index
                          ? { ...one, name: event.target.value }
                          : one,
                      ),
                    })
                  }
                />
              </label>
              <div className="watch-place__row">
                <label>
                  <span>{t("settings.radius", { unit: distanceUnit() })}</span>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={Math.round(distanceValue(place.radiusMiles))}
                    aria-label={t("settings.placeRadius", {
                      place: place.name,
                      unit: distanceUnit(),
                    })}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        watchPlaces: settings.watchPlaces.map((one, at) =>
                          at === index
                            ? {
                                ...one,
                                radiusMiles: milesFromDistance(
                                  Number(event.target.value),
                                ),
                              }
                            : one,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t("settings.placeSeverity")}</span>
                  <select
                    value={place.minSeverity}
                    aria-label={t("settings.placeSeverityFor", {
                      place: place.name,
                    })}
                    onChange={(event) =>
                      onSettings({
                        ...settings,
                        watchPlaces: settings.watchPlaces.map((one, at) =>
                          at === index
                            ? {
                                ...one,
                                minSeverity: event.target
                                  .value as WatchState["minSeverity"],
                              }
                            : one,
                        ),
                      })
                    }
                  >
                    <option value="extreme">
                      {t("alerts.severity.extreme")}
                    </option>
                    <option value="severe">
                      {t("alerts.severity.severe")}
                    </option>
                    <option value="moderate">
                      {t("alerts.severity.moderate")}
                    </option>
                    <option value="minor">{t("alerts.severity.minor")}</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label={t("settings.removePlace", { place: place.name })}
                  onClick={() => {
                    onSettings({
                      ...settings,
                      watchPlaces: settings.watchPlaces.filter(
                        (_, at) => at !== index,
                      ),
                    });
                    onRemoved({
                      title: t("settings.placeRemoved", { place: place.name }),
                      detail: t("settings.placeRemovedBody"),
                      // Back where it was in the list, into the list as it
                      // stands now, and not at all if it is already there.
                      undo: () => {
                        const now = settingsRef.current;
                        // By its own id, which is what a place is. Matching on
                        // the name and the point instead meant two places
                        // called the same thing at the same point could not
                        // both come back.
                        if (
                          now.watchPlaces.some((held) => held.id === place.id)
                        ) {
                          return;
                        }
                        // Home is the tenth, so the list itself holds nine.
                        if (now.watchPlaces.length >= MAX_WATCH_PLACES - 1) {
                          return;
                        }
                        const back = [...now.watchPlaces];
                        back.splice(Math.min(index, back.length), 0, place);
                        onSettings({ ...now, watchPlaces: back });
                      },
                    });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="source-note">
                {t("settings.watching", {
                  lat: formatNumber(place.center[1], 2),
                  lon: formatNumber(place.center[0], 2),
                })}
              </p>
            </div>
          ))}
        </div>
        {settings.watchPlaces.length < MAX_WATCH_PLACES - 1 ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onAddWatchPlace}
          >
            <Crosshair size={16} /> {t("settings.addPlace")}
          </button>
        ) : (
          <p className="source-note">
            {t("settings.placesFull", { count: MAX_WATCH_PLACES })}
          </p>
        )}
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
            <dd>{formatNumber(settings.camera.zoom, 2)}</dd>
          </div>
          <div>
            <dt>{t("settings.bearing")}</dt>
            <dd>{formatNumber(settings.camera.bearing, 1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.pitch")}</dt>
            <dd>{formatNumber(settings.camera.pitch, 1)}°</dd>
          </div>
          <div>
            <dt>{t("settings.center")}</dt>
            <dd>
              {formatNumber(settings.camera.center[1], 2)},{" "}
              {formatNumber(settings.camera.center[0], 2)}
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

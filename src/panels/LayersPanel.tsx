import {
  BellRing,
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
  Map,
  MapPin,
  MessageSquareWarning,
  MoveUp,
  RadioTower,
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
} from "lucide-react";
import { useEffect, useRef } from "react";
import { PanelShell } from "../components/PanelShell";
import { rangeFill } from "../lib/rangeFill";
import { GAUGE_QPE_PERIODS, type GaugeQpePeriod } from "../lib/gaugeQpe";
import {
  ISOTHERM_LEVELS,
  LIGHTNING_FORECASTS,
  LIGHTNING_JUMPS,
  LIGHTNING_WINDOWS,
  type IsothermLevel,
  type LightningForecast,
  type LightningJump,
  type LightningWindow,
} from "../lib/lightningGrids";
import {
  AZ_SHEAR_LEVELS,
  ROTATION_PERIODS,
  type AzShearLevel,
  type RotationPeriod,
} from "../lib/rotationTrack";
import type { LayerSettings } from "../lib/settings";
import {
  moveOverlayFile,
  overlayShapeCount,
  picturesWanted,
  type WorkspaceOverlayFile,
} from "../lib/workspaceOverlays";
import { MAX_DRAWN_PICTURES } from "../lib/placefile";
import { SPC_DAYS, SPC_HAZARDS } from "../lib/overlays/spc";
import type { SpcHazard } from "../lib/overlays/registry";
import type { UndoableRemoval } from "../components/ToastHost";
import { useT, type StringKey } from "../i18n";
import {
  SURGE_CATEGORIES,
  SURGE_RAMP,
  surgeDepthLabel,
  surgeCategoryKey,
  type SurgeCategory,
} from "../lib/surge";
import {
  bandFor,
  satelliteBand as satelliteBandInfo,
  satelliteBands,
  type SatelliteBandId,
  type Spacecraft,
} from "../lib/providers/satellite";
import { ALERT_TYPES, type AlertType } from "../lib/alertTypes";
import { overlayBandOrder } from "../lib/overlayOrder";
import { ERO_DAYS, WSSI_DAYS } from "../lib/overlays";

/** One key per hazard, written out so the copy gate can see every one. */
const HAZARD_LABELS = {
  categorical: "layers.spcCategorical",
  tornado: "layers.spcTornado",
  hail: "layers.spcHail",
  wind: "layers.spcWind",
} as const;

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

const SATELLITE_NAMES: Record<Spacecraft, StringKey> = {
  east: "satellite.east",
  west: "satellite.west",
  himawari: "satellite.himawari",
};

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
  /** Says the new order out loud, because moving a row shows nothing else. */
  onOrderSaid: (said: string) => void;
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
  satelliteBand: SatelliteBandId;
  /** Which satellite is over the middle of the view, worked out by the stage. */
  spacecraft: Spacecraft;
  onLayers: (layers: LayerSettings) => void;
  onAlertTypes: (types: Partial<Record<AlertType, boolean>>) => void;
  onSurgeCategory: (category: SurgeCategory) => void;
  onSatelliteBand: (band: SatelliteBandId) => void;
  gaugeQpePeriod: GaugeQpePeriod;
  onGaugeQpePeriod: (period: GaugeQpePeriod) => void;
  /** How far back the rotation track reaches. */
  rotationPeriod: RotationPeriod;
  onRotationPeriod: (period: RotationPeriod) => void;
  /** Which slab the merged shear is measured through. */
  azShearLevel: AzShearLevel;
  onAzShearLevel: (level: AzShearLevel) => void;
  /** Which of the lightning grids each of its three switches is showing. */
  lightningWindow: LightningWindow;
  onLightningWindow: (window: LightningWindow) => void;
  lightningForecastWindow: LightningForecast;
  onLightningForecastWindow: (window: LightningForecast) => void;
  lightningJumpWindow: LightningJump;
  onLightningJumpWindow: (window: LightningJump) => void;
  /** Which temperature the isothermal reflectivity is sampled at. */
  isothermLevel: IsothermLevel;
  onIsothermLevel: (level: IsothermLevel) => void;
  /** Which day of each of the two Weather Prediction Center outlooks. */
  wpcDay: number;
  spcDay: number;
  spcHazard: SpcHazard;
  onSpcDay: (day: number) => void;
  onSpcHazard: (hazard: SpcHazard) => void;
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
    key: "lightningForecast",
    labelKey: "layer.lightningForecast",
    detailKey: "layers.lightningForecastDetail",
    icon: Zap,
  },
  {
    key: "lightningJump",
    labelKey: "layer.lightningJump",
    detailKey: "layers.lightningJumpDetail",
    icon: Zap,
  },
  {
    key: "isothermReflectivity",
    labelKey: "layer.isothermReflectivity",
    detailKey: "layers.isothermReflectivityDetail",
    icon: Snowflake,
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
  onOrderSaid,
  overlayFiles,
  onOverlayFiles,
  onRemoved,
  alertTypes,
  surgeCategory,
  onLayers,
  onAlertTypes,
  onSurgeCategory,
  satelliteBand,
  spacecraft,
  gaugeQpePeriod,
  onGaugeQpePeriod,
  rotationPeriod,
  onRotationPeriod,
  azShearLevel,
  onAzShearLevel,
  lightningWindow,
  onLightningWindow,
  lightningForecastWindow,
  onLightningForecastWindow,
  lightningJumpWindow,
  onLightningJumpWindow,
  isothermLevel,
  onIsothermLevel,
  wpcDay,
  spcDay,
  spcHazard,
  onSpcDay,
  onSpcHazard,
  onWpcDay,
  wssiDay,
  onWssiDay,
  onSatelliteBand,
  onClose,
}: LayersPanelProps) {
  const t = useT();
  // What the satellite over the view will actually draw, which is not always
  // what the reader picked: Himawari carries three of the six bands.
  const drawnBand = bandFor(spacecraft, satelliteBand);
  const chosenBand = satelliteBandInfo(drawnBand);
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
              // Kept in the tab order and refused rather than disabled.
              // A button that disables itself under the focus drops it on
              // the body, so a reader moving a layer to the top lost their
              // place at the exact moment it arrived, and nothing said the
              // order had changed at all.
              const atTop = at === arrangeable.length - 1;
              const atBottom = at === 0;
              return (
                <li key={overlayId} data-overlay={overlayId}>
                  <span>{label}</span>
                  <button
                    type="button"
                    aria-label={t("layers.moveUp", { layer: label })}
                    aria-disabled={atTop}
                    onClick={() => {
                      if (atTop) return;
                      move(at + 1);
                      onOrderSaid(
                        t("layers.movedUp", {
                          layer: label,
                          other: t(labelFor(arrangeable[at + 1])),
                        }),
                      );
                    }}
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("layers.moveDown", { layer: label })}
                    aria-disabled={atBottom}
                    onClick={() => {
                      if (atBottom) return;
                      move(at - 1);
                      onOrderSaid(
                        t("layers.movedDown", {
                          layer: label,
                          other: t(labelFor(arrangeable[at - 1])),
                        }),
                      );
                    }}
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
          {picturesWanted(overlayFiles) > MAX_DRAWN_PICTURES ? (
            <p className="source-note">
              {t("layers.picturesCeiling", {
                count: picturesWanted(overlayFiles),
                drawn: MAX_DRAWN_PICTURES,
              })}
            </p>
          ) : null}
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
                        // The same words the output beside it shows. A
                        // screen reader reads the raw value otherwise, so a
                        // slider showing 35% announced 0.35.
                        aria-valuetext={`${solid}%`}
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
                    aria-valuetext={`${solid}%`}
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
        <div className="settings-section" data-satellite-band={satelliteBand}>
          <div className="settings-section__title">
            <span>{t("satellite.product")}</span>
            <small>{t(chosenBand.detailKey)}</small>
          </div>
          <div
            className="segmented-control"
            role="group"
            aria-label={t("satellite.product")}
          >
            {satelliteBands().map((band) => (
              <button
                key={band.id}
                type="button"
                className={satelliteBand === band.id ? "is-active" : ""}
                aria-pressed={satelliteBand === band.id}
                onClick={() => onSatelliteBand(band.id)}
              >
                {t(band.key)}
              </button>
            ))}
          </div>
          {/* Which satellite is looking at what is on screen, and what it
              does with a band it does not carry. The reader chose a band, not
              a spacecraft, so the panel is where the substitution is
              explained rather than leaving the map quietly showing something
              else. */}
          <p className="source-note">
            {t("satellite.showing", {
              satellite: t(SATELLITE_NAMES[spacecraft]),
            })}
          </p>
          {drawnBand === satelliteBand ? null : (
            <p className="source-note" data-satellite-substitute>
              {/* The band that was asked for, not the one it fell back to.
                  Named from the drawn band it read "Himawari has no Clean
                  infrared here, so this is clean infrared". */}
              {t("satellite.notThere", {
                satellite: t(SATELLITE_NAMES[spacecraft]),
                band: t(satelliteBandInfo(satelliteBand).key),
              })}
            </p>
          )}
        </div>
      ) : null}

      {layers.spcOutlooks ? (
        <div
          className="settings-section"
          data-spc-day={spcDay}
          data-spc-hazard={spcHazard}
        >
          <div className="settings-section__title">
            <span>{t("layers.spcOutlookChoice")}</span>
            <small>{t("layers.spcOutlookChoiceDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.spcDay")}
          >
            {SPC_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={spcDay === day ? "is-active" : ""}
                aria-pressed={spcDay === day}
                onClick={() => onSpcDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
          {/* Day 3 publishes two products, a categorical and one combined
              probability, and it used to have no control of its own: which
              one you got came from whichever hazard was last picked on Day 1
              or 2, with nothing on screen saying which was drawn. On the
              default that is categorical, so the Day 3 probability was
              unreachable from a fresh workspace. Days 4 to 8 publish one
              probability and genuinely have nothing to choose between. */}
          {spcDay <= 2 ? (
            <div
              className="segmented-control segmented-control--full"
              role="group"
              aria-label={t("layers.spcHazard")}
            >
              {SPC_HAZARDS.map((hazard) => (
                <button
                  key={hazard}
                  type="button"
                  className={spcHazard === hazard ? "is-active" : ""}
                  aria-pressed={spcHazard === hazard}
                  onClick={() => onSpcHazard(hazard)}
                >
                  {t(HAZARD_LABELS[hazard])}
                </button>
              ))}
            </div>
          ) : spcDay === 3 ? (
            <div
              className="segmented-control segmented-control--full"
              role="group"
              aria-label={t("layers.spcHazard")}
            >
              <button
                type="button"
                className={spcHazard === "categorical" ? "is-active" : ""}
                aria-pressed={spcHazard === "categorical"}
                onClick={() => onSpcHazard("categorical")}
              >
                {t(HAZARD_LABELS.categorical)}
              </button>
              <button
                type="button"
                className={spcHazard === "categorical" ? "" : "is-active"}
                aria-pressed={spcHazard !== "categorical"}
                // Day 3's probability is one combined number rather than one
                // per hazard, so any of the three hazards names it. Tornado
                // is chosen so switching back to Day 1 or 2 lands somewhere
                // a reader would recognise.
                onClick={() => onSpcHazard("tornado")}
              >
                {t("layers.spcDay3Probability")}
              </button>
            </div>
          ) : null}
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
            role="group"
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
            role="group"
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
            role="group"
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

      {layers.lightningDensity ? (
        <div
          className="settings-section"
          data-lightning-window={lightningWindow}
        >
          <div className="settings-section__title">
            <span>{t("layers.lightningWindow")}</span>
            <small>{t("layers.lightningWindowDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.lightningWindow")}
          >
            {LIGHTNING_WINDOWS.map((window) => (
              <button
                key={window}
                type="button"
                className={lightningWindow === window ? "is-active" : ""}
                aria-pressed={lightningWindow === window}
                onClick={() => onLightningWindow(window)}
              >
                {t(`lightningWindow.${window}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.lightningForecast ? (
        <div
          className="settings-section"
          data-lightning-forecast={lightningForecastWindow}
        >
          <div className="settings-section__title">
            <span>{t("layers.lightningForecastWindow")}</span>
            {/* That this is a forecast rather than a flash that has already
                struck, said where the reader chooses the window: a grid over
                ground nothing has hit yet reads as an observation otherwise. */}
            <small>{t("layers.lightningForecastWindowDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.lightningForecastWindow")}
          >
            {LIGHTNING_FORECASTS.map((window) => (
              <button
                key={window}
                type="button"
                className={
                  lightningForecastWindow === window ? "is-active" : ""
                }
                aria-pressed={lightningForecastWindow === window}
                onClick={() => onLightningForecastWindow(window)}
              >
                {t(`lightningForecast.${window}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.lightningJump ? (
        <div
          className="settings-section"
          data-lightning-jump={lightningJumpWindow}
        >
          <div className="settings-section__title">
            <span>{t("layers.lightningJumpWindow")}</span>
            {/* The number on the map is in standard deviations, and two of
                them is the threshold the Warning Decision Training Division
                teaches. Without that a reader has no scale to read it on. */}
            <small>{t("layers.lightningJumpWindowDetail")}</small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.lightningJumpWindow")}
          >
            {LIGHTNING_JUMPS.map((window) => (
              <button
                key={window}
                type="button"
                className={lightningJumpWindow === window ? "is-active" : ""}
                aria-pressed={lightningJumpWindow === window}
                onClick={() => onLightningJumpWindow(window)}
              >
                {t(`lightningJump.${window}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layers.isothermReflectivity ? (
        <div className="settings-section" data-isotherm-level={isothermLevel}>
          <div className="settings-section__title">
            <span>{t("layers.isothermLevel")}</span>
            {/* Both keys written out rather than built from the level, so the
                catalogue coverage gate can see them. */}
            <small>
              {isothermLevel === "minus10"
                ? t("layers.isothermLevelDetailMinus10")
                : t("layers.isothermLevelDetailMinus20")}
            </small>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.isothermLevel")}
          >
            {ISOTHERM_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={isothermLevel === level ? "is-active" : ""}
                aria-pressed={isothermLevel === level}
                onClick={() => onIsothermLevel(level)}
              >
                {t(`isothermLevel.${level}`)}
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
            role="group"
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
            role="group"
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
            role="group"
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

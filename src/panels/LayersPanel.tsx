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
  Moon,
  MapPin,
  MessageSquareWarning,
  MoveUp,
  RadioTower,
  Satellite,
  ShieldAlert,
  Sigma,
  Layers,
  Snowflake,
  Tornado,
  Umbrella,
  Waves,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { answersQuery } from "../lib/commands";
import { rangeFill } from "../lib/rangeFill";
import { formatAge, formatHeight } from "../lib/units";
import {
  overlayStatus,
  type OverlayHealth,
  type OverlayStates,
} from "../hooks/useOverlays";
import { OVERLAY_ADAPTERS } from "../lib/overlays";
import {
  CUBE_LEVELS,
  cubeLevelFeet,
  type CappiField,
  type CubeLevel,
} from "../lib/cappi";
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
  { key: "buoys", overlayId: "buoys", labelKey: "layer.buoys" },
  { key: "tropical", overlayId: "tropical", labelKey: "layer.tropical" },
];

/** The one word each state is said in. */
const HEALTH_WORD: Record<OverlayHealth, StringKey> = {
  fresh: "layers.stateFresh",
  fetching: "layers.stateFetching",
  stale: "layers.stateStale",
  failed: "layers.stateFailed",
  waiting: "layers.stateWaiting",
};

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
  /**
   * What each network-backed layer is doing, for the rows that have a source.
   *
   * Read here rather than passed in row by row, because this panel already
   * holds the one map from a switch to the adapter behind it.
   */
  overlayStates?: OverlayStates;
  /** Now, for the age beside a row. Passed in so the panel does not tick. */
  now?: number;
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
  /** Read the national grids between their cells rather than at the nearest. */
  smoothGrids: boolean;
  onSmoothGrids: (on: boolean) => void;
  onGaugeQpePeriod: (period: GaugeQpePeriod) => void;
  /** How far back the rotation track reaches. */
  rotationPeriod: RotationPeriod;
  onRotationPeriod: (period: RotationPeriod) => void;
  /** Which slab the merged shear is measured through. */
  azShearLevel: AzShearLevel;
  onAzShearLevel: (level: AzShearLevel) => void;
  /** Which of the three merged fields the height switch is showing. */
  cappiField: CappiField;
  onCappiField: (field: CappiField) => void;
  /** Which height of the merged grid all three are read at. */
  cappiLevel: CubeLevel;
  onCappiLevel: (level: CubeLevel) => void;
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
  /**
   * Whether the panel was opened by the palette's "Find a layer" rather than
   * by the rail, in which case the box takes the cursor.
   *
   * Only on that one way in. A reader who pressed the rail button came to
   * press a switch, and moving their cursor into a text box would cost them
   * a keystroke every time to get it back out.
   */
  openedToFind?: boolean;
  onClose: () => void;
}

/**
 * The seven headings the switches are read under.
 *
 * Forty-six of them ran together in the order they were added, so finding
 * "Rain or Snow" meant reading past thirty rows and the command list was the
 * only grouped view of the same switches. Grouped by where the thing on the
 * map comes from rather than by what it is about: that is the question a
 * reader is answering when they go looking for one.
 */
const LAYER_GROUPS: Array<{ id: LayerGroup; labelKey: StringKey }> = [
  { id: "hazards", labelKey: "layers.groupHazards" },
  { id: "radar", labelKey: "layers.groupRadar" },
  { id: "water", labelKey: "layers.groupWater" },
  { id: "lightning", labelKey: "layers.groupLightning" },
  { id: "sky", labelKey: "layers.groupSky" },
  { id: "reference", labelKey: "layers.groupReference" },
  { id: "yours", labelKey: "layers.groupYours" },
];

type LayerGroup =
  "hazards" | "radar" | "water" | "lightning" | "sky" | "reference" | "yours";

const LAYER_OPTIONS: Array<{
  key: keyof LayerSettings;
  group: LayerGroup;
  labelKey: StringKey;
  detailKey: StringKey;
  icon: typeof BellRing;
}> = [
  {
    key: "weatherAlerts",
    group: "hazards",
    labelKey: "layer.weatherAlerts",
    detailKey: "layers.alertsDetail",
    icon: BellRing,
  },
  {
    key: "spcOutlooks",
    group: "hazards",
    labelKey: "layer.spcOutlooks",
    detailKey: "layers.spcOutlooksDetail",
    icon: ShieldAlert,
  },
  {
    key: "wpcExcessiveRain",
    group: "hazards",
    labelKey: "layer.wpcExcessiveRain",
    detailKey: "layers.wpcExcessiveRainDetail",
    icon: CloudRain,
  },
  {
    key: "wpcWinterSeverity",
    group: "hazards",
    labelKey: "layer.wpcWinterSeverity",
    detailKey: "layers.wpcWinterSeverityDetail",
    icon: Snowflake,
  },
  {
    key: "spcDiscussions",
    group: "hazards",
    labelKey: "layer.spcDiscussions",
    detailKey: "layers.spcDiscussionsDetail",
    icon: MessageSquareWarning,
  },
  {
    key: "stormReports",
    group: "hazards",
    labelKey: "layer.stormReports",
    detailKey: "layers.stormReportsDetail",
    icon: MapPin,
  },
  {
    key: "stormCells",
    group: "radar",
    labelKey: "layer.stormCells",
    detailKey: "layers.stormCellsDetail",
    icon: Crosshair,
  },
  {
    key: "classification",
    group: "radar",
    labelKey: "layer.classification",
    detailKey: "layers.classificationDetail",
    icon: CloudSnow,
  },
  {
    key: "probSevere",
    group: "hazards",
    labelKey: "layer.probSevere",
    detailKey: "layers.probSevereDetail",
    icon: Sigma,
  },
  {
    key: "earthquakes",
    group: "hazards",
    labelKey: "layer.earthquakes",
    detailKey: "layers.earthquakesDetail",
    icon: Waves,
  },
  {
    key: "wildfires",
    group: "hazards",
    labelKey: "layer.wildfires",
    detailKey: "layers.wildfiresDetail",
    icon: Flame,
  },
  {
    key: "smoke",
    group: "sky",
    labelKey: "layer.smoke",
    detailKey: "layers.smokeDetail",
    icon: Cloudy,
  },
  {
    key: "forecastSmoke",
    group: "sky",
    labelKey: "layer.forecastSmoke",
    detailKey: "layers.forecastSmokeDetail",
    icon: CloudFog,
  },
  {
    key: "metar",
    group: "sky",
    labelKey: "layer.metar",
    detailKey: "layers.metarDetail",
    icon: Thermometer,
  },
  {
    key: "riverGauges",
    group: "water",
    labelKey: "layer.riverGauges",
    detailKey: "layers.riverGaugesDetail",
    icon: Waves,
  },
  {
    key: "buoys",
    group: "water",
    labelKey: "layer.buoys",
    detailKey: "layers.buoysDetail",
    icon: Waves,
  },
  {
    key: "tropical",
    group: "hazards",
    labelKey: "layer.tropical",
    detailKey: "layers.tropicalDetail",
    icon: Tornado,
  },
  {
    key: "satellite",
    group: "sky",
    labelKey: "layer.satellite",
    detailKey: "layers.satelliteDetail",
    icon: Satellite,
  },
  {
    key: "rotationTracks",
    group: "radar",
    labelKey: "layer.rotationTracks",
    detailKey: "layers.rotationDetail",
    icon: Tornado,
  },
  {
    key: "azShear",
    group: "radar",
    labelKey: "layer.azShear",
    detailKey: "layers.azShearDetail",
    icon: Tornado,
  },
  {
    key: "hail",
    group: "radar",
    labelKey: "layer.hail",
    detailKey: "layers.hailDetail",
    icon: CloudHail,
  },
  {
    key: "hailSwath",
    group: "radar",
    labelKey: "layer.hailSwath",
    detailKey: "layers.hailSwathDetail",
    icon: CloudHail,
  },
  {
    key: "posh",
    group: "radar",
    labelKey: "layer.posh",
    detailKey: "layers.poshDetail",
    icon: CloudHail,
  },
  {
    key: "shi",
    group: "radar",
    labelKey: "layer.shi",
    detailKey: "layers.shiDetail",
    icon: CloudHail,
  },
  {
    key: "vilDensity",
    group: "radar",
    labelKey: "layer.vilDensity",
    detailKey: "layers.vilDensityDetail",
    icon: Droplets,
  },
  {
    key: "vii",
    group: "radar",
    labelKey: "layer.vii",
    detailKey: "layers.viiDetail",
    icon: Snowflake,
  },
  {
    key: "echoTops",
    group: "radar",
    labelKey: "layer.echoTops",
    detailKey: "layers.echoTopsDetail",
    icon: MoveUp,
  },
  {
    key: "vil",
    group: "radar",
    labelKey: "layer.vil",
    detailKey: "layers.vilDetail",
    icon: Droplets,
  },
  {
    key: "precipRate",
    group: "water",
    labelKey: "layer.precipRate",
    detailKey: "layers.precipRateDetail",
    icon: CloudRain,
  },
  {
    key: "qpeHour",
    group: "water",
    labelKey: "layer.qpeHour",
    detailKey: "layers.qpeHourDetail",
    icon: Umbrella,
  },
  {
    key: "qpeDay",
    group: "water",
    labelKey: "layer.qpeDay",
    detailKey: "layers.qpeDayDetail",
    icon: Umbrella,
  },
  {
    key: "counties",
    group: "reference",
    labelKey: "layer.counties",
    detailKey: "layers.countiesDetail",
    icon: Map,
  },
  {
    key: "night",
    group: "reference",
    labelKey: "layer.night",
    detailKey: "layers.nightDetail",
    icon: Moon,
  },
  {
    key: "gaugeQpe",
    group: "water",
    labelKey: "layer.gaugeQpe",
    detailKey: "layers.gaugeQpeDetail",
    icon: Umbrella,
  },
  {
    key: "ffgHour",
    group: "water",
    labelKey: "layer.ffgHour",
    detailKey: "layers.ffgHourDetail",
    icon: Droplets,
  },
  {
    key: "ffgThreeHour",
    group: "water",
    labelKey: "layer.ffgThreeHour",
    detailKey: "layers.ffgThreeHourDetail",
    icon: Droplets,
  },
  {
    key: "unitStreamflow",
    group: "water",
    labelKey: "layer.unitStreamflow",
    detailKey: "layers.unitStreamflowDetail",
    icon: Waves,
  },
  {
    key: "precipType",
    group: "water",
    labelKey: "layer.precipType",
    detailKey: "layers.precipTypeDetail",
    icon: Snowflake,
  },
  {
    key: "lightningDensity",
    group: "lightning",
    labelKey: "layer.lightningDensity",
    detailKey: "layers.lightningDensityDetail",
    icon: Zap,
  },
  {
    key: "lightningForecast",
    group: "lightning",
    labelKey: "layer.lightningForecast",
    detailKey: "layers.lightningForecastDetail",
    icon: Zap,
  },
  {
    key: "lightningJump",
    group: "lightning",
    labelKey: "layer.lightningJump",
    detailKey: "layers.lightningJumpDetail",
    icon: Zap,
  },
  {
    key: "isothermReflectivity",
    group: "radar",
    labelKey: "layer.isothermReflectivity",
    detailKey: "layers.isothermReflectivityDetail",
    icon: Snowflake,
  },
  {
    key: "cappi",
    group: "radar",
    labelKey: "layer.cappi",
    detailKey: "layer.cappiDetail",
    icon: Layers,
  },
  {
    key: "lightningFlashes",
    group: "lightning",
    labelKey: "layer.lightningFlashes",
    detailKey: "layers.lightningFlashesDetail",
    icon: Zap,
  },
  {
    key: "wind",
    group: "sky",
    labelKey: "layers.wind",
    detailKey: "layers.windDetail",
    icon: Wind,
  },
  {
    key: "surge",
    group: "hazards",
    labelKey: "layer.surge",
    detailKey: "layers.surgeDetail",
    icon: Waves,
  },
  {
    key: "customOverlay",
    group: "yours",
    labelKey: "layer.customOverlay",
    detailKey: "layers.customDetail",
    icon: RadioTower,
  },
];

export function LayersPanel({
  layers,
  layerNotes,
  overlayStates,
  now,
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
  smoothGrids,
  onSmoothGrids,
  onGaugeQpePeriod,
  rotationPeriod,
  onRotationPeriod,
  azShearLevel,
  onAzShearLevel,
  cappiField,
  onCappiField,
  cappiLevel,
  onCappiLevel,
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
  openedToFind,
  onClose,
}: LayersPanelProps) {
  const t = useT();
  // What the reader has typed into the box at the top, if anything.
  const [find, setFind] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (openedToFind) box.current?.focus();
  }, [openedToFind]);
  /**
   * Whether a label and the note under it answer what was typed.
   *
   * The palette's own rule, so a word that finds a layer in the command bar
   * finds the same layer here. Reading the translated strings rather than
   * their keys is what makes it work in every language: the catalogue is the
   * index, and `t` is how it is read.
   */
  const answers = (label: StringKey, ...notes: StringKey[]) =>
    answersQuery(
      t(label),
      notes.map((note) => t(note)),
      find,
    );
  /** The switches left on screen, in the order the catalogue writes them. */
  const kept = LAYER_OPTIONS.filter((one) =>
    answers(one.labelKey, one.detailKey),
  );
  /**
   * Whether the section that belongs to one switch is still on screen.
   *
   * The window on the lightning density, the day of the outlook, the height
   * of the CAPPI: each of these only exists because its layer is on, and
   * each reads as part of that row rather than as a row of its own. So they
   * follow their switch through the filter instead of being matched on their
   * own words, and a search for "lightning" keeps the window beside it.
   *
   * Read off the same list the rows are drawn from, so the two can never
   * disagree. A key the catalogue has never heard of keeps its section
   * rather than losing it: a section wired to a switch that is not up there
   * is a mistake, and one that hides a section is a mistake nobody sees.
   */
  const alongside = (key: keyof LayerSettings) =>
    !LAYER_OPTIONS.some((one) => one.key === key) ||
    kept.some((one) => one.key === key);
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
  /**
   * The three sections with words of their own rather than a switch's.
   *
   * Named here rather than asked inline, because the line that says nothing
   * matched has to know about them. Asked separately, the panel said "no
   * layer here is called that" over a section that had just answered to the
   * same word: typing "solid" finds "How solid the overlays are" and no
   * switch at all, and the reader was told both things at once.
   */
  const smoothingShown = answers(
    "layers.smoothGrids",
    "layers.smoothGridsDetail",
    "layers.smoothGridsLabel",
    "layers.smoothGridsNote",
  );
  const orderShown =
    arrangeable.length > 1 && answers("layers.order", "layers.orderDetail");
  const opacityShown =
    OVERLAY_LAYERS.some(({ key }) => layers[key]) &&
    answers("layers.opacity", "layers.opacityDetail");
  /**
   * The word for what a switched-on layer is doing, and how old its picture
   * is. Nothing for a layer that is off, and nothing for one with no source
   * of its own: the grids, the sweep and the reader's own files all answer
   * somewhere else.
   */
  const statusOf = (key: keyof LayerSettings) => {
    if (!layers[key] || !overlayStates || now === undefined) return null;

    const entry = OVERLAY_LAYERS.find((one) => one.key === key);
    const adapter = OVERLAY_ADAPTERS.find((one) => one.id === entry?.overlayId);
    if (!entry || !adapter) return null;
    const state = overlayStates[adapter.id];
    if (!state) return null;
    const status = overlayStatus(state, adapter.refreshMs, now);
    // A layer the workspace has decided not to ask for at all says why
    // underneath: zoom in, or not while the map is held on another day.
    // Nothing is in flight and nothing has arrived, so this would read as
    // waiting, and a row saying "waiting" over a note saying "zoom in"
    // contradicts itself on one line. A failure has a note too, and that one
    // is the state and its reason agreeing.
    if (status.health === "waiting" && layerNotes?.[key]) return null;
    return status;
  };

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
      {/* Forty-six switches under seven headings. The headings answer "what
          kind of thing is it", and this answers "I know what it is called".
          Not a search over the app: the command bar is that, and this box
          says so when it finds nothing. */}
      <div className="settings-find">
        <label className="settings-find__label" htmlFor="layers-find">
          {t("layers.find")}
        </label>
        <input
          id="layers-find"
          ref={box}
          type="search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
      </div>
      {kept.length === 0 && !smoothingShown && !orderShown && !opacityShown ? (
        <p className="settings-find__none">{t("layers.findNone")}</p>
      ) : null}
      {LAYER_GROUPS.filter((group) =>
        kept.some((one) => one.group === group.id),
      ).map((group) => (
        <div
          className="settings-section"
          key={group.id}
          data-layer-group={group.id}
        >
          <div className="settings-section__title">
            <span>{t(group.labelKey)}</span>
          </div>
          <div className="setting-list">
            {kept
              .filter((one) => one.group === group.id)
              .map(({ key, labelKey, detailKey, icon: Icon }) => {
                const status = statusOf(key);
                return (
                  <label className="toggle-row" key={key} data-layer={key}>
                    <Icon size={19} />
                    <span>
                      <strong>
                        {t(labelKey)}
                        {/* What the source is doing, where the switch is. A reader
                    who turns a layer on and sees nothing cannot otherwise
                    tell a quiet afternoon from a service that is down, and
                    the two places that do know are the diagnostics panel and
                    the legend, neither of which is here. */}
                        {status ? (
                          <em
                            className="layer-state"
                            data-layer-state={`${key}:${status.health}`}
                          >
                            {t(HEALTH_WORD[status.health])}
                            {status.health !== "waiting" &&
                            status.health !== "fetching" &&
                            status.ageSeconds !== null
                              ? ` ${formatAge(status.ageSeconds / 60)}`
                              : ""}
                          </em>
                        ) : null}
                      </strong>
                      {/* What went wrong, where the reader switched it on. A layer
                  that fails silently looks like a quiet afternoon, which for
                  a layer somebody might act on is the worst thing it could
                  look like. */}
                      {layers[key] && layerNotes?.[key] ? (
                        <small className="toggle-row__note">
                          {layerNotes[key]}
                        </small>
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
                );
              })}
          </div>
        </div>
      ))}
      {smoothingShown ? (
        <div className="settings-section" data-grid-smoothing>
          <div className="settings-section__title">
            <span>{t("layers.smoothGrids")}</span>
            <small>{t("layers.smoothGridsDetail")}</small>
          </div>
          {/* The picture only. What the inspector answers with and what an
            export writes are the cells themselves either way, which is the
            same bargain the sweep's own smoothing makes. */}
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("layers.smoothGridsLabel")}</strong>
              <small>{t("layers.smoothGridsNote")}</small>
            </span>
            <input
              type="checkbox"
              checked={smoothGrids}
              onChange={(event) => onSmoothGrids(event.target.checked)}
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        </div>
      ) : null}

      {orderShown ? (
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

      {layers.customOverlay && alongside("customOverlay") ? (
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
                        // The name of a control is what it is called, not
                        // what it currently reads. Both of these carried the
                        // percentage as well, so it was announced twice on
                        // every step of a drag and the name a reader heard on
                        // focus was a different name a moment later.
                        aria-label={t("layers.opacityFor", {
                          layer: file.name,
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

      {opacityShown ? (
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

      {layers.weatherAlerts && alongside("weatherAlerts") ? (
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

      {layers.satellite && alongside("satellite") ? (
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

      {layers.spcOutlooks && alongside("spcOutlooks") ? (
        <div
          className="settings-section"
          data-spc-day={spcDay}
          data-spc-hazard={spcHazard}
        >
          <div className="settings-section__title">
            <span>{t("layers.spcOutlookChoice")}</span>
            <small>{t("layers.spcOutlookChoiceDetail")}</small>
          </div>
          {/* Two controls under one heading, so the heading names neither:
              "Convective outlook" is the section and not the day. Both had a
              name for a screen reader and none on screen, which is the same
              row a reader has to guess at that Settings had. */}
          <div className="settings-field">
            <span>
              <strong>{t("layers.spcDay")}</strong>
            </span>
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
          </div>
          {/* Day 3 publishes two products, a categorical and one combined
              probability, and it used to have no control of its own: which
              one you got came from whichever hazard was last picked on Day 1
              or 2, with nothing on screen saying which was drawn. On the
              default that is categorical, so the Day 3 probability was
              unreachable from a fresh workspace. Days 4 to 8 publish one
              probability and genuinely have nothing to choose between. */}
          {spcDay <= 2 ? (
            <div className="settings-field">
              <span>
                <strong>{t("layers.spcHazard")}</strong>
              </span>
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
            </div>
          ) : spcDay === 3 ? (
            <div className="settings-field">
              <span>
                <strong>{t("layers.spcHazard")}</strong>
              </span>
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
            </div>
          ) : null}
        </div>
      ) : null}

      {layers.wpcExcessiveRain && alongside("wpcExcessiveRain") ? (
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

      {layers.wpcWinterSeverity && alongside("wpcWinterSeverity") ? (
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

      {layers.rotationTracks && alongside("rotationTracks") ? (
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

      {layers.lightningDensity && alongside("lightningDensity") ? (
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

      {layers.lightningForecast && alongside("lightningForecast") ? (
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

      {layers.lightningJump && alongside("lightningJump") ? (
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

      {layers.isothermReflectivity && alongside("isothermReflectivity") ? (
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

      {layers.cappi && alongside("cappi") ? (
        <div className="settings-section" data-cappi-level={cappiLevel}>
          <div className="settings-section__title">
            <span>{t("layers.cappiField")}</span>
          </div>
          <div
            className="segmented-control segmented-control--full"
            role="group"
            aria-label={t("layers.cappiField")}
          >
            {/* Written out rather than built from the field, so the
                catalogue coverage gate can see all three keys. */}
            {(
              [
                ["reflectivity", "layers.cappiReflectivity"],
                ["correlation", "layers.cappiCorrelation"],
                ["differential", "layers.cappiDifferential"],
              ] as const
            ).map(([field, key]) => (
              <button
                key={field}
                type="button"
                className={cappiField === field ? "is-active" : ""}
                aria-pressed={cappiField === field}
                onClick={() => onCappiField(field)}
              >
                {t(key)}
              </button>
            ))}
          </div>
          {/* A slider rather than thirty-three buttons. The heights are not
              evenly spaced, so it steps through the list by position and
              says the height it landed on in the reader's own measure. */}
          <label className="range-row">
            <span>
              <strong>{t("layers.cappiHeight")}</strong>
              <output>{formatHeight(cubeLevelFeet(cappiLevel))}</output>
            </span>
            <input
              type="range"
              min={0}
              max={CUBE_LEVELS.length - 1}
              step={1}
              value={CUBE_LEVELS.indexOf(cappiLevel)}
              aria-label={t("layers.cappiHeight")}
              // The value behind the thumb is a position in the list, because
              // the heights are not evenly spaced. Announced as it stands it
              // would read "twelve".
              aria-valuetext={formatHeight(cubeLevelFeet(cappiLevel))}
              style={rangeFill(
                CUBE_LEVELS.indexOf(cappiLevel),
                0,
                CUBE_LEVELS.length - 1,
              )}
              onChange={(event) =>
                onCappiLevel(
                  CUBE_LEVELS[Number(event.target.value)] ?? cappiLevel,
                )
              }
            />
          </label>
          <p className="source-note">{t("layers.cappiNote")}</p>
        </div>
      ) : null}

      {layers.azShear && alongside("azShear") ? (
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

      {layers.gaugeQpe && alongside("gaugeQpe") ? (
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

      {layers.surge && alongside("surge") ? (
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

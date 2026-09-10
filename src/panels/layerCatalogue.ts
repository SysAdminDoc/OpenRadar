/**
 * What the Layers panel offers, as data.
 *
 * Split out of the panel on 2026-09-10, when that file had reached 1,800
 * lines against the 1,500 `AUD-272` set for a file of this kind. Adding a
 * switch group is an entry here now rather than an edit to the panel, which
 * is what keeps the panel from growing back.
 *
 * Everything here is a table: which switches exist, which group each belongs
 * to, which of them draw an overlay that can be faded, and the words for
 * three small vocabularies. No markup, no state.
 */
import {
  BellRing,
  CloudFog,
  CloudHail,
  CloudRain,
  CloudSnow,
  Cloudy,
  Crosshair,
  Droplets,
  Flame,
  Layers,
  Map,
  MapPin,
  MessageSquareWarning,
  Moon,
  MoveUp,
  Plane,
  RadioTower,
  Satellite,
  ShieldAlert,
  Sigma,
  Snowflake,
  Thermometer,
  Tornado,
  Umbrella,
  Waves,
  Wind,
  Zap,
} from "lucide-react";
import type { StringKey } from "../i18n/en";
import type { LayerSettings } from "../lib/settings";
import type { OverlayHealth } from "../hooks/useOverlays";
import type { Spacecraft } from "../lib/providers/satellite";

/** One key per hazard, written out so the copy gate can see every one. */
export const HAZARD_LABELS = {
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
export const OVERLAY_LAYERS: Array<{
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
  { key: "cocorahs", overlayId: "cocorahs", labelKey: "layer.cocorahs" },
  { key: "airnow", overlayId: "airnow", labelKey: "layer.airnow" },
  { key: "firms", overlayId: "firms", labelKey: "layer.firms" },
  { key: "aviation", overlayId: "aviation", labelKey: "layer.aviation" },
  { key: "tropical", overlayId: "tropical", labelKey: "layer.tropical" },
];

/** The one word each state is said in. */
export const HEALTH_WORD: Record<OverlayHealth, StringKey> = {
  fresh: "layers.stateFresh",
  fetching: "layers.stateFetching",
  stale: "layers.stateStale",
  failed: "layers.stateFailed",
  waiting: "layers.stateWaiting",
};

export const SATELLITE_NAMES: Record<Spacecraft, StringKey> = {
  east: "satellite.east",
  west: "satellite.west",
  himawari: "satellite.himawari",
};

/**
 * The seven headings the switches are read under.
 *
 * Forty-six of them ran together in the order they were added, so finding
 * "Rain or Snow" meant reading past thirty rows and the command list was the
 * only grouped view of the same switches. Grouped by where the thing on the
 * map comes from rather than by what it is about: that is the question a
 * reader is answering when they go looking for one.
 */
export const LAYER_GROUPS: Array<{ id: LayerGroup; labelKey: StringKey }> = [
  { id: "hazards", labelKey: "layers.groupHazards" },
  { id: "radar", labelKey: "layers.groupRadar" },
  { id: "water", labelKey: "layers.groupWater" },
  { id: "lightning", labelKey: "layers.groupLightning" },
  { id: "sky", labelKey: "layers.groupSky" },
  { id: "reference", labelKey: "layers.groupReference" },
  { id: "yours", labelKey: "layers.groupYours" },
];

export type LayerGroup =
  "hazards" | "radar" | "water" | "lightning" | "sky" | "reference" | "yours";

export const LAYER_OPTIONS: Array<{
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
    key: "cocorahs",
    group: "water",
    labelKey: "layer.cocorahs",
    detailKey: "layers.cocorahsDetail",
    icon: CloudRain,
  },
  {
    key: "airnow",
    group: "hazards",
    labelKey: "layer.airnow",
    detailKey: "layers.airnowDetail",
    icon: Wind,
  },
  {
    key: "firms",
    group: "hazards",
    labelKey: "layer.firms",
    detailKey: "layers.firmsDetail",
    icon: Flame,
  },
  {
    key: "aviation",
    group: "hazards",
    labelKey: "layer.aviation",
    detailKey: "layers.aviationDetail",
    icon: Plane,
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
    key: "snowfall",
    group: "water",
    labelKey: "layer.snowfall",
    detailKey: "layers.snowfallDetail",
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

/**
 * A settings file, whatever state it is in, read back as the app's own shape.
 *
 * The composer. Every section is normalised by the module that owns the
 * vocabulary it is written in, and this puts the answers together and fills
 * in what the file did not say. What it imports it never gets imported by:
 * the leaves read their shapes from `types.ts`, which imports nothing at
 * runtime, so none of this can close a ring.
 */
import { normalizeIncidentPacks } from "../incidentPacks";
import { AMBIENT_DISTANCES } from "../ambientScreen";
import { SPC_HAZARDS } from "../spcHazards";
import type { SpcHazard } from "../spcHazards";
import { isLevel2Product } from "../level2";
import { isClassificationProduct } from "../classification";
import { normalizePalettes } from "../palette";
import { normalizePaletteAssignments } from "../palette";
import { isLanguage } from "../../i18n";
import { isSurgeCategory } from "../surge";
import { isSnowfallWindow } from "../snowfall";
import { MAX_LOOP_VOLUMES, MIN_LOOP_VOLUMES } from "../siteLoop";
import { isSatelliteBand, type SatelliteBandId } from "../satelliteBands";
import { isGaugeQpePeriod } from "../gaugeQpe";
import {
  APPROACH_MINUTES,
  DEFAULT_APPROACH,
  type ApproachSettings,
} from "../approach";
import {
  DEFAULT_LIGHTNING_RULE,
  LIGHTNING_COUNTS,
  LIGHTNING_RADII,
  type LightningRule,
} from "../lightningWatch";
import {
  isIsothermLevel,
  isLightningForecast,
  isLightningJump,
  isLightningWindow,
} from "../lightningGrids";
import { isCappiField, isCubeLevel } from "../cappi";
import { isAzShearLevel, isRotationPeriod } from "../rotationTrack";
import { normalizeTheme } from "../theme";
import { TEXT_SCALES } from "../units";
import type { TextScale } from "../units";
import { normalizeAlertTypes } from "../alertTypes";
import { normalizeWatch, normalizeWatchPlaces } from "../watch";
import { SCHEMA_VERSION } from "./types";
import type {
  AppSettings,
  CameraState,
  LayerSettings,
  RadarSettings,
} from "./types";
import { DEFAULT_SETTINGS } from "./defaults";
import { bool, finiteInRange } from "./read";
import { normalizeCamera, normalizeMapStyle } from "./camera";
import {
  normalizeOccasions,
  normalizeOverlayOpacity,
  normalizePreset,
  normalizeStormMotion,
  normalizeThresholds,
} from "./sections";

export function normalizeSettings(value: unknown): AppSettings {
  const raw =
    value && typeof value === "object" ? (value as Partial<AppSettings>) : {};
  const radar: Partial<RadarSettings> =
    raw.radar && typeof raw.radar === "object" ? raw.radar : {};
  const layers: Partial<LayerSettings> =
    raw.layers && typeof raw.layers === "object" ? raw.layers : {};
  const presets = Array.isArray(raw.presets)
    ? raw.presets.slice(0, 4).map(normalizePreset)
    : [];

  while (presets.length < 4) presets.push(null);

  // Schema 2 dropped the radar and layer switches that had no data source.
  // They are simply not read, so a schema 1 file loads with the rest intact.
  return {
    schemaVersion: SCHEMA_VERSION,
    theme: raw.theme === "light" ? "light" : "dark",
    workspaceTheme: normalizeTheme(raw.workspaceTheme),
    ambient: bool(raw.ambient, DEFAULT_SETTINGS.ambient),
    almanac: bool(raw.almanac, DEFAULT_SETTINGS.almanac),
    occasions: normalizeOccasions(raw.occasions),
    // A language from a build that had one this build does not falls back to
    // English rather than painting the screen with missing keys.
    language: isLanguage(raw.language) ? raw.language : "en",
    units: raw.units === "metric" ? "metric" : "imperial",
    unitsChosen: typeof raw.unitsChosen === "boolean" ? raw.unitsChosen : true,
    clock: raw.clock === "utc" ? "utc" : "local",
    textScale: TEXT_SCALES.includes(raw.textScale as TextScale)
      ? (raw.textScale as TextScale)
      : 100,
    projection: raw.projection === "globe" ? "globe" : "mercator",
    mapStyle: normalizeMapStyle(raw.mapStyle),
    camera: normalizeCamera(raw.camera),
    radar: {
      enabled: bool(radar.enabled, DEFAULT_SETTINGS.radar.enabled),
      opacity: finiteInRange(
        radar.opacity,
        DEFAULT_SETTINGS.radar.opacity,
        0.05,
        1,
      ),
      animationSpeed: finiteInRange(
        radar.animationSpeed,
        DEFAULT_SETTINGS.radar.animationSpeed,
        -0.8,
        0.5,
      ),
      singleSite: bool(radar.singleSite, DEFAULT_SETTINGS.radar.singleSite),
      // Rounded as well as clamped: this counts volumes, and a stored 7.5
      // would be asked of a listing that answers in whole objects.
      loopVolumes: Math.round(
        finiteInRange(
          radar.loopVolumes,
          DEFAULT_SETTINGS.radar.loopVolumes,
          MIN_LOOP_VOLUMES,
          MAX_LOOP_VOLUMES,
        ),
      ),
      live: bool(radar.live, DEFAULT_SETTINGS.radar.live),
      persistence: bool(radar.persistence, DEFAULT_SETTINGS.radar.persistence),
      smoothSweep: bool(radar.smoothSweep, DEFAULT_SETTINGS.radar.smoothSweep),
      smoothGrids: bool(radar.smoothGrids, DEFAULT_SETTINGS.radar.smoothGrids),
      dealias: bool(radar.dealias, DEFAULT_SETTINGS.radar.dealias),
      stormMotion: normalizeStormMotion(radar.stormMotion),
      station:
        typeof radar.station === "string" && /^[A-Za-z]{4}$/.test(radar.station)
          ? radar.station.toUpperCase()
          : null,
      product: isLevel2Product(radar.product)
        ? radar.product
        : DEFAULT_SETTINGS.radar.product,
      classificationProduct: isClassificationProduct(
        radar.classificationProduct,
      )
        ? radar.classificationProduct
        : DEFAULT_SETTINGS.radar.classificationProduct,
      tilt: finiteInRange(radar.tilt, DEFAULT_SETTINGS.radar.tilt, 0, 20),
      loopMinutes: finiteInRange(
        radar.loopMinutes,
        DEFAULT_SETTINGS.radar.loopMinutes,
        60,
        120,
      ),
      futureRadar: bool(radar.futureRadar, DEFAULT_SETTINGS.radar.futureRadar),
      thresholds: normalizeThresholds(radar.thresholds),
    },
    layers: {
      weatherAlerts: bool(
        layers.weatherAlerts,
        DEFAULT_SETTINGS.layers.weatherAlerts,
      ),
      spcOutlooks: bool(
        layers.spcOutlooks,
        DEFAULT_SETTINGS.layers.spcOutlooks,
      ),
      wpcExcessiveRain: bool(
        layers.wpcExcessiveRain,
        DEFAULT_SETTINGS.layers.wpcExcessiveRain,
      ),
      wpcWinterSeverity: bool(
        layers.wpcWinterSeverity,
        DEFAULT_SETTINGS.layers.wpcWinterSeverity,
      ),
      spcDiscussions: bool(
        layers.spcDiscussions,
        DEFAULT_SETTINGS.layers.spcDiscussions,
      ),
      stormReports: bool(
        layers.stormReports,
        DEFAULT_SETTINGS.layers.stormReports,
      ),
      stormCells: bool(layers.stormCells, DEFAULT_SETTINGS.layers.stormCells),
      classification: bool(
        layers.classification,
        DEFAULT_SETTINGS.layers.classification,
      ),
      probSevere: bool(layers.probSevere, DEFAULT_SETTINGS.layers.probSevere),
      earthquakes: bool(
        layers.earthquakes,
        DEFAULT_SETTINGS.layers.earthquakes,
      ),
      wildfires: bool(layers.wildfires, DEFAULT_SETTINGS.layers.wildfires),
      smoke: bool(layers.smoke, DEFAULT_SETTINGS.layers.smoke),
      forecastSmoke: bool(
        layers.forecastSmoke,
        DEFAULT_SETTINGS.layers.forecastSmoke,
      ),
      metar: bool(layers.metar, DEFAULT_SETTINGS.layers.metar),
      riverGauges: bool(
        layers.riverGauges,
        DEFAULT_SETTINGS.layers.riverGauges,
      ),
      buoys: bool(layers.buoys, DEFAULT_SETTINGS.layers.buoys),
      cocorahs: bool(layers.cocorahs, DEFAULT_SETTINGS.layers.cocorahs),
      aviation: bool(layers.aviation, DEFAULT_SETTINGS.layers.aviation),
      tropical: bool(layers.tropical, DEFAULT_SETTINGS.layers.tropical),
      satellite: bool(layers.satellite, DEFAULT_SETTINGS.layers.satellite),
      customOverlay: bool(
        layers.customOverlay,
        DEFAULT_SETTINGS.layers.customOverlay,
      ),
      rotationTracks: bool(
        layers.rotationTracks,
        DEFAULT_SETTINGS.layers.rotationTracks,
      ),
      azShear: bool(layers.azShear, DEFAULT_SETTINGS.layers.azShear),
      hail: bool(layers.hail, DEFAULT_SETTINGS.layers.hail),
      hailSwath: bool(layers.hailSwath, DEFAULT_SETTINGS.layers.hailSwath),
      vilDensity: bool(layers.vilDensity, DEFAULT_SETTINGS.layers.vilDensity),
      shi: bool(layers.shi, DEFAULT_SETTINGS.layers.shi),
      posh: bool(layers.posh, DEFAULT_SETTINGS.layers.posh),
      vii: bool(layers.vii, DEFAULT_SETTINGS.layers.vii),
      echoTops: bool(layers.echoTops, DEFAULT_SETTINGS.layers.echoTops),
      vil: bool(layers.vil, DEFAULT_SETTINGS.layers.vil),
      precipRate: bool(layers.precipRate, DEFAULT_SETTINGS.layers.precipRate),
      qpeHour: bool(layers.qpeHour, DEFAULT_SETTINGS.layers.qpeHour),
      qpeDay: bool(layers.qpeDay, DEFAULT_SETTINGS.layers.qpeDay),
      counties: bool(layers.counties, DEFAULT_SETTINGS.layers.counties),
      night: bool(layers.night, DEFAULT_SETTINGS.layers.night),
      gaugeQpe: bool(layers.gaugeQpe, DEFAULT_SETTINGS.layers.gaugeQpe),
      ffgHour: bool(layers.ffgHour, DEFAULT_SETTINGS.layers.ffgHour),
      ffgThreeHour: bool(
        layers.ffgThreeHour,
        DEFAULT_SETTINGS.layers.ffgThreeHour,
      ),
      unitStreamflow: bool(
        layers.unitStreamflow,
        DEFAULT_SETTINGS.layers.unitStreamflow,
      ),
      precipType: bool(layers.precipType, DEFAULT_SETTINGS.layers.precipType),
      snowfall: bool(layers.snowfall, DEFAULT_SETTINGS.layers.snowfall),
      lightningDensity: bool(
        layers.lightningDensity,
        DEFAULT_SETTINGS.layers.lightningDensity,
      ),
      lightningForecast: bool(
        layers.lightningForecast,
        DEFAULT_SETTINGS.layers.lightningForecast,
      ),
      lightningJump: bool(
        layers.lightningJump,
        DEFAULT_SETTINGS.layers.lightningJump,
      ),
      isothermReflectivity: bool(
        layers.isothermReflectivity,
        DEFAULT_SETTINGS.layers.isothermReflectivity,
      ),
      cappi: bool(layers.cappi, DEFAULT_SETTINGS.layers.cappi),
      lightningFlashes: bool(
        layers.lightningFlashes,
        DEFAULT_SETTINGS.layers.lightningFlashes,
      ),
      wind: bool(layers.wind, DEFAULT_SETTINGS.layers.wind),
      surge: bool(layers.surge, DEFAULT_SETTINGS.layers.surge),
    },
    // Every palette is re-read from its own text rather than trusted as an
    // object, so a hand-edited settings file cannot put anything on the map
    // that the parser would not have produced itself.
    palettes: normalizePalettes(raw),
    paletteAssignments: normalizePaletteAssignments(raw),
    surgeCategory: isSurgeCategory(raw.surgeCategory)
      ? raw.surgeCategory
      : DEFAULT_SETTINGS.surgeCategory,
    snowfallWindow: isSnowfallWindow(raw.snowfallWindow)
      ? raw.snowfallWindow
      : DEFAULT_SETTINGS.snowfallWindow,
    watch: normalizeWatch(raw.watch, DEFAULT_SETTINGS.watch),
    followNewWarnings: bool(
      raw.followNewWarnings,
      DEFAULT_SETTINGS.followNewWarnings,
    ),
    watchRings: bool(raw.watchRings, DEFAULT_SETTINGS.watchRings),
    ambientMetres: (AMBIENT_DISTANCES as readonly number[]).includes(
      Number(raw.ambientMetres),
    )
      ? Number(raw.ambientMetres)
      : DEFAULT_SETTINGS.ambientMetres,
    // Read from the old key too, which held the same two band names before
    // the satellite stopped being part of the choice. A file written by any
    // build before 2026-09-03 keeps the view its reader picked.
    satelliteBand: isSatelliteBand(raw.satelliteBand)
      ? raw.satelliteBand
      : isSatelliteBand((raw as Record<string, unknown>).satelliteProduct)
        ? ((raw as Record<string, unknown>).satelliteProduct as SatelliteBandId)
        : DEFAULT_SETTINGS.satelliteBand,
    gaugeQpePeriod: isGaugeQpePeriod(raw.gaugeQpePeriod)
      ? raw.gaugeQpePeriod
      : DEFAULT_SETTINGS.gaugeQpePeriod,
    // Rounded as well as clamped: the layer is a service path, and a day of
    // 1.5 would ask for a layer that is not there.
    approach: {
      enabled: bool(
        (raw.approach as Partial<ApproachSettings> | undefined)?.enabled,
        DEFAULT_APPROACH.enabled,
      ),
      // Clamped to the windows the panel offers, and rounded: this is a
      // number a reader picks from a list, not a free field.
      minutes: Math.round(
        finiteInRange(
          (raw.approach as Partial<ApproachSettings> | undefined)?.minutes,
          DEFAULT_APPROACH.minutes,
          APPROACH_MINUTES[0],
          APPROACH_MINUTES[APPROACH_MINUTES.length - 1],
        ),
      ),
      sound: bool(
        (raw.approach as Partial<ApproachSettings> | undefined)?.sound,
        DEFAULT_APPROACH.sound,
      ),
    },
    lightningWatch: {
      enabled: bool(
        (raw.lightningWatch as Partial<LightningRule> | undefined)?.enabled,
        DEFAULT_LIGHTNING_RULE.enabled,
      ),
      radiusMiles: Math.round(
        finiteInRange(
          (raw.lightningWatch as Partial<LightningRule> | undefined)
            ?.radiusMiles,
          DEFAULT_LIGHTNING_RULE.radiusMiles,
          LIGHTNING_RADII[0],
          LIGHTNING_RADII[LIGHTNING_RADII.length - 1],
        ),
      ),
      count: Math.round(
        finiteInRange(
          (raw.lightningWatch as Partial<LightningRule> | undefined)?.count,
          DEFAULT_LIGHTNING_RULE.count,
          LIGHTNING_COUNTS[0],
          LIGHTNING_COUNTS[LIGHTNING_COUNTS.length - 1],
        ),
      ),
      sound: bool(
        (raw.lightningWatch as Partial<LightningRule> | undefined)?.sound,
        DEFAULT_LIGHTNING_RULE.sound,
      ),
    },
    spcDay: Math.round(
      finiteInRange(raw.spcDay, DEFAULT_SETTINGS.spcDay, 1, 8),
    ),
    spcHazard: SPC_HAZARDS.includes(raw.spcHazard as SpcHazard)
      ? (raw.spcHazard as SpcHazard)
      : DEFAULT_SETTINGS.spcHazard,
    wpcDay: Math.round(
      finiteInRange(raw.wpcDay, DEFAULT_SETTINGS.wpcDay, 1, 5),
    ),
    wssiDay: Math.round(
      finiteInRange(raw.wssiDay, DEFAULT_SETTINGS.wssiDay, 1, 3),
    ),
    rotationPeriod: isRotationPeriod(raw.rotationPeriod)
      ? raw.rotationPeriod
      : DEFAULT_SETTINGS.rotationPeriod,
    lightningWindow: isLightningWindow(raw.lightningWindow)
      ? raw.lightningWindow
      : DEFAULT_SETTINGS.lightningWindow,
    lightningForecastWindow: isLightningForecast(raw.lightningForecastWindow)
      ? raw.lightningForecastWindow
      : DEFAULT_SETTINGS.lightningForecastWindow,
    lightningJumpWindow: isLightningJump(raw.lightningJumpWindow)
      ? raw.lightningJumpWindow
      : DEFAULT_SETTINGS.lightningJumpWindow,
    isothermLevel: isIsothermLevel(raw.isothermLevel)
      ? raw.isothermLevel
      : DEFAULT_SETTINGS.isothermLevel,
    azShearLevel: isAzShearLevel(raw.azShearLevel)
      ? raw.azShearLevel
      : DEFAULT_SETTINGS.azShearLevel,
    cappiField: isCappiField(raw.cappiField)
      ? raw.cappiField
      : DEFAULT_SETTINGS.cappiField,
    cappiLevel: isCubeLevel(raw.cappiLevel)
      ? raw.cappiLevel
      : DEFAULT_SETTINGS.cappiLevel,
    watchPlaces: normalizeWatchPlaces(raw.watchPlaces, DEFAULT_SETTINGS.watch),
    alertTypes: normalizeAlertTypes(raw.alertTypes),
    overlayOpacity: normalizeOverlayOpacity(raw.overlayOpacity),
    overlayOrder: Array.isArray(raw.overlayOrder)
      ? raw.overlayOrder
          .filter((id): id is string => typeof id === "string")
          .filter((id, at, all) => all.indexOf(id) === at)
          .slice(0, 32)
      : [],
    presets,
    incidentPacks: normalizeIncidentPacks(
      raw.incidentPacks,
      DEFAULT_SETTINGS.incidentPacks,
    ),
    alertVolume:
      Number.isFinite(Number(raw.alertVolume)) &&
      Number(raw.alertVolume) >= 0 &&
      Number(raw.alertVolume) <= 1
        ? Number(raw.alertVolume)
        : DEFAULT_SETTINGS.alertVolume,
    alertSoundPath:
      typeof raw.alertSoundPath === "string" && raw.alertSoundPath.length
        ? raw.alertSoundPath.slice(0, 1024)
        : null,
    // Nothing under the floor, whatever a stored file asks for: a
    // wallpaper refreshing every minute is a loop asking a public service
    // for a frame every minute behind a spreadsheet nobody is looking at.
    wallpaperMinutes: [0, 15, 30, 60, 180].includes(
      Number(raw.wallpaperMinutes),
    )
      ? Number(raw.wallpaperMinutes)
      : DEFAULT_SETTINGS.wallpaperMinutes,
    tray: bool(raw.tray, DEFAULT_SETTINGS.tray),
    closeToTray: bool(raw.closeToTray, DEFAULT_SETTINGS.closeToTray),
    glanceOnTop: bool(raw.glanceOnTop, DEFAULT_SETTINGS.glanceOnTop),
    calm: bool(raw.calm, DEFAULT_SETTINGS.calm),
    calmBorrowed:
      raw.calmBorrowed && typeof raw.calmBorrowed === "object"
        ? Object.fromEntries(
            Object.entries(raw.calmBorrowed as Record<string, unknown>)
              .filter(
                (entry): entry is [string, boolean] =>
                  typeof entry[1] === "boolean",
              )
              .slice(0, 8),
          )
        : {},
    ambientIdleMinutes: [0, 5, 15, 30, 60].includes(
      Number(raw.ambientIdleMinutes),
    )
      ? Number(raw.ambientIdleMinutes)
      : DEFAULT_SETTINGS.ambientIdleMinutes,
    displayAwake: bool(raw.displayAwake, DEFAULT_SETTINGS.displayAwake),
    exportKeys: bool(raw.exportKeys, DEFAULT_SETTINGS.exportKeys),
    journal: bool(raw.journal, DEFAULT_SETTINGS.journal),
    catchUp: bool(raw.catchUp, DEFAULT_SETTINGS.catchUp),
    curiosities: bool(raw.curiosities, DEFAULT_SETTINGS.curiosities),
    // Bounded and cleaned, because this comes off a file somebody can edit
    // and it is only ever a list of short identifiers.
    curiositiesFound: Array.isArray(raw.curiositiesFound)
      ? [
          ...new Set(
            raw.curiositiesFound
              .filter(
                (id: unknown): id is string =>
                  typeof id === "string" && id.length > 0 && id.length <= 64,
              )
              .slice(0, 200),
          ),
        ]
      : [],
    // A time from a file somebody can edit. Anything that is not a number, or
    // is in the future, is treated as no gap at all rather than as a gap of
    // fifty years: the summary is bounded by what the record holds anyway,
    // but a nonsense figure would put a nonsense date in the sentence.
    lastSeen:
      Number.isFinite(Number(raw.lastSeen)) &&
      Number(raw.lastSeen) > 0 &&
      Number(raw.lastSeen) <= Date.now()
        ? Number(raw.lastSeen)
        : DEFAULT_SETTINGS.lastSeen,
    seenWelcome: bool(raw.seenWelcome, DEFAULT_SETTINGS.seenWelcome),
    seenReveal: bool(raw.seenReveal, DEFAULT_SETTINGS.seenReveal),
  };
}

export function cameraFromSearch(
  search: string,
  fallback: CameraState,
): CameraState {
  const params = new URLSearchParams(search);
  const values = ["lon", "lat", "zoom", "bearing", "pitch"].map((key) =>
    params.get(key),
  );
  if (values.some((value) => value === null || value.trim() === "")) {
    return fallback;
  }
  const [lon, lat, zoom, bearing, pitch] = values.map(Number);
  if (![lon, lat, zoom, bearing, pitch].every(Number.isFinite)) return fallback;
  return normalizeSettings({
    camera: { center: [lon, lat], zoom, bearing, pitch },
  }).camera;
}

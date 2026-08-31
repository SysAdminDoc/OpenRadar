import { Store } from "@tauri-apps/plugin-store";
import { isLevel2Product, type Level2ProductId } from "./level2";
import { parsePalette, type Palette } from "./palette";
import { isLanguage, translate, type LanguageId } from "../i18n";
import { isSurgeCategory, type SurgeCategory } from "./surge";
import { TEXT_SCALES } from "./units";
import type { ClockZone, TextScale, UnitSystem } from "./units";

export const APP_VERSION = "0.5.0";

import { ALERT_TYPES, type AlertType } from "./alertTypes";
import { DEFAULT_QUIET_HOURS, type QuietHours } from "./watch";

export type ThemeMode = "dark" | "light";
export type ProjectionMode = "mercator" | "globe";
export type MapStyleId =
  /**
   * Follows the theme: the dark basemap under the dark workspace, the light
   * one under the light. Choosing a style outright pins it, which is what
   * somebody who wants roads under a dark workspace means.
   */
  | "auto"
  | "dark"
  | "grayscale"
  | "roads"
  | "aerial"
  | "topography"
  | "pro-dark"
  | "pro-light"
  | "daylight";

export interface CameraState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface RadarSettings {
  enabled: boolean;
  opacity: number;
  animationSpeed: number;
  loopMinutes: number;
  futureRadar: boolean;
  /** Hand a close-in view over to the nearest site's own radar. */
  singleSite: boolean;
  /** Unfold velocity past the radar's folding limit before drawing it. */
  dealias: boolean;
  /**
   * Draw the volume the radar is sweeping now, over the last it finished.
   *
   * The archive object for a volume lands only once the whole volume is done,
   * so the finished picture is four to six minutes behind by definition. The
   * pieces are published as the radar makes them, which is a partial sweep
   * over a full one rather than a fresher full one.
   */
  live: boolean;
  /** A motion the viewer gave, rather than one read off the sweep. */
  stormMotion: { speedMs: number; fromDegrees: number } | null;
  /** The site to hold, or null to follow whichever one the view is over. */
  station: string | null;
  product: Level2ProductId;
  tilt: number;
  /**
   * Hide anything weaker than this, per product, in the product's own unit.
   *
   * Keyed by product id so a product with no entry is drawn whole, which is
   * what every product does until somebody asks otherwise. Velocity is
   * compared on how fast rather than which way, since both directions are the
   * storm.
   */
  thresholds: Record<string, number>;
}

export interface LayerSettings {
  weatherAlerts: boolean;
  spcOutlooks: boolean;
  spcDiscussions: boolean;
  stormReports: boolean;
  /** Storm cells and their tracks, from the radar's own algorithm. */
  stormCells: boolean;
  /** What the severe-probability model expects of each storm. */
  probSevere: boolean;
  earthquakes: boolean;
  wildfires: boolean;
  tropical: boolean;
  satellite: boolean;
  customOverlay: boolean;
  /** MRMS azimuthal shear over the past hour. */
  rotationTracks: boolean;
  /** MRMS maximum estimated hail size. */
  hail: boolean;
  hailSwath: boolean;
  echoTops: boolean;
  vil: boolean;
  precipRate: boolean;
  qpeHour: boolean;
  qpeDay: boolean;
  /** MRMS cloud-to-ground flash density over the past five minutes. */
  lightningDensity: boolean;
  /** GLM total-lightning flashes from GOES-East. */
  lightningFlashes: boolean;
  /** Animated GFS wind particles. */
  wind: boolean;
  /** The NHC storm surge risk picture, for one hurricane category. */
  surge: boolean;
}

export interface WatchState {
  enabled: boolean;
  /**
   * A short tone when an alert reaches the watched place. Off until asked
   * for: a weather app that makes a noise on its own is one people close.
   */
  sound: boolean;
  center: [number, number];
  radiusMiles: number;
  minSeverity: "extreme" | "severe" | "moderate" | "minor";
  /** Hours to hold ordinary alerts back, and what still gets through. */
  quietHours: QuietHours;
}

export interface PresetState {
  name: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
}

/**
 * Which shape of settings file this build writes and understands.
 *
 * Adding a setting does not move this. Everything is read with a fallback, so
 * a file without the new key loads with the default for it and a file with a
 * key this build has dropped simply goes unread. It moves when an existing key
 * changes meaning, which is the one case where reading the old value would be
 * worse than ignoring it.
 */
export const SCHEMA_VERSION = 2;

export interface AppSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  theme: ThemeMode;
  /** Which language the workspace is written in. */
  language: LanguageId;
  units: UnitSystem;
  clock: ClockZone;
  textScale: TextScale;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
  camera: CameraState;
  radar: RadarSettings;
  layers: LayerSettings;
  /** A GRLevelX colour table, applied to whatever it says it is for. */
  palette: Palette | null;
  /** Which hurricane the surge picture is about, when that layer is on. */
  surgeCategory: SurgeCategory;
  watch: WatchState;
  /**
   * Which kinds of alert to draw. Not part of the layer switches, which are
   * all plain booleans and are treated as such by the command list and the
   * layer panel. A kind missing from the record is drawn, so a kind added in
   * a later build appears rather than arriving switched off.
   */
  alertTypes: Partial<Record<AlertType, boolean>>;
  /**
   * How solid each overlay is drawn, as a fraction of what it was designed
   * to be. An overlay with no entry is drawn as designed, which is what every
   * overlay does until somebody moves a slider.
   */
  overlayOpacity: Record<string, number>;
  /**
   * The order the overlays are drawn in, bottom first. Anything not named
   * keeps its designed place, so an overlay added later appears where it was
   * meant to rather than at whichever end a saved list happens to leave.
   */
  overlayOrder: string[];
  presets: Array<PresetState | null>;
  /**
   * Whether the reader has been shown where the commands and the layers are.
   *
   * There is no other onboarding, and the command list is the thing that makes
   * everything else findable. It is one toast, shown once, and it is done with
   * as soon as the reader has either dismissed it or found the commands
   * without it.
   */
  seenWelcome: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SCHEMA_VERSION,
  theme: "dark",
  language: "en",
  units: "imperial",
  clock: "local",
  textScale: 100,
  projection: "mercator",
  mapStyle: "auto",
  camera: {
    center: [-85.5, 25.5],
    zoom: 4.55,
    bearing: 0,
    pitch: 0,
  },
  radar: {
    enabled: true,
    opacity: 0.7,
    animationSpeed: -0.1,
    loopMinutes: 120,
    futureRadar: false,
    singleSite: true,
    dealias: true,
    live: false,
    stormMotion: null,
    station: null,
    product: "reflectivity",
    tilt: 0,
    thresholds: {},
  },
  layers: {
    weatherAlerts: true,
    spcOutlooks: false,
    spcDiscussions: false,
    stormReports: false,
    stormCells: false,
    probSevere: false,
    earthquakes: false,
    wildfires: false,
    tropical: true,
    satellite: false,
    customOverlay: false,
    rotationTracks: false,
    hail: false,
    hailSwath: false,
    echoTops: false,
    vil: false,
    precipRate: false,
    qpeHour: false,
    qpeDay: false,
    lightningDensity: false,
    lightningFlashes: false,
    wind: false,
    surge: false,
  },
  palette: null,
  surgeCategory: 3,
  alertTypes: {},
  overlayOpacity: {},
  overlayOrder: [],
  watch: {
    enabled: false,
    center: [-96.8, 32.78],
    radiusMiles: 30,
    sound: false,
    minSeverity: "severe",
    quietHours: DEFAULT_QUIET_HOURS,
  },
  presets: [null, null, null, null],
  seenWelcome: false,
};

const STORAGE_KEY = "openradar.settings";
let storePromise: Promise<Store> | null = null;
let storeWriteQueue: Promise<void> = Promise.resolve();

function finiteInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isMapStyle(value: unknown): value is MapStyleId {
  return [
    "dark",
    "grayscale",
    "roads",
    "aerial",
    "topography",
    "pro-dark",
    "pro-light",
    "daylight",
  ].includes(String(value));
}

function normalizeCamera(value: unknown): CameraState {
  const raw =
    value && typeof value === "object" ? (value as Partial<CameraState>) : {};
  const center = Array.isArray(raw.center)
    ? raw.center
    : DEFAULT_SETTINGS.camera.center;
  return {
    center: [
      finiteInRange(center[0], DEFAULT_SETTINGS.camera.center[0], -180, 180),
      finiteInRange(center[1], DEFAULT_SETTINGS.camera.center[1], -85, 85),
    ],
    zoom: finiteInRange(raw.zoom, DEFAULT_SETTINGS.camera.zoom, 2.5, 15),
    bearing: finiteInRange(raw.bearing, 0, -180, 180),
    pitch: finiteInRange(raw.pitch, 0, 0, 75),
  };
}

/**
 * One rounded string stands for a camera position. Comparing the same string
 * the map publishes keeps "close enough to skip the jump" and "reported as the
 * same position" from ever disagreeing.
 */
export function cameraKey(camera: CameraState): string {
  return [
    camera.center[0].toFixed(5),
    camera.center[1].toFixed(5),
    camera.zoom.toFixed(3),
    camera.bearing.toFixed(2),
    camera.pitch.toFixed(2),
  ].join(",");
}

export function sameCamera(left: CameraState, right: CameraState): boolean {
  return cameraKey(left) === cameraKey(right);
}

function normalizeWatch(value: unknown): WatchState {
  const raw =
    value && typeof value === "object" ? (value as Partial<WatchState>) : {};
  const center = Array.isArray(raw.center)
    ? raw.center
    : DEFAULT_SETTINGS.watch.center;
  const severity = String(raw.minSeverity);
  return {
    enabled: bool(raw.enabled, DEFAULT_SETTINGS.watch.enabled),
    sound: bool(raw.sound, DEFAULT_SETTINGS.watch.sound),
    center: [
      finiteInRange(center[0], DEFAULT_SETTINGS.watch.center[0], -180, 180),
      finiteInRange(center[1], DEFAULT_SETTINGS.watch.center[1], -85, 85),
    ],
    radiusMiles: finiteInRange(
      raw.radiusMiles,
      DEFAULT_SETTINGS.watch.radiusMiles,
      5,
      200,
    ),
    minSeverity: ["extreme", "severe", "moderate", "minor"].includes(severity)
      ? (severity as WatchState["minSeverity"])
      : DEFAULT_SETTINGS.watch.minSeverity,
    quietHours: normalizeQuietHours(raw.quietHours),
  };
}

/**
 * Quiet hours out of a settings file, which may be older than this build or
 * may have been edited by hand.
 *
 * The bounds matter more here than in most of these. A start or end outside a
 * day would make the window unreadable, and an override severity that is not
 * one silences everything, which is the one outcome a weather app must not
 * arrive at by accident.
 */
function normalizeQuietHours(value: unknown): QuietHours {
  const raw =
    value && typeof value === "object" ? (value as Partial<QuietHours>) : {};
  const override = String(raw.overrideSeverity);
  return {
    enabled: bool(raw.enabled, DEFAULT_QUIET_HOURS.enabled),
    startMinute: Math.round(
      finiteInRange(raw.startMinute, DEFAULT_QUIET_HOURS.startMinute, 0, 1439),
    ),
    endMinute: Math.round(
      finiteInRange(raw.endMinute, DEFAULT_QUIET_HOURS.endMinute, 0, 1439),
    ),
    overrideSeverity: ["extreme", "severe", "moderate", "minor"].includes(
      override,
    )
      ? (override as QuietHours["overrideSeverity"])
      : DEFAULT_QUIET_HOURS.overrideSeverity,
  };
}

function normalizePreset(value: unknown): PresetState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PresetState>;
  const projection = raw.projection === "globe" ? "globe" : "mercator";
  return {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.slice(0, 40)
        : translate("app.savedView"),
    camera: normalizeCamera(raw.camera),
    projection,
    mapStyle: isMapStyle(raw.mapStyle)
      ? raw.mapStyle
      : DEFAULT_SETTINGS.mapStyle,
  };
}

function normalizePalette(value: unknown): Palette | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Palette>;
  if (!Array.isArray(raw.stops) || !raw.stops.length) return null;
  const lines = [
    raw.product ? `Product: ${raw.product}` : "",
    raw.units ? `Units: ${raw.units}` : "",
    Number.isFinite(raw.step) ? `Step: ${raw.step}` : "",
    ...raw.stops.map((stop) => {
      const value = Number(stop?.value);
      if (!Number.isFinite(value)) return "";
      const first = channels(stop?.color);
      if (!first) return "";
      const second = channels(stop?.toColor ?? null);
      if (second) return `Color: ${value} ${first} ${second}`;
      // A plain line with one colour is not the same as a solid one, and
      // writing every one of them back as solid would change how the map is
      // drawn each time the app restarts.
      return stop?.solid
        ? `SolidColor: ${value} ${first}`
        : `Color: ${value} ${first}`;
    }),
    channels(raw.rangeFolded ?? null)
      ? `RF: ${channels(raw.rangeFolded ?? null)}`
      : "",
  ].filter(Boolean);
  return parsePalette(
    lines.join("\n"),
    typeof raw.name === "string" ? raw.name.slice(0, 60) : "palette",
  );
}

/** A stored colour as the three numbers a palette line is written with. */
function channels(color: unknown): string | null {
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return null;
  }
  return [1, 3, 5]
    .map((at) => Number.parseInt(color.slice(at, at + 2), 16))
    .join(" ");
}

/** A hand-typed motion, held to something a storm could actually do. */
function normalizeStormMotion(
  value: unknown,
): { speedMs: number; fromDegrees: number } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const speedMs = Number(record.speedMs);
  const fromDegrees = Number(record.fromDegrees);
  if (!Number.isFinite(speedMs) || !Number.isFinite(fromDegrees)) return null;
  return {
    speedMs: Math.min(80, Math.max(0, speedMs)),
    fromDegrees: ((fromDegrees % 360) + 360) % 360,
  };
}

/** What came back from a settings file, and what did not. */
export interface RestoredSettings {
  settings: AppSettings;
  /**
   * The file was written by a build with a newer shape than this one, so
   * anything that changed meaning has been read as this build understands it.
   */
  fromNewerBuild: boolean;
  /**
   * Keys the file carried that this build does not read. Either they belong to
   * a newer version or the file was hand-edited.
   */
  unread: string[];
}

/**
 * Reads a settings file and says what it could not take.
 *
 * Restoring used to report the same sentence whatever happened, which on a
 * file from a newer build meant claiming everything was in place while
 * quietly dropping the parts this build has no idea about.
 */
export function restoreSettings(value: unknown): RestoredSettings {
  const settings = normalizeSettings(value);
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const version = raw.schemaVersion;
  const known = new Set(Object.keys(DEFAULT_SETTINGS));
  const unread = Object.keys(raw)
    .filter((key) => !known.has(key))
    .sort();
  const nested = (
    candidate: unknown,
    expected: readonly string[],
    prefix: string,
  ) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return;
    }
    const keys = new Set(expected);
    unread.push(
      ...Object.keys(candidate as Record<string, unknown>)
        .filter((key) => !keys.has(key))
        .map((key) => `${prefix}.${key}`),
    );
  };

  nested(raw.camera, Object.keys(DEFAULT_SETTINGS.camera), "camera");
  nested(raw.radar, Object.keys(DEFAULT_SETTINGS.radar), "radar");
  nested(raw.layers, Object.keys(DEFAULT_SETTINGS.layers), "layers");
  nested(raw.watch, Object.keys(DEFAULT_SETTINGS.watch), "watch");
  const radar = raw.radar as Record<string, unknown> | undefined;
  nested(radar?.stormMotion, ["speedMs", "fromDegrees"], "radar.stormMotion");
  nested(
    raw.palette,
    ["name", "product", "units", "step", "stops", "rangeFolded", "skipped"],
    "palette",
  );
  const palette = raw.palette as Record<string, unknown> | undefined;
  if (Array.isArray(palette?.stops)) {
    palette.stops.forEach((stop, index) =>
      nested(
        stop,
        ["value", "color", "solid", "toColor"],
        `palette.stops.${index}`,
      ),
    );
  }
  if (Array.isArray(raw.presets)) {
    raw.presets.forEach((preset, index) => {
      nested(
        preset,
        ["name", "camera", "projection", "mapStyle"],
        `presets.${index}`,
      );
      const record = preset as Record<string, unknown> | null;
      nested(
        record?.camera,
        Object.keys(DEFAULT_SETTINGS.camera),
        `presets.${index}.camera`,
      );
    });
  }
  return {
    settings,
    fromNewerBuild: typeof version === "number" && version > SCHEMA_VERSION,
    unread: [...new Set(unread)].sort(),
  };
}

/**
 * The per-product thresholds, with anything that is not a finite number
 * dropped.
 *
 * A threshold that cannot be compared against would hide the whole picture, so
 * a bad entry means no threshold for that product rather than a threshold of
 * nothing. The file is hand-editable, which is why this is checked at all.
 */
function normalizeThresholds(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    // Well outside anything any product reads, in either direction.
    if (entry < -1000 || entry > 10000) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * Which kinds of alert are switched off, with anything unrecognised dropped.
 *
 * Only the false entries are worth keeping: a kind nobody has touched is on,
 * and storing every kind as true would mean a kind added later arrived
 * switched off for everyone who had saved settings before it existed.
 */
function normalizeAlertTypes(
  value: unknown,
): Partial<Record<AlertType, boolean>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<AlertType, boolean>> = {};
  const known = new Set(ALERT_TYPES.map((kind) => kind.id));
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(key as AlertType)) continue;
    if (entry === false) out[key as AlertType] = false;
  }
  return out;
}

/**
 * The per-overlay opacities, with anything unusable dropped.
 *
 * Only entries that differ from full are kept, so an overlay added in a later
 * build is drawn as designed rather than arriving at whatever a saved file
 * happened to hold.
 */
function normalizeOverlayOpacity(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    const clamped = Math.min(1, Math.max(0.1, entry));
    // Full is the default, so storing it would only make a bigger file.
    if (clamped >= 1) continue;
    out[key] = clamped;
  }
  return out;
}

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
    // A language from a build that had one this build does not falls back to
    // English rather than painting the screen with missing keys.
    language: isLanguage(raw.language) ? raw.language : "en",
    units: raw.units === "metric" ? "metric" : "imperial",
    clock: raw.clock === "utc" ? "utc" : "local",
    textScale: TEXT_SCALES.includes(raw.textScale as TextScale)
      ? (raw.textScale as TextScale)
      : 100,
    projection: raw.projection === "globe" ? "globe" : "mercator",
    mapStyle: isMapStyle(raw.mapStyle)
      ? raw.mapStyle
      : DEFAULT_SETTINGS.mapStyle,
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
      live: bool(radar.live, DEFAULT_SETTINGS.radar.live),
      dealias: bool(radar.dealias, DEFAULT_SETTINGS.radar.dealias),
      stormMotion: normalizeStormMotion(radar.stormMotion),
      station:
        typeof radar.station === "string" && /^[A-Za-z]{4}$/.test(radar.station)
          ? radar.station.toUpperCase()
          : null,
      product: isLevel2Product(radar.product)
        ? radar.product
        : DEFAULT_SETTINGS.radar.product,
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
      spcDiscussions: bool(
        layers.spcDiscussions,
        DEFAULT_SETTINGS.layers.spcDiscussions,
      ),
      stormReports: bool(
        layers.stormReports,
        DEFAULT_SETTINGS.layers.stormReports,
      ),
      stormCells: bool(layers.stormCells, DEFAULT_SETTINGS.layers.stormCells),
      probSevere: bool(layers.probSevere, DEFAULT_SETTINGS.layers.probSevere),
      earthquakes: bool(
        layers.earthquakes,
        DEFAULT_SETTINGS.layers.earthquakes,
      ),
      wildfires: bool(layers.wildfires, DEFAULT_SETTINGS.layers.wildfires),
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
      hail: bool(layers.hail, DEFAULT_SETTINGS.layers.hail),
      hailSwath: bool(layers.hailSwath, DEFAULT_SETTINGS.layers.hailSwath),
      echoTops: bool(layers.echoTops, DEFAULT_SETTINGS.layers.echoTops),
      vil: bool(layers.vil, DEFAULT_SETTINGS.layers.vil),
      precipRate: bool(layers.precipRate, DEFAULT_SETTINGS.layers.precipRate),
      qpeHour: bool(layers.qpeHour, DEFAULT_SETTINGS.layers.qpeHour),
      qpeDay: bool(layers.qpeDay, DEFAULT_SETTINGS.layers.qpeDay),
      lightningDensity: bool(
        layers.lightningDensity,
        DEFAULT_SETTINGS.layers.lightningDensity,
      ),
      lightningFlashes: bool(
        layers.lightningFlashes,
        DEFAULT_SETTINGS.layers.lightningFlashes,
      ),
      wind: bool(layers.wind, DEFAULT_SETTINGS.layers.wind),
      surge: bool(layers.surge, DEFAULT_SETTINGS.layers.surge),
    },
    // A palette is re-read from its own text rather than trusted as an
    // object, so a hand-edited settings file cannot put anything on the map
    // that the parser would not have produced itself.
    palette: normalizePalette(raw.palette),
    surgeCategory: isSurgeCategory(raw.surgeCategory)
      ? raw.surgeCategory
      : DEFAULT_SETTINGS.surgeCategory,
    watch: normalizeWatch(raw.watch),
    alertTypes: normalizeAlertTypes(raw.alertTypes),
    overlayOpacity: normalizeOverlayOpacity(raw.overlayOpacity),
    overlayOrder: Array.isArray(raw.overlayOrder)
      ? raw.overlayOrder
          .filter((id): id is string => typeof id === "string")
          .filter((id, at, all) => all.indexOf(id) === at)
          .slice(0, 32)
      : [],
    presets,
    seenWelcome: bool(raw.seenWelcome, DEFAULT_SETTINGS.seenWelcome),
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

/** True inside the Tauri window, false in a browser preview. */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getStore(): Promise<Store> {
  storePromise ??= Store.load("settings.json", {
    autoSave: false,
    defaults: { settings: DEFAULT_SETTINGS },
  });
  return storePromise;
}

/**
 * Whether a dropped file is a settings export rather than something to draw.
 *
 * A GeoJSON document never carries a schema version, and a settings file
 * always does, so the two cannot be confused for one another.
 */
export function looksLikeSettings(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return false;
    const record = parsed as Record<string, unknown>;
    return (
      typeof record.schemaVersion === "number" &&
      record.type !== "FeatureCollection" &&
      record.type !== "Feature"
    );
  } catch {
    return false;
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    if (isDesktopRuntime()) {
      const value = await (await getStore()).get<unknown>("settings");
      return normalizeSettings(value);
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeSettings(undefined);
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (isDesktopRuntime()) {
    const write = storeWriteQueue
      .catch(() => {})
      .then(async () => {
        const store = await getStore();
        await store.set("settings", normalized);
        await store.save();
      });
    storeWriteQueue = write;
    return write;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
}

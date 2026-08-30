import { Store } from "@tauri-apps/plugin-store";
import { isLevel2Product, type Level2ProductId } from "./level2";
import { parsePalette, type Palette } from "./palette";
import { isLanguage, translate, type LanguageId } from "../i18n";
import { isSurgeCategory, type SurgeCategory } from "./surge";
import { TEXT_SCALES } from "./units";
import type { ClockZone, TextScale, UnitSystem } from "./units";

export const APP_VERSION = "0.2.0";

export type ThemeMode = "dark" | "light";
export type ProjectionMode = "mercator" | "globe";
export type MapStyleId =
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
  /** The site to hold, or null to follow whichever one the view is over. */
  station: string | null;
  product: Level2ProductId;
  tilt: number;
}

export interface LayerSettings {
  weatherAlerts: boolean;
  spcOutlooks: boolean;
  spcDiscussions: boolean;
  stormReports: boolean;
  earthquakes: boolean;
  wildfires: boolean;
  tropical: boolean;
  satellite: boolean;
  customOverlay: boolean;
  /** MRMS azimuthal shear over the past hour. */
  rotationTracks: boolean;
  /** MRMS maximum estimated hail size. */
  hail: boolean;
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
  center: [number, number];
  radiusMiles: number;
  minSeverity: "extreme" | "severe" | "moderate" | "minor";
}

export interface PresetState {
  name: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
}

export interface AppSettings {
  schemaVersion: 2;
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
  presets: Array<PresetState | null>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 2,
  theme: "dark",
  language: "en",
  units: "imperial",
  clock: "local",
  textScale: 100,
  projection: "mercator",
  mapStyle: "dark",
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
    station: null,
    product: "reflectivity",
    tilt: 0,
  },
  layers: {
    weatherAlerts: true,
    spcOutlooks: false,
    spcDiscussions: false,
    stormReports: false,
    earthquakes: false,
    wildfires: false,
    tropical: true,
    satellite: false,
    customOverlay: false,
    rotationTracks: false,
    hail: false,
    lightningDensity: false,
    lightningFlashes: false,
    wind: false,
    surge: false,
  },
  palette: null,
  surgeCategory: 3,
  watch: {
    enabled: false,
    center: [-96.8, 32.78],
    radiusMiles: 30,
    minSeverity: "severe",
  },
  presets: [null, null, null, null],
};

const STORAGE_KEY = "openradar.settings";
let storePromise: Promise<Store> | null = null;

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
    schemaVersion: 2,
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
      dealias: bool(radar.dealias, DEFAULT_SETTINGS.radar.dealias),
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
    presets,
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
    const store = await getStore();
    await store.set("settings", normalized);
    await store.save();
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized, null, 2));
}

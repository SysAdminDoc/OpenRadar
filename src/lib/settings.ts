import { Store } from "@tauri-apps/plugin-store";

export const APP_VERSION = "0.1.0";

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
}

export interface LayerSettings {
  weatherAlerts: boolean;
  earthquakes: boolean;
  wildfires: boolean;
  customOverlay: boolean;
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
  projection: ProjectionMode;
  mapStyle: MapStyleId;
  camera: CameraState;
  radar: RadarSettings;
  layers: LayerSettings;
  presets: Array<PresetState | null>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 2,
  theme: "dark",
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
  },
  layers: {
    weatherAlerts: true,
    earthquakes: false,
    wildfires: false,
    customOverlay: false,
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

function normalizePreset(value: unknown): PresetState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PresetState>;
  const projection = raw.projection === "globe" ? "globe" : "mercator";
  return {
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.slice(0, 40)
        : "Saved view",
    camera: normalizeCamera(raw.camera),
    projection,
    mapStyle: isMapStyle(raw.mapStyle)
      ? raw.mapStyle
      : DEFAULT_SETTINGS.mapStyle,
  };
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
      earthquakes: bool(
        layers.earthquakes,
        DEFAULT_SETTINGS.layers.earthquakes,
      ),
      wildfires: bool(layers.wildfires, DEFAULT_SETTINGS.layers.wildfires),
      customOverlay: bool(
        layers.customOverlay,
        DEFAULT_SETTINGS.layers.customOverlay,
      ),
    },
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

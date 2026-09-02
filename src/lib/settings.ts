import { Store } from "@tauri-apps/plugin-store";
import { isLevel2Product, type Level2ProductId } from "./level2";
import {
  isClassificationProduct,
  type ClassificationProduct,
} from "./classification";
import {
  MAX_PALETTES,
  paletteUnit,
  parsePalette,
  type Palette,
} from "./palette";
import { isLanguage, translate, type LanguageId } from "../i18n";
import { isSurgeCategory, type SurgeCategory } from "./surge";
import {
  SATELLITE_PRODUCTS,
  type SatelliteProductId,
} from "./providers/satellite";
import {
  parseTheme,
  themeText,
  THEME_TOKENS,
  type WorkspaceTheme,
} from "./theme";
import { TEXT_SCALES } from "./units";
import type { ClockZone, TextScale, UnitSystem } from "./units";

export const APP_VERSION = "0.6.0";

import { ALERT_TYPES, type AlertType } from "./alertTypes";
import {
  DEFAULT_QUIET_HOURS,
  MAX_WATCH_PLACES,
  type QuietHours,
  type WatchPlace,
} from "./watch";

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
  /**
   * Fade the finished sweep behind the one being made, the way a phosphor
   * screen does.
   *
   * Only ever drawn alongside `live`, which is the only picture with two
   * sweeps in it. It is opacity and nothing else: no gate value moves, and
   * the legend says the age of the older half as well as the newer, because a
   * decayed picture is older than an undecayed one and the reader has to be
   * able to tell.
   */
  persistence: boolean;
  /** A motion the viewer gave, rather than one read off the sweep. */
  stormMotion: { speedMs: number; fromDegrees: number } | null;
  /** The site to hold, or null to follow whichever one the view is over. */
  station: string | null;
  product: Level2ProductId;
  /**
   * Which Level III product the hydrometeor classification is read from: the
   * lowest tilt, or the hybrid scan the whole volume is read into.
   */
  classificationProduct: ClassificationProduct;
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
  /** What the radar's own algorithm says is falling at the held site. */
  classification: boolean;
  /** What the severe-probability model expects of each storm. */
  probSevere: boolean;
  earthquakes: boolean;
  wildfires: boolean;
  /** NOAA's hand-drawn smoke analysis for the day. */
  smoke: boolean;
  /** Where the HRRR model expects smoke to go, along the forecast tail. */
  forecastSmoke: boolean;
  /** Surface observations, drawn as the conventional station plots. */
  metar: boolean;
  riverGauges: boolean;
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
  /** What kind of precipitation the network says is falling. */
  precipType: boolean;
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
   * What the reader calls home, when they have called it anything.
   *
   * Absent until somebody names it, and then it is what the watch surface and
   * an alert say instead of the built-in word. It is a label and nothing
   * else: no request, no poll and no radius depends on it.
   */
  name?: string;
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

/**
 * Another place worth watching, beside home.
 *
 * Home is the `watch` above, which is where the setting has always lived and
 * where it stays. These are the others: a school, a relative's house, the far
 * end of tomorrow's drive. Each carries its own radius, its own severity
 * floor, its own sound and quiet policy, because the answer to "wake me for
 * this" is not the same at home as it is somewhere you will be on Tuesday.
 */
export interface WatchPlaceState extends WatchState {
  /** Stable across renames, so a place keeps its identity when retitled. */
  id: string;
  name: string;
  /**
   * The kinds this place cares about, when it cares about fewer than the ones
   * switched on. Absent means all of them.
   */
  kinds?: Partial<Record<string, boolean>>;
}

export interface PresetState {
  name: string;
  camera: CameraState;
  projection: ProjectionMode;
  mapStyle: MapStyleId;
}

/** A portable pointer to a native PMTiles incident pack, never its tile data. */
export interface IncidentPackReference {
  id: string;
  name: string;
  bounds: { west: number; south: number; east: number; north: number };
  minZoom: number;
  maxZoom: number;
  bytes: number;
  sha256: string;
  attribution: string;
}

export interface IncidentPackSettings {
  /** The ceiling for the separate durable pack store, in MiB. */
  diskLimitMb: number;
  /** The local pack used as the basemap, or null for the normal online map. */
  selectedId: string | null;
  /** Lightweight backup references. PMTiles bytes stay in app data. */
  references: IncidentPackReference[];
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
export const SCHEMA_VERSION = 3;

export interface AppSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  theme: ThemeMode;
  /**
   * A look over the top of the built-in one, or null for the plain workspace.
   *
   * It reaches the chrome tokens and nothing else, which is the point of it
   * living in its own module: see `theme.ts`. A reader who has only picked an
   * accent colour has one of these carrying three tokens.
   */
  workspaceTheme: WorkspaceTheme | null;
  /**
   * The seasonal packs, and which of them have been sent away.
   *
   * On unless somebody says otherwise, because a pack that has to be found in
   * a settings panel is a pack nobody ever sees. It reaches the same chrome
   * tokens a theme file does and nothing else, it stands down while a warning
   * is in force at a watched place, and the switch gives the plain workspace
   * back at once. `declined` maps an occasion to the year it was sent away,
   * which is the year its window began rather than the calendar year: a
   * midwinter pack declined in December does not return on the first.
   */
  /**
   * The weather where the reader watches, drawn on the chrome.
   *
   * Off until asked for, because an app that animates on its own is one
   * people switch off in the first week. It reads a station's own report and
   * stops when that report is too old to speak for the present.
   */
  ambient: boolean;
  /**
   * The almanac card in Storm history.
   *
   * On unless somebody says otherwise: it is built from a file already on the
   * disk, it costs no request, and a reader who never opens Storm history
   * never meets it. It stands down while a warning is in force at a watched
   * place, like everything else here.
   */
  almanac: boolean;
  occasions: {
    enabled: boolean;
    declined: Record<string, number>;
    /** The year each occasion's one-line notice was given, so it is given once. */
    seen: Record<string, number>;
  };
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
  /**
   * The GRLevelX colour tables the reader has imported, up to `MAX_PALETTES`.
   *
   * A shelf rather than a slot. Radar people compare a storm across tools by
   * loading the same table everywhere, and they keep more than one: a
   * reflectivity scale they read every day and a velocity scale for the
   * afternoons that need one. Holding a single table meant importing the
   * second silently threw away the first.
   */
  palettes: Palette[];
  /**
   * Which table is in force for each unit, by the table's own name.
   *
   * Keyed on the lowercased unit rather than on a product, because that is
   * what a `.pal` file declares and what the native renderer selects on. A
   * name that is no longer in the library is left in place and ignored, so
   * removing a table and importing it again puts it back where it was.
   */
  paletteAssignments: Record<string, string>;
  /** Which hurricane the surge picture is about, when that layer is on. */
  surgeCategory: SurgeCategory;
  watch: WatchState;
  /**
   * Take the map to a warning as it arrives.
   *
   * Off until asked for, like the tone: an app that moves the view out from
   * under somebody is worse than one that waits to be asked. One preference
   * for the workspace rather than one per watched place, because it is about
   * what the map does and not about which places matter.
   */
  followNewWarnings: boolean;
  /**
   * Which GOES-East view the satellite layer draws.
   *
   * GeoColor by default, which is the picture people expect. The infrared
   * band is the one to switch to after dark, when GeoColor has nothing to say
   * about a storm top.
   */
  satelliteProduct: SatelliteProductId;
  /**
   * Places beside home, up to nine of them, so home plus these is ten. Kept
   * as its own key rather than folded into `watch`, which every build since
   * the first has read and written.
   */
  watchPlaces: WatchPlaceState[];
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
  incidentPacks: IncidentPackSettings;
  /**
   * Whether the reader has been shown where the commands and the layers are.
   *
   * There is no other onboarding, and the command list is the thing that makes
   * everything else findable. It is one toast, shown once, and it is done with
   * as soon as the reader has either dismissed it or found the commands
   * without it.
   */
  seenWelcome: boolean;
  /**
   * Whether the disc has drawn itself.
   *
   * Its own flag rather than `seenWelcome`, because the greeting toast writes
   * that one the moment it is pushed and the reveal would have been cut off
   * by the thing it plays beside. Both are cleared by the control that asks
   * for the greeting again.
   */
  seenReveal: boolean;
  /**
   * Whether the app says what happened while it was closed.
   *
   * On, because it is the one thing a weather app can say on a launch that is
   * about the weather rather than about itself, and it is built entirely from
   * the record already on the disk: nothing is fetched to answer it and
   * nothing is reconstructed. Off in one press, for good.
   */
  catchUp: boolean;
  /**
   * When the app was last running, in milliseconds.
   *
   * Written on the clock while the window is open rather than on the way out,
   * because a process that is killed, crashes or loses power never runs its
   * closing code, and a summary that only appears after a tidy exit is a
   * summary that appears least often when somebody most wants it. Zero on a
   * first run, which is not a gap, so nothing is said.
   */
  lastSeen: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SCHEMA_VERSION,
  theme: "dark",
  workspaceTheme: null,
  ambient: false,
  almanac: true,
  occasions: { enabled: true, declined: {}, seen: {} },
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
    persistence: false,
    stormMotion: null,
    station: null,
    product: "reflectivity",
    classificationProduct: "HHC",
    tilt: 0,
    thresholds: {},
  },
  layers: {
    weatherAlerts: true,
    spcOutlooks: false,
    spcDiscussions: false,
    stormReports: false,
    stormCells: false,
    classification: false,
    probSevere: false,
    earthquakes: false,
    wildfires: false,
    smoke: false,
    forecastSmoke: false,
    metar: false,
    riverGauges: false,
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
    precipType: false,
    lightningDensity: false,
    lightningFlashes: false,
    wind: false,
    surge: false,
  },
  palettes: [],
  paletteAssignments: {},
  surgeCategory: 3,
  alertTypes: {},
  overlayOpacity: {},
  overlayOrder: [],
  watchPlaces: [],
  watch: {
    enabled: false,
    center: [-96.8, 32.78],
    radiusMiles: 30,
    sound: false,
    minSeverity: "severe",
    quietHours: DEFAULT_QUIET_HOURS,
  },
  followNewWarnings: false,
  satelliteProduct: "geocolor",
  presets: [null, null, null, null],
  incidentPacks: {
    diskLimitMb: 4096,
    selectedId: null,
    references: [],
  },
  seenWelcome: false,
  seenReveal: false,
  catchUp: true,
  lastSeen: 0,
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
    ...(typeof raw.name === "string" && raw.name.trim()
      ? { name: raw.name.trim().slice(0, 60) }
      : {}),
  };
}

/**
 * The places beside home, out of a settings file.
 *
 * Anything that is not a place is dropped rather than repaired into one: a
 * watch with no position is a notification that never fires, which is worse
 * than a place that is simply not there. The list is capped at nine, because
 * home is the tenth.
 */
/**
 * Every place being watched, home first.
 *
 * Home is the `watch` the settings file has always held; the rest are the
 * list beside it. Everything that acts on a watch reads this rather than
 * either key, so there is one answer to "what is being watched" and the
 * storage shape is nobody else's problem.
 */
export function watchedPlaces(settings: AppSettings): WatchPlace[] {
  const home: WatchPlace = {
    ...settings.watch,
    id: "home",
    // The reader's own word for it if they have one, and the built-in word if
    // they have not. `named` is what tells an announcement apart: a place
    // somebody called Casa is worth saying, and the default "Home" said back
    // to somebody who watches one place is noise.
    name: settings.watch.name?.trim() || translate("watch.home"),
    named: Boolean(settings.watch.name?.trim()),
  };
  return [home, ...settings.watchPlaces].slice(0, MAX_WATCH_PLACES);
}

function normalizeWatchPlaces(value: unknown): WatchPlaceState[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const places: WatchPlaceState[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<WatchPlaceState>;
    const center = Array.isArray(raw.center) ? raw.center : null;
    if (
      !center ||
      !Number.isFinite(Number(center[0])) ||
      !Number.isFinite(Number(center[1]))
    ) {
      continue;
    }
    const id =
      typeof raw.id === "string" && raw.id.trim() && !seen.has(raw.id)
        ? raw.id
        : `place-${places.length + 1}-${Math.abs(
            Math.round(Number(center[0]) * 1000),
          )}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const watch = normalizeWatch(raw);
    places.push({
      ...watch,
      id,
      name:
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim().slice(0, 60)
          : `Place ${places.length + 1}`,
      ...(raw.kinds && typeof raw.kinds === "object"
        ? {
            kinds: Object.fromEntries(
              Object.entries(raw.kinds).filter(
                ([, on]) => typeof on === "boolean",
              ),
            ),
          }
        : {}),
    });
    if (places.length >= MAX_WATCH_PLACES - 1) break;
  }
  return places;
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

function normalizeIncidentPackReference(
  value: unknown,
): IncidentPackReference | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentPackReference>;
  const bounds = raw.bounds;
  if (
    typeof raw.id !== "string" ||
    !/^[0-9a-f]{24}$/i.test(raw.id) ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    !bounds ||
    typeof bounds !== "object" ||
    typeof raw.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/i.test(raw.sha256) ||
    typeof raw.attribution !== "string" ||
    !raw.attribution.trim()
  ) {
    return null;
  }
  const normalizedBounds = {
    west: finiteInRange(bounds.west, Number.NaN, -180, 180),
    south: finiteInRange(bounds.south, Number.NaN, -85, 85),
    east: finiteInRange(bounds.east, Number.NaN, -180, 180),
    north: finiteInRange(bounds.north, Number.NaN, -85, 85),
  };
  if (
    Object.values(normalizedBounds).some((entry) => !Number.isFinite(entry)) ||
    normalizedBounds.west >= normalizedBounds.east ||
    normalizedBounds.south >= normalizedBounds.north
  ) {
    return null;
  }
  const minZoom = Math.round(finiteInRange(raw.minZoom, Number.NaN, 2, 15));
  const maxZoom = Math.round(finiteInRange(raw.maxZoom, Number.NaN, 2, 15));
  if (
    !Number.isFinite(minZoom) ||
    !Number.isFinite(maxZoom) ||
    minZoom > maxZoom
  ) {
    return null;
  }
  return {
    id: raw.id.toLowerCase(),
    name: raw.name.trim().slice(0, 60),
    bounds: normalizedBounds,
    minZoom,
    maxZoom,
    bytes: Math.round(finiteInRange(raw.bytes, 0, 0, Number.MAX_SAFE_INTEGER)),
    sha256: raw.sha256.toLowerCase(),
    attribution: raw.attribution.trim().slice(0, 200),
  };
}

function normalizeIncidentPacks(value: unknown): IncidentPackSettings {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<IncidentPackSettings>)
      : {};
  const references = Array.isArray(raw.references)
    ? raw.references
        .map(normalizeIncidentPackReference)
        .filter((entry): entry is IncidentPackReference => entry !== null)
        .filter(
          (entry, at, all) =>
            all.findIndex((item) => item.id === entry.id) === at,
        )
        .slice(0, 64)
    : [];
  const selectedId =
    typeof raw.selectedId === "string" && /^[0-9a-f]{24}$/i.test(raw.selectedId)
      ? raw.selectedId.toLowerCase()
      : null;
  return {
    diskLimitMb: Math.round(
      finiteInRange(
        raw.diskLimitMb,
        DEFAULT_SETTINGS.incidentPacks.diskLimitMb,
        256,
        32_768,
      ),
    ),
    selectedId,
    references,
  };
}

/**
 * The library, read back from a settings file.
 *
 * A build before this one held one table under `palette`, so that becomes a
 * library of one rather than being dropped: the reader loaded it, and an
 * upgrade is not a reason to throw somebody's colour scale away.
 */
/**
 * The library with one more table on it, in force for what it is for.
 *
 * Null when the shelf is full and this is a table that is not already on it,
 * because silently dropping one of the reader's own tables to make room is
 * worse than saying the shelf is full.
 *
 * A table imported under a name already there replaces that one in place. It
 * keeps its position and keeps whatever it was assigned to, since re-importing
 * an edited file is an update to what the reader arranged rather than a new
 * thing to arrange.
 */
export function withPalette(
  settings: AppSettings,
  palette: Palette,
): AppSettings | null {
  const at = settings.palettes.findIndex((held) => held.name === palette.name);
  if (at < 0 && settings.palettes.length >= MAX_PALETTES) return null;
  const palettes =
    at < 0
      ? [...settings.palettes, palette]
      : settings.palettes.map((held, index) => (index === at ? palette : held));
  return {
    ...settings,
    palettes,
    paletteAssignments: {
      ...settings.paletteAssignments,
      [paletteUnit(palette).toLowerCase()]: palette.name,
    },
  };
}

/** The library without a table, and without any assignment that named it. */
export function withoutPalette(
  settings: AppSettings,
  name: string,
): AppSettings {
  const paletteAssignments = Object.fromEntries(
    Object.entries(settings.paletteAssignments).filter(
      ([, assigned]) => assigned !== name,
    ),
  );
  return {
    ...settings,
    palettes: settings.palettes.filter((held) => held.name !== name),
    paletteAssignments,
  };
}

/** One unit's table put in force, or taken out of force when name is null. */
export function withPaletteAssigned(
  settings: AppSettings,
  unit: string,
  name: string | null,
): AppSettings {
  const key = unit.trim().toLowerCase();
  const paletteAssignments = { ...settings.paletteAssignments };
  if (name) {
    paletteAssignments[key] = name;
  } else {
    delete paletteAssignments[key];
  }
  return { ...settings, paletteAssignments };
}

function normalizePalettes(raw: Record<string, unknown>): Palette[] {
  const source = Array.isArray(raw.palettes)
    ? raw.palettes
    : raw.palette
      ? [raw.palette]
      : [];
  const read: Palette[] = [];
  for (const entry of source) {
    const palette = normalizePalette(entry);
    if (!palette) continue;
    // One name, one table. A second import under a name already on the shelf
    // replaced the first at import time, so two here is a hand-edited file.
    if (read.some((held) => held.name === palette.name)) continue;
    read.push(palette);
    if (read.length === MAX_PALETTES) break;
  }
  return read;
}

/**
 * Which table is in force per unit, dropped to the ones that could be true.
 *
 * The names are not checked against the library here. A name for a table that
 * is not on the shelf simply does not resolve, and keeping it means removing a
 * table and importing it again restores the assignment it had.
 */
function normalizePaletteAssignments(
  raw: Record<string, unknown>,
): Record<string, string> {
  const stored = raw.paletteAssignments;
  const assignments: Record<string, string> = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [unit, name] of Object.entries(
      stored as Record<string, unknown>,
    )) {
      if (typeof name !== "string" || !name) continue;
      assignments[unit.trim().toLowerCase()] = name.slice(0, 60);
    }
  } else if (!Array.isArray(raw.palettes) && raw.palette) {
    // The single table an older build held was always in force, so the
    // upgrade keeps it in force rather than leaving the map suddenly plain.
    const only = normalizePalette(raw.palette);
    if (only) {
      assignments[paletteUnit(only).toLowerCase()] = only.name;
    }
  }
  return assignments;
}

/**
 * A stored theme, read back out of its own text.
 *
 * The same rule a colour table follows, for the same reason: a hand-edited
 * `settings.json` must not be able to put anything on screen that the parser
 * would not have produced from a file. So the object is written back out as
 * the theme file it came from and read again, and whatever survives that is
 * what applies.
 */
/**
 * The seasonal packs out of a settings file.
 *
 * A year that is not a year is dropped rather than repaired: the worst that
 * does is show a pack somebody sent away once, which is a great deal better
 * than reading a hand-edited file as "declined for ever".
 */
function normalizeOccasions(value: unknown): AppSettings["occasions"] {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const years = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return out;
    for (const [id, year] of Object.entries(value as Record<string, unknown>)) {
      if (typeof year !== "number" || !Number.isInteger(year)) continue;
      if (year < 1970 || year > 9999) continue;
      out[id.slice(0, 40)] = year;
    }
    return out;
  };
  return {
    enabled: bool(raw.enabled, DEFAULT_SETTINGS.occasions.enabled),
    declined: years(raw.declined),
    seen: years(raw.seen),
  };
}

function normalizeTheme(value: unknown): WorkspaceTheme | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WorkspaceTheme>;
  if (!raw.tokens || typeof raw.tokens !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name : "theme";
  const text = themeText({
    name,
    base: raw.base === "light" ? "light" : "dark",
    tokens: Object.fromEntries(
      Object.entries(raw.tokens as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  });
  return parseTheme(text, name)?.theme ?? null;
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
  // `name` is optional, so it is not a key of the default and has to be
  // named here or a backup carrying one reports it as a key this build did
  // not read.
  nested(raw.occasions, Object.keys(DEFAULT_SETTINGS.occasions), "occasions");
  nested(raw.watch, [...Object.keys(DEFAULT_SETTINGS.watch), "name"], "watch");
  nested(
    raw.incidentPacks,
    Object.keys(DEFAULT_SETTINGS.incidentPacks),
    "incidentPacks",
  );
  const radar = raw.radar as Record<string, unknown> | undefined;
  nested(radar?.stormMotion, ["speedMs", "fromDegrees"], "radar.stormMotion");
  // A theme is checked to its own tokens too, the way a palette's stops are:
  // a directive this build has never heard of is dropped by the parser, and
  // dropping it silently is how a reader restores a file and cannot see what
  // did not come back. A value that is not a theme at all is reported as one
  // key rather than inspected, since there is nothing inside it to inspect.
  const storedTheme = raw.workspaceTheme;
  const themeIsRecord =
    !!storedTheme &&
    typeof storedTheme === "object" &&
    !Array.isArray(storedTheme);
  // Null is the value for "no theme" rather than a value nobody could read.
  if (storedTheme !== undefined && storedTheme !== null && !themeIsRecord) {
    unread.push("workspaceTheme");
  } else {
    nested(storedTheme, ["name", "base", "tokens"], "workspaceTheme");
    nested(
      (storedTheme as Record<string, unknown> | undefined)?.tokens,
      THEME_TOKENS.map((token) => token.directive),
      "workspaceTheme.tokens",
    );
  }
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
  const incidentPacks = raw.incidentPacks as
    Record<string, unknown> | undefined;
  if (Array.isArray(incidentPacks?.references)) {
    incidentPacks.references.forEach((reference, index) => {
      nested(
        reference,
        [
          "id",
          "name",
          "bounds",
          "minZoom",
          "maxZoom",
          "bytes",
          "sha256",
          "attribution",
        ],
        `incidentPacks.references.${index}`,
      );
      const record = reference as Record<string, unknown> | null;
      nested(
        record?.bounds,
        ["west", "south", "east", "north"],
        `incidentPacks.references.${index}.bounds`,
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
    workspaceTheme: normalizeTheme(raw.workspaceTheme),
    ambient: bool(raw.ambient, DEFAULT_SETTINGS.ambient),
    almanac: bool(raw.almanac, DEFAULT_SETTINGS.almanac),
    occasions: normalizeOccasions(raw.occasions),
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
      persistence: bool(radar.persistence, DEFAULT_SETTINGS.radar.persistence),
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
      precipType: bool(layers.precipType, DEFAULT_SETTINGS.layers.precipType),
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
    // Every palette is re-read from its own text rather than trusted as an
    // object, so a hand-edited settings file cannot put anything on the map
    // that the parser would not have produced itself.
    palettes: normalizePalettes(raw),
    paletteAssignments: normalizePaletteAssignments(raw),
    surgeCategory: isSurgeCategory(raw.surgeCategory)
      ? raw.surgeCategory
      : DEFAULT_SETTINGS.surgeCategory,
    watch: normalizeWatch(raw.watch),
    followNewWarnings: bool(
      raw.followNewWarnings,
      DEFAULT_SETTINGS.followNewWarnings,
    ),
    satelliteProduct: SATELLITE_PRODUCTS.some(
      (product) => product.id === raw.satelliteProduct,
    )
      ? (raw.satelliteProduct as SatelliteProductId)
      : DEFAULT_SETTINGS.satelliteProduct,
    watchPlaces: normalizeWatchPlaces(raw.watchPlaces),
    alertTypes: normalizeAlertTypes(raw.alertTypes),
    overlayOpacity: normalizeOverlayOpacity(raw.overlayOpacity),
    overlayOrder: Array.isArray(raw.overlayOrder)
      ? raw.overlayOrder
          .filter((id): id is string => typeof id === "string")
          .filter((id, at, all) => all.indexOf(id) === at)
          .slice(0, 32)
      : [],
    presets,
    incidentPacks: normalizeIncidentPacks(raw.incidentPacks),
    catchUp: bool(raw.catchUp, DEFAULT_SETTINGS.catchUp),
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

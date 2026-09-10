/**
 * The shape of everything the workspace remembers.
 *
 * Lifted out of the store on 2026-09-09. The store has to import the module
 * that owns each section's vocabulary to normalise it, so every one of those
 * leaves must never import the store back, and three did in a week: each was
 * asking for a type and there was nowhere else to ask. This is the nowhere
 * else. It imports nothing at runtime, so nothing that reads it can close a
 * ring, and the compiler erases every import below.
 */
import type { SpcHazard } from "../spcHazards";
import type { Level2ProductId } from "../level2";
import type { ClassificationProduct } from "../classification";
import type { Palette } from "../palette";
import type { LanguageId } from "../../i18n";
import type { SurgeCategory } from "../surge";
import type { SnowfallWindow } from "../snowfall";
import type { SatelliteBandId } from "../satelliteBands";
import type { GaugeQpePeriod } from "../gaugeQpe";
import type { ApproachSettings } from "../approach";
import type { LightningRule } from "../lightningWatch";
import type {
  IsothermLevel,
  LightningForecast,
  LightningJump,
  LightningWindow,
} from "../lightningGrids";
import type { CappiField, CubeLevel } from "../cappi";
import type { AzShearLevel, RotationPeriod } from "../rotationTrack";
import type { WorkspaceTheme } from "../theme";
import type { ClockZone, TextScale, UnitSystem } from "../units";
import type { AlertType } from "../alertTypes";
import type { QuietHours } from "../watch";

export type ThemeMode = "dark" | "light";
export type ProjectionMode = "mercator" | "globe";
export type MapStyleId =
  /**
   * Follows the theme: the dark basemap under the dark workspace, the light
   * one under the light. Choosing a style outright pins it, which is what
   * somebody who wants roads under a dark workspace means.
   */
  | "auto"
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
  /**
   * How many of a held site's recent volumes the loop can reach back over.
   *
   * Separate from `loopMinutes`, which is the national mosaic's window. A
   * site publishes a volume every four to six minutes and the two numbers
   * would not agree about anything; this one is counted in volumes because
   * that is what the site's own listing answers in.
   */
  loopVolumes: number;
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
  /**
   * Draw the sweep by reading between its gates rather than by taking the
   * nearest one.
   *
   * The picture only. The number the inspector answers with and the numbers
   * an export writes are the gates themselves either way, and the legend says
   * the picture has been smoothed so nobody reads an interpolated edge as a
   * measured one.
   */
  smoothSweep: boolean;
  /**
   * Draw the national grids by reading between their cells rather than by
   * taking the nearest one.
   *
   * The same bargain as `smoothSweep` and the same limits. A cell of the
   * mosaic is about a kilometre across, so zoomed in it is a square of one
   * colour with a hard edge against the square beside it, and the terraces
   * between colour bands read as the resolution of the instrument when they
   * are the resolution of the ramp.
   *
   * The picture only. The readings an export writes and the number the
   * inspector answers with are the cells themselves either way. It never
   * reads across a cell the network says it had no coverage of, because
   * smoothing towards a low reading is an estimate of the air between two
   * measurements and smoothing towards an absence is an invention.
   */
  smoothGrids: boolean;
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
  /** The WPC excessive rainfall outlook, for the day chosen. */
  wpcExcessiveRain: boolean;
  /** The winter storm severity index, for the day chosen. */
  wpcWinterSeverity: boolean;
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
  buoys: boolean;
  /** Rain and hail measured by volunteers with the same gauge. */
  cocorahs: boolean;
  aviation: boolean;
  tropical: boolean;
  satellite: boolean;
  customOverlay: boolean;
  /** MRMS azimuthal shear accumulated over the window the reader chose. */
  rotationTracks: boolean;
  /** MRMS merged azimuthal shear as it stands, at the height chosen. */
  azShear: boolean;
  /** MRMS maximum estimated hail size. */
  hail: boolean;
  hailSwath: boolean;
  /** How much water each metre of the column is holding. */
  vilDensity: boolean;
  /** The severe hail index, and the probability and ice worked out beside it. */
  shi: boolean;
  posh: boolean;
  vii: boolean;
  echoTops: boolean;
  vil: boolean;
  precipRate: boolean;
  qpeHour: boolean;
  qpeDay: boolean;
  /** Rain against the guidance for flash flooding, over one hour and three. */
  /** County and state lines, which is how warnings are read. */
  counties: boolean;
  /**
   * A wash over the half of the world the sun is not on.
   *
   * Off. It costs nothing and asks nothing of anybody, but it is a change to
   * the colour of the whole map, and a reader who opens this app to look at a
   * storm has not asked for one.
   */
  night: boolean;
  /** Rain measured by radar and corrected against the rain gauges. */
  gaugeQpe: boolean;
  ffgHour: boolean;
  ffgThreeHour: boolean;
  /** What the flash flood model has running off each square kilometre. */
  unitStreamflow: boolean;
  /** MRMS cloud-to-ground flash density over the past five minutes. */
  /** What kind of precipitation the network says is falling. */
  precipType: boolean;
  /** How much snow the national analysis says has landed, over the window chosen. */
  snowfall: boolean;
  lightningDensity: boolean;
  /** The MRMS chance that lightning strikes ground it has not struck yet. */
  lightningForecast: boolean;
  /** Where a cell's flash rate has climbed faster than its own history. */
  lightningJump: boolean;
  /** Reflectivity at the level the air is cold enough for ice. */
  isothermReflectivity: boolean;
  /** One height of the merged grid, rather than the whole column at once. */
  cappi: boolean;
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
  /**
   * The same alert read aloud, in the language the catalogue is in. Off
   * until asked for, for the same reason the tone is.
   */
  voice: boolean;
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
  /**
   * Whether the reader has picked units for themselves.
   *
   * Until they have, choosing a language sets the units that language is
   * read in: somebody who picks Français and then sees Fahrenheit has to go
   * and find the Units row to finish the job. Once they have picked, the
   * choice is theirs and no language change touches it. A settings file
   * written before this existed has no way to say, and is read as chosen,
   * because flipping a reader who is happy is the worse mistake.
   */
  unitsChosen: boolean;
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
  /**
   * How long a snowfall total covers: one day, two or three.
   *
   * A day by default, because that is the one people mean when they ask how
   * much fell. The longer windows are for a storm that ran over two nights,
   * where a 24-hour total splits the same snow in half.
   */
  snowfallWindow: SnowfallWindow;
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
   * Draw each watched place's radius on the map.
   *
   * The rules are judged against that radius and nothing on the map showed
   * it, so a reader who set "within ten miles" could not see which storms
   * were inside the circle. Off until asked for, because a ring around every
   * watched place is a line over the weather for a reader who is not
   * currently thinking about their rules. One preference for the workspace
   * rather than one per place: it is about what the map draws.
   */
  watchRings: boolean;
  /**
   * How far the reader is from the screen the full-screen view is on, in
   * metres.
   *
   * The view is meant to be read across a room and its type was drawn for a
   * desk. One number, because the rest is geometry: an angle held constant is
   * a size proportional to the distance.
   */
  ambientMetres: number;
  /**
   * Which GOES-East view the satellite layer draws.
   *
   * GeoColor by default, which is the picture people expect. The infrared
   * band is the one to switch to after dark, when GeoColor has nothing to say
   * about a storm top.
   */
  /**
   * Which band of the satellite picture the reader wants.
   *
   * Which satellite it comes from is not a setting: it is whichever one is
   * looking down at the middle of the view. A reader chooses what to look at,
   * not which spacecraft to look through.
   */
  satelliteBand: SatelliteBandId;
  /** Which day of the excessive rainfall outlook, 1 through 5. */
  wpcDay: number;
  /** Which day of the convective outlook, 1 through 8. */
  spcDay: number;
  /** Which hazard's probability, or the categorical outlook. */
  spcHazard: SpcHazard;
  /** Which day of the winter storm severity index, 1 through 3. */
  wssiDay: number;
  /**
   * When to say that the radar has a storm heading for a watched place.
   *
   * Its own setting rather than part of the watch, because it is a different
   * kind of statement: the watch repeats a forecaster, and this is arithmetic
   * on a centroid and a motion vector. Off until asked for.
   */
  approach: ApproachSettings;
  /**
   * When to say that lightning is falling near a watched place.
   *
   * The same shape as the approach notice and for the same reason: an
   * instrument counting flashes is not a forecaster judging a hazard, so it
   * is off until asked for and says what it is.
   */
  lightningWatch: LightningRule;
  /** Which window the gauge-corrected accumulation covers. */
  gaugeQpePeriod: GaugeQpePeriod;
  /** Which window the rotation track covers. */
  rotationPeriod: RotationPeriod;
  /** How long a window the cloud-to-ground density is averaged over. */
  lightningWindow: LightningWindow;
  /** How far ahead the chance of lightning is forecast. */
  lightningForecastWindow: LightningForecast;
  /** Whether the jump grid shows this minute or the past five minutes. */
  lightningJumpWindow: LightningJump;
  /** Which temperature the isothermal reflectivity is sampled at. */
  isothermLevel: IsothermLevel;
  /** Which slab the merged shear is measured through. */
  azShearLevel: AzShearLevel;
  /** Which of the three merged fields the height switch is showing. */
  cappiField: CappiField;
  /** Which height of the merged grid all three are read at. */
  cappiLevel: CubeLevel;
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
  /**
   * Whether the weather at your places is written down at all.
   *
   * On, because the record is the thing a year of use turns into. Off stops
   * every row being written from that moment; it does not delete what is
   * already there, which is what the delete button is for.
   */
  /**
   * How loud an alert sounds, nought to one.
   *
   * Asked for rather than assumed. The sound is off until somebody turns it
   * on, and somebody who turns it on has an opinion about how loud it is.
   */
  /**
   * The calmer presentation.
   *
   * A presentation and not a filter: the same warnings arrive at the same
   * moment, drawn in the same colours the office publishes. What goes quiet
   * is the app around them.
   */
  calm: boolean;
  /**
   * How long the workspace waits before going into the full-screen view on
   * its own, in minutes. Zero is never, which is the default: a workspace
   * that takes itself over while somebody is reading is a workspace they
   * stop leaving open.
   */
  ambientIdleMinutes: number;
  /**
   * Whether the full-screen view keeps the screen on while it is showing.
   *
   * Off, because holding somebody's monitor awake is a thing to be asked
   * for. On, it stands only while the view is actually showing.
   */
  displayAwake: boolean;
  /**
   * Whether an exported picture carries the keys for the banded layers on it.
   *
   * Off. A picture somebody shares is usually a picture of one thing, and a
   * column of colour scales down its side is chrome rather than weather. A
   * reader sharing an outlook wants the opposite, which is why it is a
   * choice rather than a rule either way.
   */
  exportKeys: boolean;
  /**
   * Whether there is an icon in the tray at all.
   *
   * On, because it is the one place the app can say something useful while
   * it is not in front of anybody. Off removes it rather than hiding it.
   */
  /**
   * How often the current view goes on the desktop, in minutes. Zero is
   * never, which is the default: this takes something of the reader's away
   * for as long as it is on, so it is asked for rather than assumed.
   */
  wallpaperMinutes: number;
  tray: boolean;
  /**
   * Whether closing the window leaves the app running in the tray.
   *
   * Off. An app that silently keeps running after a close is an app people
   * uninstall, and finding it in the tray afterwards is not a happy
   * surprise. A reader who wants that says so.
   */
  closeToTray: boolean;
  /** Whether the small window stays above everything else. */
  glanceOnTop: boolean;
  /**
   * What the speculative layers were before the calmer presentation put them
   * away, so turning it off gives them back.
   *
   * Empty when the mode is off. A mode that borrows a reader's settings has
   * to return them: leaving one switched off for ever is the mode changing
   * something it was only supposed to quieten.
   */
  calmBorrowed: Partial<Record<string, boolean>>;
  alertVolume: number;
  /**
   * A sound file of the reader's own, by path.
   *
   * The path and not the bytes: a workspace backup carries settings, and one
   * that swallowed the audio would quietly become the only copy of it. A file
   * that has moved away simply falls back to the built-in kit.
   */
  alertSoundPath: string | null;
  journal: boolean;
  catchUp: boolean;
  /**
   * Whether the map holds anything to find.
   *
   * On, because it costs one distance for each of a dozen entries when the
   * camera comes to rest and nothing at all otherwise, and because a reader
   * who never explores anywhere never meets one.
   */
  curiosities: boolean;
  /**
   * The ones already found, by id.
   *
   * A list of what somebody found, and nothing else. There is no total beside
   * it and no progress through it, because a set of real places worth knowing
   * about stops being that the moment it becomes a thing to complete.
   */
  curiositiesFound: string[];
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

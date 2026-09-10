import { isDesktopRuntime } from "./runtime";
import { failureSentence } from "./serviceAnswer";
import { translate, type StringKey } from "../i18n";
import { nativeErrorParams } from "./nativeError";
import { en } from "../i18n/en";
import { haversineMiles } from "./geo";
import { heldHailAir } from "./sounding";
import { formatDistance } from "./units";

/** Below this the national mosaic is the better picture, and cheaper. */
export const SINGLE_SITE_MIN_ZOOM = 8;
/** A volume lands every four to six minutes, so asking more often is waste. */
export const SWEEP_REFRESH_MS = 2 * 60_000;

/**
 * How often to ask while the volume in progress is what is being drawn.
 *
 * The radar publishes a piece every eleven or twelve seconds, so this is close
 * enough that a new one is on screen within half a minute of being made, and
 * far enough apart that most asks have something new to answer with.
 */
export const LIVE_REFRESH_MS = 20_000;

export const LEVEL2_PRODUCTS = [
  { id: "reflectivity", key: "product.reflectivity", unit: "dBZ" },
  { id: "velocity", key: "product.velocity", unit: "m/s" },
  {
    id: "storm-relative-velocity",
    key: "product.stormRelative",
    unit: "m/s",
  },
  { id: "spectrum-width", key: "product.spectrumWidth", unit: "m/s" },
  {
    id: "differential-reflectivity",
    key: "product.differential",
    unit: "dB",
  },
  {
    id: "correlation-coefficient",
    key: "product.correlation",
    unit: "",
  },
  // Worked out from the Doppler cut rather than recorded: the azimuthal
  // derivative of the velocity, and the same divided by what the beam can
  // resolve at that range. In the unit the national grids publish, so the two
  // are the same number rather than two scales.
  {
    id: "azimuthal-shear",
    key: "product.azimuthalShear",
    unit: "0.001/s",
  },
  { id: "rotation", key: "product.rotation", unit: "NROT" },
  // The slope of the differential phase along the beam. It ships as a Level
  // III product and not as a moment, so a site's own version has to be worked
  // out from the phase itself.
  {
    id: "specific-differential-phase",
    key: "product.specificDifferentialPhase",
    unit: "deg/km",
  },
  // The other axis: not one cut but the column over each point of ground,
  // which is where a storm's depth, the water in it and the hail it could be
  // making all live. A composite is reflectivity, so it keeps that unit and
  // that scale.
  {
    id: "composite-reflectivity",
    column: true,
    key: "product.compositeReflectivity",
    unit: "dBZ",
  },
  { id: "echo-top", column: true, key: "product.echoTop", unit: "km" },
  { id: "vil", column: true, key: "product.vil", unit: "kg/m2" },
  {
    id: "vil-density",
    column: true,
    key: "product.vilDensity",
    unit: "g/m3",
  },
  { id: "hail-size", column: true, key: "product.hailSize", unit: "mm" },
  // A terminal radar's alone: reflectivity to 225 nautical miles on 300 m
  // gates. A WSR-88D's capabilities leave it out.
  {
    id: "long-range-reflectivity",
    key: "product.longRange",
    unit: "dBZ",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  key: StringKey;
  unit: string;
  /** True for a product worked out of the whole volume rather than one cut. */
  column?: boolean;
}>;

export type Level2ProductId = (typeof LEVEL2_PRODUCTS)[number]["id"];

/** Which kind of radar drew a sweep, which decides its products and reach. */
export type RadarKind = "WSR-88D" | "TDWR";

/**
 * Whether a product is the whole volume rather than one cut of it.
 *
 * Five of them are, and none of those has a tilt: the reading over a point of
 * ground came from every beam that passed through the column above it. So the
 * picker has nothing to offer, the line under the picture has no angle to name,
 * and the beam height under the cursor is a question about a cut that was never
 * chosen. Saying 0.48 degrees beside an echo top would be inventing one.
 */
export function isColumnProduct(id: string): boolean {
  return LEVEL2_PRODUCTS.some(
    (product) => product.id === id && "column" in product,
  );
}

export function isLevel2Product(value: unknown): value is Level2ProductId {
  return LEVEL2_PRODUCTS.some((product) => product.id === value);
}

/** The two heights a hail size was worked out between. */
export interface HailHeights {
  freezingKm: number;
  minusTwentyKm: number;
  /** What the sounding was called, or the standard atmosphere. */
  source: string;
  /** True when no sounding was loaded and the stated default was used. */
  standard: boolean;
}

/** The motion subtracted from a storm relative sweep. */
export interface StormMotion {
  speedMs: number;
  fromDegrees: number;
  /** True when the viewer gave it rather than the sweep being read for it. */
  manual: boolean;
}

export interface SweepImage {
  station: string;
  siteName: string;
  /** The product this sweep answers, as the panel asked for it. */
  productId: Level2ProductId;
  /** True when a loaded colour table drew this rather than the built-in ramp. */
  paletteApplied: boolean;
  /**
   * True when the high-contrast ramps drew this.
   *
   * The picture on screen was drawn when it was asked for, so the legend
   * follows this rather than the preference as it stands now: a reader who has
   * just turned contrast on is still looking at the sweep they had.
   */
  highContrast: boolean;
  /**
   * True when this picture was drawn by reading between the gates.
   *
   * Follows the picture for the same reason the contrast flag does: a reader
   * who has just switched smoothing on is still looking at the sweep they had,
   * and the legend has to describe that one.
   */
  smoothed: boolean;
  /** True when the velocity drawn here has been unfolded. */
  dealiased: boolean;
  /**
   * The share of this cut's readings unfolding could not place, from zero to
   * one.
   *
   * A patch of echo joined to nothing else in the sweep can be made
   * continuous with itself and no further: which whole interval it belongs in
   * is not in the data. Those gates keep exactly what the radar reported, so a
   * couplet inside one of them may be a fold rather than rotation, and the
   * legend says so.
   */
  unplacedShare: number;
  /** What was taken out to make a storm relative sweep, when one was. */
  stormMotion: StormMotion | null;
  /**
   * The air a hail size was worked out against, on that product alone.
   *
   * Carried on the picture rather than read off the workspace beside it: the
   * sweep on screen may have been drawn before the sounding the reader now has
   * was loaded, and what they are owed is the air the number in front of them
   * came from.
   */
  hailHeights: HailHeights | null;
  product: string;
  unit: string;
  elevationDegrees: number;
  tilts: number[];
  tiltIndex: number;
  /**
   * True when the sector on screen came from the volume being swept now.
   *
   * False for a sweep the archive answered, including one asked for live at a
   * cut the radar has not reached yet: nothing then on screen is live, and the
   * legend must not say otherwise.
   */
  live: boolean;
  /** How many cuts the volume in progress has published. Zero when not live. */
  liveTilts: number;
  /**
   * Why the volume in progress could not be read, when one was asked for.
   *
   * The picture is the last finished volume either way, which is what the
   * archive path has always shown and is never wrong, only behind. This is
   * the difference between a site between volumes and one whose chunks
   * cannot be reached at all, which the age beside the sweep cannot tell
   * apart. Null when a live volume was not asked for or was read.
   */
  liveFailed: string | null;
  /**
   * When the next piece of the volume in progress is due, and when the volume
   * is projected to finish, from the radar's own coverage pattern.
   *
   * Null on anything but a live sweep, and on a live one until a start chunk
   * has been read: the pattern is what says how long each remaining cut takes,
   * and there is nothing honest to say without it.
   */
  nextChunkAt: string | null;
  volumeEndsAt: string | null;
  collected: string;
  /**
   * When the older cut under a live composite was collected.
   *
   * Present only when two sweeps are on screen at once. The legend says this
   * as well as `collected`, because a composite whose age is read off its
   * newer half is a picture claiming to be fresher than it is.
   */
  beneathCollected: string | null;
  west: number;
  south: number;
  east: number;
  north: number;
  /**
   * Where the radar itself stands.
   *
   * Carried rather than taken from the middle of the box above, which it used
   * to be: the picture was always squared on the site. It is not any more,
   * because a reader zoomed in past about zoom ten is given the same pixels
   * over less ground, and the beam height the inspector answers with is
   * measured from the radar rather than from the middle of what was drawn.
   */
  siteLon: number;
  siteLat: number;
  image: string;
  volume: string;
  source: {
    kind: "recent" | "archive" | "local";
    label: string;
    url: string | null;
  };
  /** Which kind of radar drew this. */
  radar: RadarKind;
  /** How far the picture reaches from the site, in kilometres. */
  rangeKm: number;
  /** How long one gate or bin is, in kilometres. The finest thing in it. */
  gateKm: number;
}

/**
 * Decoding a Level II volume is native work, so the browser preview stays on
 * the mosaic rather than pretending it has a site to show.
 */
export function level2Available(): boolean {
  return isDesktopRuntime();
}

export function isSingleSiteViewport(zoom: number): boolean {
  return zoom >= SINGLE_SITE_MIN_ZOOM;
}

/** One radar the view can see, as the picker lists it. */
export interface SiteInReach {
  station: string;
  /**
   * What to call it, joined on the native side by `SiteEntry::label`.
   *
   * One field rather than a city and a state with the comma in the catalogue
   * string, because the three radars the office lists outside the states have
   * no state and read "Kadena AB, " that way.
   */
  label: string;
  distanceKm: number;
}

/**
 * Every radar whose coverage reaches a point, nearest first.
 *
 * The picker offered three things and none of them was a radar near you: it
 * followed the map, held whatever was already on screen, or listed the
 * airports. During an outage there was no way to choose the second-nearest
 * site without knowing its call sign.
 */
export async function sitesInReach(
  lon: number,
  lat: number,
): Promise<SiteInReach[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SiteInReach[]>("level2_sites_in_reach", {
    latitude: lat,
    longitude: lon,
  });
}

export async function nearestSite(
  lon: number,
  lat: number,
): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("level2_nearest_site", {
    latitude: lat,
    longitude: lon,
  });
}

export async function fetchSweep(
  station: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  // Hide anything weaker than this, in the product's own unit.
  threshold: number | null,
  // Draw the volume being swept now over the last one the radar finished.
  live: boolean,
  // Draw with the ramps built for a reader who has asked for more contrast.
  highContrast: boolean,
  // Fade the finished sweep behind the one being made, the way a phosphor
  // screen does. Only ever true alongside `live`, because it is the only
  // picture with two sweeps in it.
  persistence: boolean,
  // Keep the faded composite and drop the bright edge that moves with the
  // beam. Sent from here for the same reason the contrast preference is: the
  // native side has no view of a media query.
  reducedMotion: boolean,
  // Read between the gates rather than taking the nearest one. The picture
  // only: the number the inspector answers with and the numbers an export
  // writes are the gates themselves either way.
  smooth: boolean,
  // The ground to draw over, west, south, east and north, or null for the
  // site's whole reach. `sweepDetailBox` works it out from the zoom.
  within: [number, number, number, number] | null,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_sweep", {
    station,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    live,
    highContrast,
    persistence,
    reducedMotion,
    smooth,
    // Whatever the workspace knows about the air, read here rather than
    // handed down: it is not a choice any caller makes, and only hail size
    // reads it. Absent where no sounding has been loaded, and the native side
    // says on the picture which of the two it used.
    air: heldHailAir(),
    within,
  });
}

/** One gate's reading, and which of a composite's two sweeps it came from. */
export interface GateReading {
  value: number;
  unit: string;
  product: string;
  /** When the sweep this came from was collected. */
  collected: string;
  /** True when it came from the volume the radar is sweeping now. */
  live: boolean;
  azimuthDegrees: number;
  rangeKm: number;
}

/**
 * What the radar read at one point, from the same cut the picture drew.
 *
 * Asked of the native side rather than sampled out of the image, because a
 * colour is a lossy account of a number. Null when the point is out of range,
 * when the gate holds no reading, or in a browser preview with no decoder.
 */
export async function fetchGate(
  station: string,
  lat: number,
  lon: number,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  live: boolean,
): Promise<GateReading | null> {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GateReading | null>("level2_gate", {
    station,
    latitude: lat,
    longitude: lon,
    product,
    tilt,
    dealias,
    motion,
    // The same air the picture was drawn against. Without it the readout under
    // the cursor works a hail size out from the standard atmosphere while the
    // panel beside it names the reader's sounding, and the number the cursor
    // gives is the one somebody writes down.
    air: heldHailAir(),
    live,
  });
}

/**
 * The recent volume times a site has published, oldest first.
 *
 * The times rather than the keys: the archive sweep is asked for by moment,
 * and a moment is what the legend says. Milliseconds, because everything on
 * the timeline is.
 */
export async function recentVolumeTimes(
  station: string,
  count: number,
): Promise<number[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const said = await invoke<string[]>("level2_recent_times", {
    station,
    count,
  });
  return said
    .map((at) => Date.parse(at))
    .filter((at) => Number.isFinite(at))
    .sort((left, right) => left - right);
}

export async function fetchArchiveSweep(
  station: string,
  at: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  threshold: number | null,
  highContrast: boolean,
  // The ground to draw over, so a held frame covers the same place as the
  // live sweep beside it rather than dropping to the whole disc as it plays.
  within: [number, number, number, number] | null,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_archive_sweep", {
    station,
    at,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    highContrast,
    // Whatever the workspace knows about the air, read here rather than
    // handed down: it is not a choice any caller makes, and only hail size
    // reads it. Absent where no sounding has been loaded, and the native side
    // says on the picture which of the two it used.
    air: heldHailAir(),
    within,
  });
}

export async function fetchLocalSweep(
  path: string,
  product: Level2ProductId,
  tilt: number,
  dealias: boolean,
  motion: [number, number] | null,
  threshold: number | null,
  highContrast: boolean,
  // The ground to draw over. Null on a file the reader has just opened, and a
  // box on every ask after that: the first answer is what says where the
  // file's own site reaches, and the box is measured on that rather than on
  // the site the map happens to be over. See `historicalWithin`.
  within: [number, number, number, number] | null,
): Promise<SweepImage> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SweepImage>("level2_local_sweep", {
    path,
    product,
    tilt,
    dealias,
    motion,
    threshold,
    highContrast,
    // Whatever the workspace knows about the air, read here rather than
    // handed down: it is not a choice any caller makes, and only hail size
    // reads it. Absent where no sounding has been loaded, and the native side
    // says on the picture which of the two it used.
    air: heldHailAir(),
    within,
  });
}

/** Opens the operating system's picker without granting general file access. */
export async function pickArchiveFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: translate("radar.openArchiveTitle"),
    directory: false,
    multiple: false,
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * How old the live part of a sweep is, in whole seconds, or null.
 *
 * Measured from when the radar collected the cut rather than from when it was
 * fetched, so a slow download shows as what it is. A sweep the archive
 * answered has no live part and gets nothing.
 */
export function liveAgeSeconds(sweep: SweepImage, now: number): number | null {
  if (!sweep.live) return null;
  const collected = Date.parse(sweep.collected);
  if (Number.isNaN(collected)) return null;
  // A clock a little behind the radar's would otherwise read as the future.
  return Math.max(0, Math.round((now - collected) / 1000));
}

/**
 * Which failures are the feed being down rather than the ask being impossible.
 *
 * Both come back from the same command. A tilt the site's VCP does not have,
 * a file over the size limit, a station that is not a NEXRAD: those are the
 * ask, and the source answered perfectly. Recording one against the Level II
 * source marks it as failing, twice running, in the Diagnostics row a reader
 * copies into a bug report, and writes it into the incident ring.
 */
const SOURCE_DOWN = new Set([
  "httpStatus",
  "httpUnreachable",
  "httpRefused",
  "httpTooLarge",
  "badListing",
  "decode",
]);
// `noVolume` and `noLongerListed` were in this set for one commit, on the
// reasoning that a listing which swallows a failed day turns an outage into a
// site with no volumes. That reasoning was about the wrong function: the one
// that swallows is the loop-times command, which records nothing, and the one
// behind this path propagates its failures, so a real outage already arrives
// as a refused connection. What `noVolume` does mean here is a radar that has
// published nothing for a day, which is a site off air for maintenance and
// the source answering perfectly. `noLongerListed` is a renamed or
// decommissioned terminal radar, and this path never sees one.

/**
 * Whether a failure says the radar feed could not be reached or read.
 *
 * A failure with no code of its own counts: `sweepErrorText` answers for it
 * with "The radar site did not answer", and the health record has to say the
 * same thing the reader was told.
 */
export function sweepSourceFailed(failure: unknown): boolean {
  if (!failure || typeof failure !== "object" || !("code" in failure)) {
    return true;
  }
  return SOURCE_DOWN.has(String((failure as { code?: unknown }).code));
}

/**
 * What the native side said went wrong, in the reader's own language.
 *
 * The command rejects with a code, the parts of the message, and the English
 * sentence it would otherwise have sent. Anything with wording of its own is
 * written here; anything without falls back to that sentence, which is better
 * than a code nobody can read.
 */
export function sweepErrorText(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const named = failure as {
      code?: unknown;
      args?: unknown;
      text?: unknown;
    };
    const args = Array.isArray(named.args) ? named.args : [];
    const params = nativeErrorParams(String(named.code), args);
    const key = `radar.error.${String(named.code)}`;
    // A build that has never heard of this failure has no wording for it, and
    // asking for one that is not there throws rather than answering.
    if (key in en) return translate(key as StringKey, params);
    if (typeof named.text === "string" && named.text) return named.text;
  }
  if (typeof failure === "string") return failure;
  // Something with no shape this build recognises. Saying the volume listing
  // could not be read would be a specific diagnosis of something else.
  return failureSentence(failure, translate("radar.error.unknown"));
}

/** The four corners MapLibre wants, clockwise from the top left. */
export function sweepCorners(
  sweep: SweepImage,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [sweep.west, sweep.north],
    [sweep.east, sweep.north],
    [sweep.east, sweep.south],
    [sweep.west, sweep.south],
  ];
}

/**
 * The zoom below which the whole disc is what gets drawn.
 *
 * The sweep is one raster over a 460 kilometre box, so at 1,024 pixels it is
 * 449 metres a pixel against gates a quarter of a kilometre long. A screen
 * pixel is coarser than that only below about zoom 7: MapLibre's world is
 * 512 times two to the zoom, which makes a screen pixel 14 metres at zoom 12
 * and forty degrees north, not the 29 the 256 pixel tile convention gives.
 *
 * Ten, and it cannot be eight, because narrowing the box trades resolution
 * against coverage and only the first of those is obvious. Outside the box
 * there is nothing: `MapViewport` drives the mosaic to zero opacity the
 * moment a single-site sweep is set, so ground the box does not reach is
 * bare basemap. The centre also snaps to a grid of half the box's width, so
 * what a reader is guaranteed either side of where they are looking is a
 * quarter of the box, `wide / (4 * steps)`, not a half.
 *
 * A window of W pixels spans `W * 180 / (512 * 2^z)` degrees either side of
 * its centre, so coverage holds while `W <= wide * 2^z / (1.40625 * steps)`.
 * With the progression below that is about 2,016 pixels at KDMX, flat from
 * zoom 10 to 13 and doubling past the ceiling. It was moved to eight on
 * 2026-09-08 so the raster would match the screen pixel for pixel, which it
 * did: a 1,024 pixel raster at one raster pixel per screen pixel covers
 * 1,024 pixels of map, and after the snap about 504. Every window is wider
 * than that, so the reader got a rectangle of radar in bare basemap from the
 * level the single-site view opens at.
 *
 * This is now a floor rather than the whole rule. It is the level below which
 * no disc is worth narrowing at any window, and `sweepDetailBox` then asks
 * whether this particular disc can cover this particular window before it
 * takes the step. Reaching zooms 8 and 9 at all needs a bigger raster or more
 * than one of them, which is `AUD-453`.
 */
export const DISC_IS_ENOUGH_BELOW_ZOOM = 10;

/**
 * How many pixels across the box the native side draws, which is `IMAGE_SIZE`
 * in `src-tauri/src/level2/mod.rs`. Held against it by a test.
 */
export const SWEEP_RASTER_PX = 1024;

/**
 * How many pixels a gate has to be worth before there is nothing left in it.
 *
 * The ceiling used to be a share of the disc, a sixteenth, and its reasoning
 * was written against one radar: a sixteenth of a 460 kilometre disc is 28
 * metres a pixel against a 250 metre gate, so nine pixels a gate, and there
 * is plainly nothing left to resolve past that. But a share knows nothing
 * about what is underneath it. A terminal radar's base products cover 177.6
 * kilometres in the same 1,024 pixels, so a sixteenth of that disc is 11
 * metres a pixel against a 150 metre bin, and the last halvings were buying a
 * fetch, a decode and a 1,024 square render each to interpolate between bins
 * that were already resolved. The same share was too shallow at the other
 * end: the long range product reaches 417 kilometres in 300 metre bins and
 * still had detail in it at the sixteenth.
 *
 * So the ceiling is a resolution now, and this is the only number in it that
 * is a choice rather than a measurement. Three real radars bound it, and six
 * is the only whole number all three leave standing:
 *
 * - Below 4.46 a WSR-88D loses its last halving, and the whole point was that
 *   it is no worse off than it was.
 * - Below 5.90 the long range product loses the depth it has bins for.
 * - Above 6.92 a terminal base product keeps a halving it has no bins for,
 *   which is the reason the rule changed at all.
 *
 * The three bounds are asserted as the three answers in `level2.test.ts`
 * rather than described there, so moving this in either direction reddens
 * rather than quietly costing a reader depth or costing them a fetch.
 */
export const PIXELS_ACROSS_A_GATE = 6;

/**
 * How far the box may be narrowed for a sweep that carries these numbers.
 *
 * A power of two, because the snap grids of neighbouring zooms have to nest
 * for a held frame to stay reachable. One means the whole disc is as far as
 * it goes.
 */
export function finestDetailSteps(rangeKm: number, gateKm: number): number {
  // A sweep that does not say how long its gates are gets the old fixed
  // ceiling. Answering "as deep as you like" to a missing number would spend
  // fetches on nothing, and answering "the whole disc" would take a reader's
  // picture away over a field that failed to arrive.
  const real = (value: number) => Number.isFinite(value) && value > 0;
  if (!real(rangeKm) || !real(gateKm)) return 16;
  const wanted =
    (PIXELS_ACROSS_A_GATE * 2 * rangeKm) / (SWEEP_RASTER_PX * gateKm);
  // Bounded at both ends. The gate length arrives as an unchecked number of
  // metres out of a file header, and a header saying one metre would ask for
  // four thousand steps, each of them a volume decoded and a 1,024 square
  // drawn to cover a hundred metres of ground. The deepest any real product
  // justifies is thirty-two, so this is one step past the furthest honest
  // answer and a hard stop on a dishonest one.
  return Math.min(64, Math.max(1, 2 ** Math.ceil(Math.log2(wanted))));
}

/**
 * The box to draw the sweep over for a reader at this zoom, or null for the
 * whole disc.
 *
 * The sweep is one image over the site's whole reach, so the only way to give
 * a reader zoomed in on a couplet more than 449 metres a pixel is to draw the
 * same 1,024 pixels over less ground. What comes back carries its own corners,
 * so the map places it without knowing any of this.
 *
 * Quantised on purpose, in both the zoom and the centre. A box taken straight
 * from the viewport would be a new box on every pan, every wheel notch and
 * every eased fly-to, and a re-render with each. The zoom is taken to whole
 * levels and the centre snaps to a grid of half the box's own width, so most
 * small movements land on the box already in hand and ask for nothing.
 *
 * Most, not all. Snapping to a grid means the box moves whenever a pan
 * crosses a grid line, however short the pan is, so nothing here promises a
 * free drag of any particular size. What it promises is that two cameras
 * close together usually share a box, which is what keeps the held frames of
 * a loop worth holding.
 */
export function sweepDetailBox(
  disc: {
    west: number;
    south: number;
    east: number;
    north: number;
    /** The two the sweep carries, which say where the detail runs out. */
    rangeKm: number;
    gateKm: number;
  },
  center: [number, number],
  zoom: number,
  windowSpanPx: number,
): [west: number, south: number, east: number, north: number] | null {
  if (!Number.isFinite(zoom) || zoom < DISC_IS_ENOUGH_BELOW_ZOOM) return null;
  const wide = disc.east - disc.west;
  const tall = disc.north - disc.south;
  if (!(wide > 0) || !(tall > 0)) return null;

  // Whole levels. The map's zoom is continuous, and it arrives here through
  // an eased fly-to and a wheel that moves it in fractions, so an unrounded
  // one made a different box for every hundredth of a level: a held loop
  // frame was orphaned by any zoom change at all, and each miss is another
  // ten megabyte volume off the archive.
  // Doubling from two at the threshold. That is a quarter of the resolution
  // the screen could show, deliberately: the same pixels have to cover the
  // window as well as resolve it, and the box the reader is guaranteed is a
  // quarter of what is asked for. The ceiling holds where a pixel has run out
  // of gate to resolve, which is this sweep's own number rather than a share
  // of the disc: see `finestDetailSteps`.
  let steps = Math.min(
    finestDetailSteps(disc.rangeKm, disc.gateKm),
    2 ** (Math.floor(zoom) - DISC_IS_ENOUGH_BELOW_ZOOM + 1),
  );
  // And then only as far as this disc and this window allow.
  //
  // The threshold above was one number for every radar, and coverage is not.
  // Substituting the progression into the bound cancels the zoom, so whether
  // a box covers the window depends on the disc's width in degrees alone, and
  // that goes as one over the cosine of the latitude: a 460 kilometre disc is
  // 5.54 degrees at Des Moines and 4.59 at Miami. Measured against the 159
  // site table on 2026-09-08, a single threshold of ten left 85 of them
  // drawing bare basemap at a 1,920 pixel window and 152 at 2,560. A terminal
  // radar reaches 89 kilometres rather than 230 and was uncovered at every
  // common window size.
  //
  // So the progression is what a reader could use and this is what they can
  // have. Halving keeps it a power of two, which keeps the snap grids of
  // neighbouring zooms nested and a held frame reachable; falling to one step
  // means the whole disc, which is what `null` says.
  //
  // The longer side of the window, not its width, and the two axes reduce to
  // one test rather than needing their own. A disc is `tall / cos(latitude)`
  // wide and a degree of latitude is `cos(latitude)` of a degree of longitude
  // on screen, so the cosine cancels and the latitude condition is the
  // longitude one with the height put in. Checking width alone left a
  // portrait window bare above and below: measured at a Key West disc, zoom
  // 10 and 1080 by 1920, the box cleared the width exactly and left 265
  // pixels of the height uncovered.
  //
  // A window that cannot be measured is treated as one too big to narrow for,
  // because the wrong answer in that direction is a whole disc rather than a
  // hole in the picture.
  const half = Number.isFinite(windowSpanPx)
    ? (Math.max(0, windowSpanPx) / 2) * (360 / (512 * 2 ** Math.floor(zoom)))
    : Infinity;
  while (steps > 1 && wide / (4 * steps) < half) steps /= 2;
  if (steps <= 1) return null;
  // Half the box, which is both what the corners are measured from and the
  // grid the centre snaps to.
  const halfWide = wide / (2 * steps);
  const halfTall = tall / (2 * steps);
  // The grid the centre snaps to, which is what a pan has to cross before
  // anything is asked for again.
  const snap = (value: number, step: number, from: number) =>
    from + Math.round((value - from) / step) * step;
  const lon = snap(center[0], halfWide, disc.west);
  const lat = snap(center[1], halfTall, disc.south);

  const west = Math.max(disc.west, lon - halfWide);
  const east = Math.min(disc.east, lon + halfWide);
  const south = Math.max(disc.south, lat - halfTall);
  const north = Math.min(disc.north, lat + halfTall);
  // A box wholly off the disc is no ground at all. There was a second guard
  // here against a box that came out as most of the disc again; `steps` is
  // never below two, so a box is at most a quarter of the disc before it is
  // clipped and smaller after, and the guard could not fire.
  if (east - west <= 0 || north - south <= 0) return null;
  return [west, south, east, north];
}

export function sweepAgeMinutes(sweep: SweepImage, nowMs: number): number {
  const collected = Date.parse(sweep.collected);
  if (!Number.isFinite(collected)) return 0;
  return Math.max(0, Math.floor((nowMs - collected) / 60_000));
}

/**
 * A held station's own line: what it is called, how far it is, and whether it
 * is still sending.
 *
 * A reader who has pinned a station has made it theirs, and the two things
 * they cannot read off the picture are how far away it is and whether the
 * picture is still arriving. A WSR-88D runs a volume every four to six
 * minutes in precipitation mode and about ten in clear air, so twenty minutes
 * of silence is the site being down rather than a slow scan.
 *
 * The site's own position comes off the sweep, which carries it. It used to
 * be the middle of the extent, which was the radar for as long as the picture
 * always covered the whole disc and stopped being the radar the moment a
 * zoomed-in reader started getting a box: it became the snapped map centre,
 * and this line reported the distance from home to that, labelled as the
 * station's. Measured at 152 miles for a reader looking at the north-west of
 * KDMX's disc while standing on the radar itself.
 */
export const STATION_QUIET_AFTER_MINUTES = 20;

export function stationSummary(
  sweep: SweepImage,
  watch: { center: [number, number]; name?: string },
  nowMs: number,
): string {
  const site = sweepSite(sweep);
  const minutes = sweepAgeMinutes(sweep, nowMs);
  const publishing =
    sweep.source.kind === "recent" && minutes < STATION_QUIET_AFTER_MINUTES;
  return translate(publishing ? "radar.stationHeld" : "radar.stationQuiet", {
    station: sweep.station,
    distance: formatDistance(
      haversineMiles({ lon: watch.center[0], lat: watch.center[1] }, site),
    ),
    home: watch.name?.trim() || translate("watch.home"),
    // The number, not the phrase. "Nothing new for 25 min old" is what
    // reusing the age label produced.
    count: minutes,
  });
}

/** Earth's radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;
/**
 * The four-thirds earth model. A radar beam bends slightly downward in normal
 * air, and pretending the earth is a third larger than it is accounts for that
 * without modelling refraction.
 */
const REFRACTION = 4 / 3;
const FEET_PER_KM = 3280.84;

/**
 * How high above the radar the centre of the beam is, in feet, at a given
 * distance and tilt.
 *
 * This is the difference between a couplet at two thousand feet and one at
 * twenty: the same picture at the same tilt means something else entirely
 * eighty miles further out, because the beam has climbed.
 */
export function beamHeightFeet(
  rangeKm: number,
  elevationDegrees: number,
): number {
  if (!Number.isFinite(rangeKm) || rangeKm < 0) return 0;
  const effective = EARTH_RADIUS_KM * REFRACTION;
  const angle = (elevationDegrees * Math.PI) / 180;
  const height =
    Math.sqrt(
      rangeKm * rangeKm +
        effective * effective +
        2 * rangeKm * effective * Math.sin(angle),
    ) - effective;
  return height * FEET_PER_KM;
}

/** Where the site is, as the sweep carries it. */
export function sweepSite(sweep: SweepImage): { lon: number; lat: number } {
  return { lon: sweep.siteLon, lat: sweep.siteLat };
}

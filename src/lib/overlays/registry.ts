import type { StringKey } from "../../i18n";
import type { LayerSpecification } from "maplibre-gl";
import { translate } from "../../i18n";
import { formatAge } from "../units";
import { cachedUrl } from "../tileCache";
import { serviceAnswer } from "../serviceAnswer";

export type OverlayId =
  | "alerts"
  | "earthquakes"
  | "wildfires"
  | "smoke"
  | "metar"
  | "tropical"
  | "spcOutlooks"
  | "spcDiscussions"
  | "stormReports"
  | "riverGauges"
  | "wpcExcessiveRain"
  | "wpcWinterSeverity";

/**
 * What the reader has chosen, for the layers that draw one of several things.
 *
 * Handed to the adapter rather than read from a module-level value, so there
 * is one place the choice lives and the hook that decides when to ask again
 * is reading the same thing the fetch is.
 */
export interface OverlayChoices {
  /** Which day of the excessive rainfall outlook, 1 through 5. */
  wpcDay: number;
  /** Which day of the winter storm severity index, 1 through 3. */
  wssiDay: number;
  /** Which day of the convective outlook, 1 through 8. */
  spcDay: number;
  /**
   * Which hazard's probability, or the categorical outlook.
   *
   * Days 4 to 8 publish one probabilistic outlook and no categorical, so the
   * hazard says nothing there and the layer chooser ignores it rather than
   * refusing a combination a reader can reach by changing the day.
   */
  spcHazard: SpcHazard;
  /**
   * The window a replay is showing, or null while the workspace is live.
   *
   * A layer that draws today's answer over a replay of some other day is
   * making a false claim, and two of them can answer for the replayed day
   * instead. Carried as the window rather than the frame on screen so each
   * is asked once per replay: an outlook is issued a few times a day and the
   * reports of an afternoon are one list, and neither changes as the loop
   * steps through it.
   */
  replay: { from: number; to: number } | null;
}

export type SpcHazard = "categorical" | "tornado" | "hail" | "wind";

/**
 * What a caller that has no reader to ask passes.
 *
 * The watch, the ambient readout and the welcome hint all fetch the alerts
 * layer directly, and alerts draw one thing whatever anybody chose. Named so
 * those call sites say that rather than inventing a day.
 */
export const DEFAULT_OVERLAY_CHOICES: OverlayChoices = {
  wpcDay: 1,
  wssiDay: 1,
  // What a person means by "the outlook", and what the layer drew before it
  // could draw anything else.
  spcDay: 1,
  spcHazard: "categorical",
  replay: null,
};

export interface OverlayBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface OverlayFeature {
  type: "Feature";
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface OverlayData {
  type: "FeatureCollection";
  features: OverlayFeature[];
  /**
   * What a layer drew without, when it drew something.
   *
   * Not an error: the layer is on the map and the features in it are real.
   * It is for the case where part of the answer did not arrive and the part
   * that did looks complete, which is worse than drawing nothing at all. The
   * outlook is the one that has it: the bands and the hatched significant
   * area are two queries, and losing the hatching leaves a fifteen per cent
   * tornado band that reads as "not significant" when what happened is that
   * nobody answered.
   */
  partial?: string;
}

export interface OverlayDescription {
  title: string;
  lines: string[];
  url?: string;
  /**
   * One thing the reader can do about what they are looking at.
   *
   * A layer that can point at another layer says so here rather than the
   * popup knowing anything about hazards. The action changes switches and
   * nothing else: it does not restyle the feature it came from, and the
   * popup renders it as a button beside the source link.
   */
  action?: { id: string; label: string };
}

export interface OverlayAdapter {
  id: OverlayId;
  label: string;
  /**
   * The catalogue key for this layer name, said rather than derived.
   *
   * `layer.${id}` is right for eleven of the twelve and wrong for the one
   * that matters most: the alerts adapter is `alerts` and its line is
   * `layer.weatherAlerts`, so a message built from the id named nothing at
   * all where it most needed to name something.
   */
  nameKey: StringKey;
  attribution: string;
  attributionUrl: string;
  host: string;
  /** How long a snapshot stays fresh before the map asks for another one. */
  refreshMs: number;
  /** A worldwide feed that ignores the viewport it is handed. */
  global?: boolean;
  /**
   * How much wider than the screen to ask for, as a fraction of its span.
   *
   * Half a viewport by default, so a short pan needs no new request. A feed
   * that answers per station rather than per area wants none of it: the
   * Aviation Weather Center thins its answer as the box grows, so asking for
   * two and a half times the screen came back with a third of the stations
   * actually on it.
   */
  boundsPadding?: number;
  /**
   * Below this the layer is not asked for and not drawn.
   *
   * Some feeds answer per station rather than per area, and a country's worth
   * of them at once is both unreadable and a request nobody wanted.
   */
  minZoom?: number;
  /**
   * Icons this layer's symbols name, registered with the map before its
   * layers are added. The map answers a missing icon with a transparent
   * pixel, so a symbol layer naming one that was never registered draws
   * nothing and says nothing.
   */
  images?: () => Array<{
    id: string;
    width: number;
    height: number;
    data: Uint8Array;
  }>;
  /**
   * A stable name for what the reader has chosen, when this layer draws one
   * of several things.
   *
   * Compared against the snapshot on the map: a different answer means the
   * snapshot is of something else and has to be asked for again, however
   * fresh it is and however well it covers the screen.
   */
  variant?: (choices: OverlayChoices) => string;
  fetchData: (
    bounds: OverlayBounds,
    signal: AbortSignal | undefined,
    choices: OverlayChoices,
  ) => Promise<OverlayData>;
  layers: (sourceId: string) => LayerSpecification[];
  describe: (properties: Record<string, unknown>) => OverlayDescription;
  /**
   * The bands on screen and what each one is, for the key over the map.
   *
   * Read off the snapshot rather than declared, because most of these layers
   * are painted in colours the service sends with the features themselves: a
   * table written here would be this app's idea of the outlook's colours
   * rather than the outlook's. Null for a layer whose colours mean nothing on
   * their own, which is most of them: a pin is a pin.
   */
  legend?: (data: OverlayData, choices: OverlayChoices) => OverlayLegend | null;
}

/** One row of a key: a colour and what the service calls it. */
export interface OverlayBand {
  label: string;
  color: string;
}

/**
 * What one layer's key says.
 *
 * The band names are the service's own words and are not translated. The app
 * shows them untranslated in the popup already, and a key that renamed the
 * Storm Prediction Center's categories would be this app inventing
 * terminology for somebody else's forecast. What is in the reader's language
 * is everything this app wrote: the layer's name and the times under it.
 */
export interface OverlayLegend {
  /** The layer this key is for. A string, because the surge picture is not
   * an overlay adapter and still has bands a reader has to interpret. */
  id: string;
  title: string;
  bands: OverlayBand[];
  /** When a forecast was issued and the window it covers, already worded. */
  note: string | null;
}

/**
 * The distinct bands in a snapshot, strongest last.
 *
 * Shared because every layer that has bands at all draws them the same way:
 * a fill on each feature and a name beside it, with the same band repeated
 * across as many polygons as the shape needed.
 */
export function bandsIn(
  data: OverlayData,
  read: (properties: Record<string, unknown>) => {
    label: string;
    color: string;
    rank: number;
  } | null,
): OverlayBand[] {
  const found = new Map<string, { band: OverlayBand; rank: number }>();
  for (const feature of data.features) {
    const seen = read(feature.properties ?? {});
    if (!seen || !seen.label || !seen.color) continue;
    const key = `${seen.label}|${seen.color}`;
    const held = found.get(key);
    if (!held || seen.rank > held.rank) {
      found.set(key, {
        band: { label: seen.label, color: seen.color },
        rank: seen.rank,
      });
    }
  }
  return [...found.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.band);
}

export const EMPTY_OVERLAY: OverlayData = {
  type: "FeatureCollection",
  features: [],
};

export function padBounds(
  bounds: OverlayBounds,
  factor: number,
): OverlayBounds {
  const width = (bounds.east - bounds.west) * factor;
  const height = (bounds.north - bounds.south) * factor;
  return {
    west: Math.max(-180, bounds.west - width),
    south: Math.max(-85, bounds.south - height),
    east: Math.min(180, bounds.east + width),
    north: Math.min(85, bounds.north + height),
  };
}

export function boundsContain(
  outer: OverlayBounds,
  inner: OverlayBounds,
): boolean {
  return (
    outer.west <= inner.west &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.north >= inner.north
  );
}

export function boundsQuery(bounds: OverlayBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(4))
    .join(",");
}

/**
 * One read of an ArcGIS feature service.
 *
 * Four copies of this before: two byte-identical but for the catalogue key
 * they throw with, and two more written inline with their own record counts.
 * Nothing had diverged yet, which is the only reason it reads as tidying;
 * the first time one of these services changes the shape of its answer, four
 * places have to notice.
 *
 * The parts that genuinely differ are arguments. `precision` is how many
 * decimal places of geometry to ask for, and `offset` asks the server to
 * generalise, which full-resolution fire perimeters need because they run to
 * megabytes.
 */
export async function arcgisQuery(options: {
  url: string;
  bounds: OverlayBounds;
  fields: string;
  /** The catalogue line to throw with when the service refuses. */
  statusKey: StringKey;
  limit: number;
  precision?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const search = new URLSearchParams({
    where: "1=1",
    outFields: options.fields,
    returnGeometry: "true",
    geometryPrecision: String(options.precision ?? 4),
    outSR: "4326",
    inSR: "4326",
    geometry: boundsQuery(options.bounds),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: String(options.limit),
    f: "geojson",
  });
  if (options.offset !== undefined) {
    search.set("maxAllowableOffset", String(options.offset));
  }
  const response = await fetch(
    cachedUrl(`${options.url}?${search.toString()}`),
    { signal: options.signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(
      translate(options.statusKey, { answer: serviceAnswer(response.status) }),
    );
  }
  return response.json();
}

function walkCoordinates(
  value: unknown,
  visit: (lon: number, lat: number) => void,
) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }
  for (const part of value) walkCoordinates(part, visit);
}

export function featureBounds(
  geometry: Record<string, unknown>,
): OverlayBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  walkCoordinates(geometry.coordinates, (lon, lat) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });

  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return { west, south, east, north };
}

export function boundsOverlap(
  left: OverlayBounds,
  right: OverlayBounds,
): boolean {
  return (
    left.west <= right.east &&
    left.east >= right.west &&
    left.south <= right.north &&
    left.north >= right.south
  );
}

export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return translate("time.justNow");
  return translate("time.ago", { age: formatAge(minutes) });
}

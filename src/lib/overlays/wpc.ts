import { translate } from "../../i18n";
import { serviceAnswer } from "../serviceAnswer";
import { cachedUrl } from "../tileCache";
import type { LayerSpecification } from "maplibre-gl";
import {
  boundsQuery,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

/**
 * The Weather Prediction Center's two hazard outlooks.
 *
 * The excessive rainfall outlook is what a forecaster points at before a flood
 * day, and the winter storm severity index is its winter counterpart: not how
 * much snow, but what that much snow does to a place. Both are outlooks rather
 * than observations, both say so in their own popup, and both are published on
 * a host this app already reaches.
 *
 * Neither carries a rank the way the SPC outlook does, so the order they draw
 * in comes from their own category names, worst last.
 */
const SERVICE = "https://mapservices.weather.noaa.gov/vector/rest/services";
const ERO_SERVICE = `${SERVICE}/hazards/wpc_precip_hazards/MapServer`;
const WSSI_SERVICE = `${SERVICE}/outlooks/wpc_wssi/MapServer`;
const ATTRIBUTION =
  '<a href="https://www.wpc.ncep.noaa.gov/">NOAA Weather Prediction Center</a>';
const ATTRIBUTION_URL = "https://www.wpc.ncep.noaa.gov/";
const HOST = "mapservices.weather.noaa.gov";

/** The excessive rainfall outlook reaches five days out. */
export const ERO_DAYS = [1, 2, 3, 4, 5] as const;
/** The severity index reaches three. */
export const WSSI_DAYS = [1, 2, 3] as const;

/**
 * The colours each service publishes for itself, keyed by the value its own
 * renderer keys on.
 *
 * Read out of the two `MapServer` layer descriptions rather than invented, the
 * way the SPC outlook's colours come from the service. They are here rather
 * than in the feature because these two services return the geometry and the
 * category and leave the symbology in the layer description, so a per-feature
 * `fill` would mean a second request per draw.
 */
const ERO_RISKS: Array<{ rank: number; match: string; fill: string }> = [
  { rank: 1, match: "marginal", fill: "#38a800" },
  { rank: 2, match: "slight", fill: "#fffe00" },
  { rank: 3, match: "moderate", fill: "#f50000" },
  { rank: 4, match: "high", fill: "#ff69c5" },
];

const ERO_STROKES: Record<number, string> = {
  1: "#00734c",
  2: "#e69800",
  3: "#8a0000",
  4: "#ff00ff",
};

const WSSI_IMPACTS: Array<{ rank: number; match: string; fill: string }> = [
  { rank: 0, match: "winter weather area", fill: "#d2dfe7" },
  { rank: 1, match: "minor", fill: "#faf5a3" },
  { rank: 2, match: "moderate", fill: "#f7962f" },
  { rank: 3, match: "major", fill: "#e61f26" },
  { rank: 4, match: "extreme", fill: "#7853a1" },
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Which band a category name is, and what colour it is drawn in.
 *
 * Matched on a word inside the name rather than on the whole string, because
 * the excessive rainfall outlook writes its own probability into it: the
 * category is "Marginal (At Least 5%)", not "Marginal". A name that matches
 * nothing is left out rather than painted a guess.
 */
export function band(
  name: string,
  table: Array<{ rank: number; match: string; fill: string }>,
): { rank: number; fill: string } | null {
  const lower = name.toLowerCase();
  const found = table.find((entry) => lower.includes(entry.match));
  return found ? { rank: found.rank, fill: found.fill } : null;
}

async function query(
  url: string,
  bounds: OverlayBounds,
  fields: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const search = new URLSearchParams({
    where: "1=1",
    outFields: fields,
    returnGeometry: "true",
    geometryPrecision: "4",
    outSR: "4326",
    inSR: "4326",
    geometry: boundsQuery(bounds),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "60",
    f: "geojson",
  });
  const response = await fetch(cachedUrl(`${url}?${search.toString()}`), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      translate("wpc.serviceStatus", {
        answer: serviceAnswer(response.status),
      }),
    );
  }
  return response.json();
}

/**
 * The service stamps its times as `YYYY-MM-DD HH:MM:SS`, in UTC, with no zone
 * marker. Read apart rather than parsed, because a browser reads a string in
 * that shape as local time and would move every issue time by the reader's own
 * offset.
 */
export function wpcTime(value: unknown): number | null {
  const digits = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):?(\d{2})/.exec(digits);
  if (!match) return null;
  const at = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return Number.isFinite(at) ? at : null;
}

function parse(
  payload: unknown,
  category: string,
  table: Array<{ rank: number; match: string; fill: string }>,
  stroke: (rank: number) => string,
): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    const feature = item as {
      geometry?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    };
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!geometry || !properties) continue;

    const name = text(properties[category]);
    const found = band(name, table);
    if (!found) continue;

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        rank: found.rank,
        risk: name,
        fill: found.fill,
        stroke: stroke(found.rank),
        // The window this frame is for, in the service's own words: it writes
        // "16Z 09/03/26 - 12Z 09/04/26", which says more plainly than two
        // reformatted timestamps that the window crosses a midnight.
        window: text(properties.valid_time),
        issue: wpcTime(properties.issue_time),
      },
    });
  }

  // Worst last, which is on top. The two services return their bands cut out
  // of each other today, so nothing overlaps and the order is invisible; it
  // costs one comparison to still be right if that changes.
  parsed.sort(
    (left, right) =>
      Number(left.properties.rank) - Number(right.properties.rank),
  );
  return { type: "FeatureCollection", features: parsed };
}

/** The layer id for a day, which is what the reader's choice selects. */
export function eroLayer(day: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(day)));
  // Day 1 is layer 0, so the layer is one behind the day.
  return `${ERO_SERVICE}/${clamped - 1}/query`;
}

export function wssiLayer(day: number): string {
  const clamped = Math.min(3, Math.max(1, Math.round(day)));
  // Layer 0 is the group of every day at once; the days start at 1.
  return `${WSSI_SERVICE}/${clamped}/query`;
}

function fillAndLine(sourceId: string): LayerSpecification[] {
  return [
    {
      id: `${sourceId}-fill`,
      type: "fill" as const,
      source: sourceId,
      paint: {
        "fill-color": ["get", "fill"],
        // Light enough that the radar under it still reads through.
        "fill-opacity": 0.3,
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line" as const,
      source: sourceId,
      paint: {
        "line-color": ["get", "stroke"],
        "line-width": 1.6,
      },
    },
  ];
}

export const wpcExcessiveRainOverlay: OverlayAdapter = {
  id: "wpcExcessiveRain",
  nameKey: "layer.wpcExcessiveRain",
  label: "WPC excessive rainfall outlook",
  attribution: ATTRIBUTION,
  attributionUrl: ATTRIBUTION_URL,
  host: HOST,
  // Day 1 is reissued at 0100, 0900, 1600 and 2000 UTC.
  refreshMs: 15 * 60_000,
  variant: (choices) => `ero${choices.wpcDay}`,
  fetchData: async (bounds, signal, choices) =>
    parse(
      await query(
        eroLayer(choices.wpcDay),
        bounds,
        "outlook,valid_time,issue_time",
        signal,
      ),
      "outlook",
      ERO_RISKS,
      (rank) => ERO_STROKES[rank] ?? "#475569",
    ),
  layers: fillAndLine,
  describe: (properties) => {
    const issue = Number(properties.issue);
    const window = String(properties.window ?? "");
    const lines = [translate("wpc.eroTitle")];
    if (window) lines.push(translate("wpc.validWindow", { window }));
    if (Number.isFinite(issue)) {
      lines.push(translate("wpc.issued", { when: relativeTime(issue) }));
    }
    lines.push(translate("wpc.outlookNote"));
    return {
      title: String(properties.risk ?? ""),
      lines,
      url: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_interp.shtml",
    };
  },
};

export const wpcWinterSeverityOverlay: OverlayAdapter = {
  id: "wpcWinterSeverity",
  nameKey: "layer.wpcWinterSeverity",
  label: "WPC winter storm severity index",
  attribution: ATTRIBUTION,
  attributionUrl: ATTRIBUTION_URL,
  host: HOST,
  // Reissued roughly hourly through a winter storm.
  refreshMs: 20 * 60_000,
  variant: (choices) => `wssi${choices.wssiDay}`,
  fetchData: async (bounds, signal, choices) =>
    parse(
      await query(
        wssiLayer(choices.wssiDay),
        bounds,
        "impact,valid_time,issue_time",
        signal,
      ),
      "impact",
      WSSI_IMPACTS,
      // One outline for all of them: the index's own bands are told apart by
      // fill, and four outline colours over a winter map is noise.
      () => "#64748b",
    ),
  layers: fillAndLine,
  describe: (properties) => {
    const issue = Number(properties.issue);
    const window = String(properties.window ?? "");
    const lines = [translate("wpc.wssiTitle")];
    if (window) lines.push(translate("wpc.validWindow", { window }));
    if (Number.isFinite(issue)) {
      lines.push(translate("wpc.issued", { when: relativeTime(issue) }));
    }
    // What the index actually measures, which is the thing readers get wrong
    // about it: it is about impact rather than about how much falls.
    lines.push(translate("wpc.wssiNote"));
    lines.push(translate("wpc.outlookNote"));
    return {
      title: String(properties.risk ?? ""),
      lines,
      url: "https://www.wpc.ncep.noaa.gov/wwd/wssi/wssi.php",
    };
  },
};

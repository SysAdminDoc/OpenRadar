import { translate } from "../../i18n";
import { serviceAnswer } from "../serviceAnswer";
import { cachedUrl } from "../tileCache";
import {
  boundsQuery,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const SERVICE = "https://mapservices.weather.noaa.gov/vector/rest/services";
/** Day 1 categorical is the one a person means by "the outlook". */
const OUTLOOK_LAYER = `${SERVICE}/outlooks/SPC_wx_outlks/MapServer/1/query`;
const DISCUSSION_LAYER = `${SERVICE}/outlooks/spc_mesoscale_discussion/MapServer/0/query`;
const ATTRIBUTION =
  '<a href="https://www.spc.noaa.gov/">NOAA Storm Prediction Center</a>';
const ATTRIBUTION_URL = "https://www.spc.noaa.gov/";
const HOST = "mapservices.weather.noaa.gov";

/**
 * The service stamps its times as `YYYYMMDDHHMM` in UTC, with no separators
 * and no zone marker, so they have to be read apart rather than parsed.
 */
export function outlookTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const digits = value.trim();
  if (!/^\d{12}$/.test(digits)) return null;
  const at = Date.UTC(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8)),
    Number(digits.slice(8, 10)),
    Number(digits.slice(10, 12)),
  );
  return Number.isFinite(at) ? at : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A UTC day and time, so a window crossing midnight reads as one. */
function stamp(at: number): string {
  return new Date(at).toISOString().slice(5, 16).replace("T", " ");
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
      translate("spc.serviceStatus", {
        answer: serviceAnswer(response.status),
      }),
    );
  }
  return response.json();
}

/**
 * Risk areas, weakest first.
 *
 * The service returns them cut out of each other, so no two overlap and the
 * order makes no visible difference today. It is sorted anyway because a
 * GeoJSON source draws in array order and the cost of being right about that
 * is one comparison: if the areas ever arrive nested, or a probabilistic layer
 * is added where they genuinely do overlap, the strongest still ends up on top.
 */
export function parseOutlooks(payload: unknown): OverlayData {
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

    const rank = Number(properties.dn);
    if (!Number.isFinite(rank)) continue;

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        rank,
        label: text(properties.label),
        risk: text(properties.label2),
        // The service carries the Storm Prediction Center's own colours, so
        // the map is painted in the ones the outlook is published in rather
        // than an approximation of them.
        fill: text(properties.fill) || "#94a3b8",
        stroke: text(properties.stroke) || "#475569",
        valid: outlookTime(properties.valid),
        expire: outlookTime(properties.expire),
        issue: outlookTime(properties.issue),
      },
    });
  }

  // The service ranks them 2, 3, 4, 5, 6 and 8: general thunderstorms through
  // High, with 7 unused. Ascending puts the strongest last, which is on top.
  parsed.sort(
    (left, right) =>
      Number(left.properties.rank) - Number(right.properties.rank),
  );
  return { type: "FeatureCollection", features: parsed };
}

/**
 * Mesoscale discussions, minus the placeholder.
 *
 * With nothing active the service still answers with a single feature called
 * NoArea, a polygon a thousandth of a degree across. Drawn, it is a speck in
 * the Gulf that means nothing.
 */
export function parseDiscussions(payload: unknown): OverlayData {
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

    const name = text(properties.name);
    if (!name || name.toLowerCase() === "noarea") continue;

    const issued = Number(properties.idp_filedate);
    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        name,
        detail: text(properties.popupinfo),
        issued: Number.isFinite(issued) ? issued : null,
      },
    });
  }

  return { type: "FeatureCollection", features: parsed };
}

export const spcOutlooksOverlay: OverlayAdapter = {
  id: "spcOutlooks",
  label: "SPC outlook",
  attribution: ATTRIBUTION,
  attributionUrl: ATTRIBUTION_URL,
  host: HOST,
  // Day 1 is reissued at 0600, 1300, 1630, 2000 and 0100 UTC.
  refreshMs: 15 * 60_000,
  fetchData: async (bounds, signal) =>
    parseOutlooks(
      await query(
        OUTLOOK_LAYER,
        bounds,
        "dn,label,label2,valid,expire,issue,stroke,fill",
        signal,
      ),
    ),
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": ["get", "fill"],
        // Light enough that the radar it is under still reads through it.
        "fill-opacity": 0.28,
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": ["get", "stroke"],
        "line-width": 1.6,
      },
    },
  ],
  describe: (properties) => {
    const valid = Number(properties.valid);
    const expire = Number(properties.expire);
    const issue = Number(properties.issue);
    const lines = [translate("spc.outlookDay1")];
    if (Number.isFinite(valid) && Number.isFinite(expire)) {
      // With the day, because a Day 1 outlook runs from midday to midday and
      // reading the two clock times alone makes a nineteen hour window look
      // like a four hour one.
      lines.push(
        translate("spc.validBetween", {
          from: stamp(valid),
          to: stamp(expire),
        }),
      );
    }
    if (Number.isFinite(issue)) {
      lines.push(translate("spc.issued", { when: relativeTime(issue) }));
    }
    lines.push(translate("spc.guidanceNote"));
    return {
      title: String(properties.risk || properties.label || ""),
      lines,
      url: "https://www.spc.noaa.gov/products/outlook/day1otlk.html",
    };
  },
};

export const spcDiscussionsOverlay: OverlayAdapter = {
  id: "spcDiscussions",
  label: "SPC discussion",
  attribution: ATTRIBUTION,
  attributionUrl: ATTRIBUTION_URL,
  host: HOST,
  // Short fuse by design: one can be issued at any moment and lasts an hour or
  // two, so this is the fastest refresh of any overlay here.
  refreshMs: 5 * 60_000,
  fetchData: async (bounds, signal) =>
    parseDiscussions(
      await query(
        DISCUSSION_LAYER,
        bounds,
        "name,popupinfo,idp_filedate",
        signal,
      ),
    ),
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      paint: { "fill-color": "#c084fc", "fill-opacity": 0.16 },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#d8b4fe",
        "line-width": 1.6,
        "line-dasharray": [3, 2],
      },
    },
  ],
  describe: (properties) => {
    const issued = Number(properties.issued);
    const detail = String(properties.detail ?? "");
    return {
      title: String(properties.name ?? translate("spc.discussion")),
      lines: [
        Number.isFinite(issued)
          ? translate("spc.issued", { when: relativeTime(issued) })
          : translate("spc.issuedUnknown"),
        // The service carries the whole discussion text; a popup wants a line
        // of it, not four paragraphs.
        detail.length > 220 ? `${detail.slice(0, 217)}...` : detail,
        translate("spc.guidanceNote"),
      ].filter(Boolean),
      url: "https://www.spc.noaa.gov/products/md/",
    };
  },
};

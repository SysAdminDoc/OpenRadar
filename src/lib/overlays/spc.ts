import { translate } from "../../i18n";
import { serviceAnswer } from "../serviceAnswer";
import { cachedUrl } from "../tileCache";
import {
  boundsQuery,
  type SpcHazard,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const SERVICE = "https://mapservices.weather.noaa.gov/vector/rest/services";
const OUTLOOKS = `${SERVICE}/outlooks/SPC_wx_outlks/MapServer`;

/** The days the service publishes a convective outlook for. */
export const SPC_DAYS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** The hazards Day 1 and Day 2 break their probabilities down by. */
export const SPC_HAZARDS: SpcHazard[] = [
  "categorical",
  "tornado",
  "hail",
  "wind",
];

/**
 * Which numbered layer answers for a day and a hazard.
 *
 * Read off the service's own layer list rather than worked out from a
 * pattern, because there is no pattern: Day 1 and Day 2 carry a categorical
 * and three hazards apiece, Day 3 carries a categorical and one combined
 * probability, and Days 4 to 8 carry a probability and nothing else. Read
 * 2026-09-04 from `SPC_wx_outlks/MapServer?f=pjson`.
 *
 * The second number is the conditional intensity, which is the hatched area
 * where the hazard, if it happens, is expected to be significant. It exists
 * only where a hazard probability does.
 */
export function outlookLayers(
  day: number,
  hazard: SpcHazard,
): { probability: number; significant: number | null } | null {
  if (day >= 4) {
    // Day 4 is layer 21, and one per day after it.
    if (day > 8) return null;
    return { probability: 17 + day, significant: null };
  }
  if (day === 3) {
    return hazard === "categorical"
      ? { probability: 17, significant: null }
      : { probability: 19, significant: 18 };
  }
  const base = day === 1 ? 0 : 8;
  if (hazard === "categorical")
    return { probability: base + 1, significant: null };
  const at = { tornado: 3, hail: 5, wind: 7 }[hazard];
  return { probability: base + at, significant: base + at - 1 };
}

/** The address of one numbered layer's query endpoint. */
function layerQuery(layer: number): string {
  return `${OUTLOOKS}/${layer}/query`;
}
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

/** The name the hatched fill's pattern is registered under. */
export const HATCH_IMAGE = "openradar-spc-hatch";

/**
 * Diagonal hatching, built rather than shipped as a file.
 *
 * The Storm Prediction Center hatches the area where a hazard would be
 * significant if it happened, and there is no fill pattern in a map style
 * that draws one. Eight pixels with a single diagonal stroke tiles into the
 * hatch every one of their own products uses.
 */
export function hatch(size = 8): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const data = new Uint8Array(size * size * 4);
  for (let at = 0; at < size; at += 1) {
    for (const across of [at, (at + 1) % size]) {
      const pixel = (at * size + across) * 4;
      data[pixel] = 17;
      data[pixel + 1] = 24;
      data[pixel + 2] = 39;
      data[pixel + 3] = 235;
    }
  }
  return { width: size, height: size, data };
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
export function parseOutlooks(
  payload: unknown,
  /** True for the hatched area, which is drawn over the bands rather than in them. */
  significant = false,
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

    // The categorical and probability layers rank by a number: a risk
    // level, or a percentage. The conditional intensity layers rank by a
    // name (`CIG1` and up), and dropping what will not parse as a number
    // threw the whole hatched area away.
    const rank = Number(properties.dn);
    const named = text(properties.dn);
    if (!Number.isFinite(rank) && !named) continue;

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        rank: Number.isFinite(rank) ? rank : 0,
        significant,
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

/**
 * The colours the categorical outlook is published in, by its own code.
 *
 * The live service carries a fill and a stroke on every feature; the archive
 * this replays from carries neither, only a threshold code. Rather than
 * invent colours for it, these are the service's own, read from
 * `SPC_wx_outlks/MapServer/1?f=pjson` on 2026-09-04 and keyed by the code
 * the archive uses for the same category.
 */
const CATEGORY_COLOURS: Record<
  string,
  { rank: number; fill: string; stroke: string }
> = {
  TSTM: { rank: 2, fill: "#c1e9c1", stroke: "#55bb55" },
  MRGL: { rank: 3, fill: "#66a366", stroke: "#005500" },
  SLGT: { rank: 4, fill: "#ffe066", stroke: "#ddaa00" },
  ENH: { rank: 5, fill: "#ffa366", stroke: "#ff6600" },
  MDT: { rank: 6, fill: "#e06666", stroke: "#cc0000" },
  HIGH: { rank: 8, fill: "#ee99ee", stroke: "#cc00cc" },
};

/** The archive of past outlooks, on the host the replay already reads. */
const ARCHIVE = "https://mesonet.agron.iastate.edu/api/1/nws";

/**
 * The outlook that stood over a replayed day.
 *
 * One request per replay rather than one per frame: an outlook is issued a
 * few times a day and does not change as a loop steps through an afternoon.
 * `cycle=-1` asks the archive for one deterministic issuance rather than
 * having this guess at the hours the Center issues on, and what comes back
 * says which issuance it is, so the popup can name it rather than implying
 * the reader is looking at whichever one they expected.
 */
export function archiveOutlookUrl(from: number): string {
  const day = new Date(from).toISOString().slice(0, 10);
  const search = new URLSearchParams({
    day: "1",
    valid: day,
    cycle: "-1",
    outlook_type: "C",
  });
  return `${ARCHIVE}/spc_outlook.geojson?${search.toString()}`;
}

/** The archive's own answer, in the shape the live layer draws. */
export function parseArchiveOutlooks(payload: unknown): OverlayData {
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
    const code = text(properties.threshold).toUpperCase();
    const known = CATEGORY_COLOURS[code];
    if (!known) continue;

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        rank: known.rank,
        significant: false,
        label: code,
        risk: code,
        fill: known.fill,
        stroke: known.stroke,
        day: 1,
        archived: true,
        valid: Date.parse(text(properties.issue)) || null,
        expire: Date.parse(text(properties.expire)) || null,
        issue: Date.parse(text(properties.product_issue)) || null,
      },
    });
  }

  parsed.sort(
    (left, right) =>
      Number(left.properties.rank) - Number(right.properties.rank),
  );
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
  // A different day, or a different hazard, is a different picture rather
  // than a stale one. Compared before freshness, so switching does not wait
  // out the poll.
  variant: (choices) =>
    choices.replay
      ? `replay:${choices.replay.from}`
      : `${choices.spcDay}:${choices.spcHazard}`,
  fetchData: async (bounds, signal, choices) => {
    // A replay draws the outlook that stood over that day. Today's over
    // somebody else's afternoon is the same false claim the warnings
    // layer is held back for.
    if (choices.replay) {
      const response = await fetch(
        cachedUrl(archiveOutlookUrl(choices.replay.from)),
        { signal, headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(
          translate("spc.serviceStatus", {
            answer: serviceAnswer(response.status),
          }),
        );
      }
      return parseArchiveOutlooks(await response.json());
    }
    const chosen = outlookLayers(choices.spcDay, choices.spcHazard);
    if (!chosen) return { type: "FeatureCollection", features: [] };
    const fields = "dn,label,label2,valid,expire,issue,stroke,fill";
    const bands = parseOutlooks(
      await query(layerQuery(chosen.probability), bounds, fields, signal),
    );
    const withDay = (features: OverlayFeature[]) =>
      features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, day: choices.spcDay },
      }));
    if (chosen.significant === null) {
      return { type: "FeatureCollection", features: withDay(bands.features) };
    }
    // The hatched area is a second layer of the same service, drawn over the
    // bands rather than among them: it says where the hazard would be
    // significant IF it happens, which is a different statement from how
    // likely it is at all.
    let hatched: OverlayFeature[] = [];
    try {
      hatched = parseOutlooks(
        await query(layerQuery(chosen.significant), bounds, fields, signal),
        true,
      ).features;
    } catch {
      // The bands are the answer; the hatching is an annotation on them, and
      // losing it is not worth losing the outlook over.
    }
    // Which outlook this is travels on the features, because the popup is
    // handed a feature and nothing else.
    const stamped = [...bands.features, ...hatched].map((feature) => ({
      ...feature,
      properties: { ...feature.properties, day: choices.spcDay },
    }));
    return { type: "FeatureCollection", features: stamped };
  },
  images: () => [{ id: HATCH_IMAGE, ...hatch() }],
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      filter: ["!=", ["get", "significant"], true],
      paint: {
        "fill-color": ["get", "fill"],
        // Light enough that the radar it is under still reads through it.
        "fill-opacity": 0.28,
      },
    },
    {
      id: `${sourceId}-hatch`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["get", "significant"], true],
      paint: {
        "fill-pattern": HATCH_IMAGE,
        "fill-opacity": 0.9,
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
    const lines = [
      properties.significant === true
        ? translate("spc.significant")
        : properties.archived === true
          ? translate("spc.asIssued")
          : translate("spc.outlookDay", {
              day: String(properties.day ?? 1),
            }),
    ];
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

import {
  boundsQuery,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const SERVICE =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const FIELDS =
  "objectid,prod_type,msg_type,phenom,sig,wfo,url,onset,ends,expiration,issuance";

export type AlertSeverity = "extreme" | "severe" | "moderate" | "minor";

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  extreme: 3,
  severe: 2,
  moderate: 1,
  minor: 0,
};

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  extreme: "#f43f5e",
  severe: "#fb923c",
  moderate: "#facc15",
  minor: "#38bdf8",
};

const EXTREME = [
  "tornado warning",
  "flash flood emergency",
  "extreme wind warning",
  "hurricane warning",
  "tsunami warning",
];

/**
 * The service publishes a CAP significance code (W, A, Y, S). It is blank on a
 * few product types, so the product name is the fallback and life-threatening
 * warnings are lifted above the rest.
 */
export function alertSeverity(prodType: string, sig: string): AlertSeverity {
  const name = prodType.trim().toLowerCase();
  if (EXTREME.includes(name)) return "extreme";

  switch (sig.trim().toUpperCase()) {
    case "W":
      return "severe";
    case "A":
      return "moderate";
    case "Y":
      return "minor";
    default:
      break;
  }

  if (name.endsWith("warning")) return "severe";
  if (name.endsWith("watch")) return "moderate";
  return "minor";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAlerts(payload: unknown): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const feature = item as {
      geometry?: unknown;
      properties?: Record<string, unknown>;
    };
    if (!feature.geometry || typeof feature.geometry !== "object") continue;
    const properties = feature.properties ?? {};
    const prodType = text(properties.prod_type) || "Weather alert";
    const severity = alertSeverity(prodType, text(properties.sig));

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        headline: prodType,
        severity,
        severityRank: SEVERITY_RANK[severity],
        office: text(properties.wfo),
        url: text(properties.url),
        issued: epoch(properties.issuance) ?? epoch(properties.onset),
        expires: epoch(properties.expiration) ?? epoch(properties.ends),
      },
    });
  }

  parsed.sort(
    (left, right) =>
      Number(right.properties.severityRank) -
      Number(left.properties.severityRank),
  );
  return { type: "FeatureCollection", features: parsed };
}

function timeLabel(value: unknown): string {
  if (typeof value !== "number") return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export const alertsOverlay: OverlayAdapter = {
  id: "alerts",
  label: "Weather Alerts",
  attribution:
    '<a href="https://www.weather.gov/">NWS watches and warnings</a>',
  attributionUrl: "https://www.weather.gov/",
  host: "mapservices.weather.noaa.gov",
  refreshMs: 60_000,
  fetchData: async (bounds: OverlayBounds, signal) => {
    const query = new URLSearchParams({
      where: "1=1",
      outFields: FIELDS,
      returnGeometry: "true",
      geometryPrecision: "3",
      outSR: "4326",
      inSR: "4326",
      geometry: boundsQuery(bounds),
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: "300",
      f: "geojson",
    });
    const response = await fetch(`${SERVICE}?${query.toString()}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`NWS alerts returned ${response.status}.`);
    }
    return parseAlerts(await response.json());
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "match",
          ["get", "severity"],
          "extreme",
          SEVERITY_COLOR.extreme,
          "severe",
          SEVERITY_COLOR.severe,
          "moderate",
          SEVERITY_COLOR.moderate,
          SEVERITY_COLOR.minor,
        ],
        "fill-opacity": 0.2,
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": [
          "match",
          ["get", "severity"],
          "extreme",
          SEVERITY_COLOR.extreme,
          "severe",
          SEVERITY_COLOR.severe,
          "moderate",
          SEVERITY_COLOR.moderate,
          SEVERITY_COLOR.minor,
        ],
        "line-width": ["case", [">=", ["get", "severityRank"], 2], 2.2, 1.2],
      },
    },
  ],
  describe: (properties) => ({
    title: String(properties.headline ?? "Weather alert"),
    lines: [
      `Issued ${timeLabel(properties.issued)}`,
      `Expires ${timeLabel(properties.expires)}`,
      `Source: NWS ${String(properties.office ?? "").trim() || "watches and warnings"}`,
    ],
    url: typeof properties.url === "string" ? properties.url : undefined,
  }),
};

import {
  boundsQuery,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { translate } from "../../i18n";
import { formatClock } from "../units";

const SERVICE =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const FIELDS =
  "objectid,cap_id,prod_type,msg_type,phenom,sig,wfo,url,onset,ends,expiration,issuance";

/**
 * The active alerts as the National Weather Service publishes them.
 *
 * The map service the polygons come from carries no damage threat: its fields
 * are the product type, the office and the times, and nothing else. The tag
 * that separates a considerable warning from an ordinary one lives only in the
 * alert feed, which has no geometry worth drawing. So both are asked for and
 * joined on the common alert identifier, which the two sources spell the same
 * way.
 */
const ALERT_FEED = "https://api.weather.gov/alerts/active?status=actual";

/** How much damage the office said to expect, when they said anything. */
export type ImpactTag = "considerable" | "destructive" | "catastrophic";

export const IMPACT_RANK: Record<ImpactTag, number> = {
  considerable: 1,
  destructive: 2,
  catastrophic: 3,
};

function impactOf(word: unknown): ImpactTag | null {
  const named = typeof word === "string" ? word.trim().toLowerCase() : "";
  if (named === "considerable") return "considerable";
  if (named === "destructive") return "destructive";
  if (named === "catastrophic") return "catastrophic";
  return null;
}

/** A parameter in the feed is a list, because one alert can carry several. */
function firstParameter(parameters: unknown, name: string): unknown {
  if (!parameters || typeof parameters !== "object") return null;
  const found = (parameters as Record<string, unknown>)[name];
  return Array.isArray(found) ? found[0] : found;
}

export interface AlertTags {
  impact: ImpactTag | null;
  /** The larger of the two threats, since a warning can carry both. */
  hailSize: string;
  motion: string;
}

/**
 * The tags in the alert feed, by the identifier the polygons also carry.
 *
 * A tornado warning and a thunderstorm warning name their threat in different
 * parameters, and the stronger of the two is the one worth drawing.
 */
export function parseAlertTags(payload: unknown): Map<string, AlertTags> {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const out = new Map<string, AlertTags>();
  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const properties = (item as { properties?: Record<string, unknown> })
      .properties;
    if (!properties) continue;
    const id = text(properties.id);
    if (!id) continue;
    const parameters = properties.parameters;
    const tornado = impactOf(firstParameter(parameters, "tornadoDamageThreat"));
    const thunderstorm = impactOf(
      firstParameter(parameters, "thunderstormDamageThreat"),
    );
    const impact =
      tornado && thunderstorm
        ? IMPACT_RANK[tornado] >= IMPACT_RANK[thunderstorm]
          ? tornado
          : thunderstorm
        : (tornado ?? thunderstorm);
    out.set(id, {
      impact,
      hailSize: text(firstParameter(parameters, "maxHailSize")),
      motion: text(firstParameter(parameters, "eventMotionDescription")),
    });
  }
  return out;
}

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

export function parseAlerts(
  payload: unknown,
  tags: Map<string, AlertTags> = new Map(),
): OverlayData {
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
    const capId = text(properties.cap_id);
    const tagged = tags.get(capId);

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        headline: prodType,
        severity,
        severityRank: SEVERITY_RANK[severity],
        capId,
        // A polygon with no tag is an ordinary warning, which is most of them,
        // and is drawn as it always was.
        impact: tagged?.impact ?? "",
        impactRank: tagged?.impact ? IMPACT_RANK[tagged.impact] : 0,
        hailSize: tagged?.hailSize ?? "",
        motion: tagged?.motion ?? "",
        office: text(properties.wfo),
        url: text(properties.url),
        issued: epoch(properties.issuance) ?? epoch(properties.onset),
        expires: epoch(properties.expiration) ?? epoch(properties.ends),
      },
    });
  }

  // A destructive warning goes on top of an ordinary one of the same kind, so
  // the tag is part of the order rather than only part of the outline.
  parsed.sort(
    (left, right) =>
      Number(right.properties.severityRank) -
        Number(left.properties.severityRank) ||
      Number(right.properties.impactRank) - Number(left.properties.impactRank),
  );
  return { type: "FeatureCollection", features: parsed };
}

function timeLabel(value: unknown): string {
  if (typeof value !== "number") return "unknown";
  return formatClock(new Date(value), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
    // The polygons and the tags are asked for together. A warning with no
    // tag is an ordinary warning, which is most of them, so losing the tag
    // feed must not lose the alerts: the map is the thing people act on.
    const [response, tagged] = await Promise.all([
      fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
        signal,
        headers: { Accept: "application/json" },
      }),
      fetch(cachedUrl(ALERT_FEED), {
        signal,
        headers: { Accept: "application/geo+json" },
      })
        .then((answer) => (answer.ok ? answer.json() : null))
        .catch(() => null),
    ]);
    if (!response.ok) {
      throw new Error(`NWS alerts returned ${response.status}.`);
    }
    return parseAlerts(await response.json(), parseAlertTags(tagged));
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
        // A tagged warning is drawn heavier than an ordinary one of the same
        // kind, because that is exactly the distinction the tag makes: the
        // office is saying this one will do more damage than the usual.
        "line-width": [
          "case",
          [">=", ["get", "impactRank"], 2],
          4,
          [">=", ["get", "impactRank"], 1],
          3,
          [">=", ["get", "severityRank"], 2],
          2.2,
          1.2,
        ],
      },
    },
  ],
  describe: (properties) => ({
    title: String(properties.headline ?? translate("popup.alert")),
    lines: [
      translate("popup.issued", { when: timeLabel(properties.issued) }),
      translate("popup.expires", { when: timeLabel(properties.expires) }),
      ...(properties.impact
        ? [
            translate("alerts.impactLine", {
              tag: translate(
                `alerts.impact.${String(properties.impact)}` as never,
              ),
            }),
          ]
        : []),
      ...(properties.hailSize
        ? [translate("alerts.hailTo", { size: String(properties.hailSize) })]
        : []),
      translate("popup.alertSource", {
        office:
          String(properties.office ?? "").trim() ||
          translate("popup.alertOffice"),
      }),
    ],
    url: typeof properties.url === "string" ? properties.url : undefined,
  }),
};

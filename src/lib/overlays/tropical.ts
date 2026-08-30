import {
  relativeTime,
  type OverlayAdapter,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const SERVICE =
  "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer";

/** The layers that make up one advisory package. */
const LAYERS: Array<{
  id: number;
  kind: TropicalKind;
  fields: string;
  orderBy?: string;
  limit?: number;
}> = [
  { id: 7, kind: "cone", fields: "stormname,stormtype,advisnum,advdate,basin" },
  { id: 6, kind: "track", fields: "stormname,stormtype,advisnum,basin" },
  {
    id: 5,
    kind: "point",
    fields:
      "stormname,stormtype,maxwind,gust,mslp,datelbl,tcdvlp,advisnum,advdate,basin,tau,binnumber",
    // Hour zero first, so a cap can never drop the row the storm list needs.
    orderBy: "tau ASC",
    limit: 400,
  },
  { id: 8, kind: "watch", fields: "stormname,tcww,advisnum,basin" },
  {
    id: 3,
    kind: "outlook",
    fields: "basin,prob2day,risk2day,prob7day,risk7day",
  },
];

export type TropicalKind = "cone" | "track" | "point" | "watch" | "outlook";

/** Saffir-Simpson in knots, with the two sub-hurricane bands below it. */
export function stormCategory(maxWindKt: number): string {
  if (maxWindKt >= 137) return "Category 5";
  if (maxWindKt >= 113) return "Category 4";
  if (maxWindKt >= 96) return "Category 3";
  if (maxWindKt >= 83) return "Category 2";
  if (maxWindKt >= 64) return "Category 1";
  if (maxWindKt >= 34) return "Tropical storm";
  return "Tropical depression";
}

export const CATEGORY_COLORS = [
  [0, "#94a3b8"],
  [34, "#38bdf8"],
  [64, "#facc15"],
  [83, "#fb923c"],
  [96, "#f97316"],
  [113, "#f43f5e"],
  [137, "#c026d3"],
] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseTropicalLayer(
  payload: unknown,
  kind: TropicalKind,
): OverlayFeature[] {
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
    const maxWind = Number(properties.maxwind);

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        kind,
        name: text(properties.stormname) || text(properties.basin),
        stormType: text(properties.stormtype) || text(properties.tcdvlp),
        advisory: text(properties.advisnum),
        advisoryDate: text(properties.advdate),
        basin: text(properties.basin),
        maxWind: Number.isFinite(maxWind) ? maxWind : null,
        gust: Number(properties.gust) || null,
        pressure: Number(properties.mslp) || null,
        pointLabel: text(properties.datelbl),
        // A missing forecast hour has to stay missing: Number(null) is zero,
        // which is exactly the value that marks the current position.
        tau:
          properties.tau === null ||
          properties.tau === undefined ||
          properties.tau === ""
            ? null
            : Number(properties.tau),
        bin: text(properties.binnumber),
        watch: text(properties.tcww),
        prob2day: text(properties.prob2day),
        risk2day: text(properties.risk2day),
        prob7day: text(properties.prob7day),
        risk7day: text(properties.risk7day),
      },
    });
  }

  return parsed;
}

export const tropicalOverlay: OverlayAdapter = {
  id: "tropical",
  label: "Tropical",
  attribution:
    '<a href="https://www.nhc.noaa.gov/">NOAA National Hurricane Center</a>',
  attributionUrl: "https://www.nhc.noaa.gov/",
  host: "mapservices.weather.noaa.gov",
  refreshMs: 5 * 60_000,
  // One advisory package covers whole ocean basins, so the viewport is no help.
  global: true,
  fetchData: async (_bounds, signal) => {
    const responses = await Promise.all(
      LAYERS.map(async (layer) => {
        const query = new URLSearchParams({
          where: "1=1",
          outFields: layer.fields,
          returnGeometry: "true",
          geometryPrecision: "3",
          outSR: "4326",
          resultRecordCount: String(layer.limit ?? 60),
          f: "geojson",
        });
        if (layer.orderBy) query.set("orderByFields", layer.orderBy);
        const response = await fetch(
          `${SERVICE}/${layer.id}/query?${query.toString()}`,
          { signal, headers: { Accept: "application/json" } },
        );
        if (!response.ok) {
          throw new Error(`The tropical service returned ${response.status}.`);
        }
        return parseTropicalLayer(await response.json(), layer.kind);
      }),
    );

    return {
      type: "FeatureCollection",
      features: responses.flat(),
    } satisfies OverlayData;
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-outlook`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["get", "kind"], "outlook"],
      paint: { "fill-color": "#fbbf24", "fill-opacity": 0.08 },
    },
    {
      id: `${sourceId}-outlook-line`,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "kind"], "outlook"],
      paint: {
        "line-color": "#fbbf24",
        "line-width": 1.4,
        "line-dasharray": [3, 2],
      },
    },
    {
      id: `${sourceId}-cone`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["get", "kind"], "cone"],
      paint: { "fill-color": "#e2e8f0", "fill-opacity": 0.16 },
    },
    {
      id: `${sourceId}-cone-line`,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "kind"], "cone"],
      paint: { "line-color": "#e2e8f0", "line-width": 1.2 },
    },
    {
      id: `${sourceId}-watch`,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "kind"], "watch"],
      paint: { "line-color": "#f43f5e", "line-width": 3 },
    },
    {
      id: `${sourceId}-track`,
      type: "line",
      source: sourceId,
      filter: ["==", ["get", "kind"], "track"],
      paint: {
        "line-color": "#f8fafc",
        "line-width": 2,
        "line-dasharray": [2, 1.5],
      },
    },
    {
      id: `${sourceId}-points`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["get", "kind"], "point"],
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "maxWind"], 0],
          ...CATEGORY_COLORS.flatMap(([knots, color]) => [knots, color]),
        ],
        "circle-stroke-color": "#0b1018",
        "circle-stroke-width": 1.5,
      },
    },
  ],
  describe: (properties) => {
    const kind = String(properties.kind ?? "");
    if (kind === "outlook") {
      return {
        title: `${String(properties.basin ?? "Tropical")} outlook`,
        lines: [
          `Two-day chance ${String(properties.prob2day ?? "unknown")} (${String(properties.risk2day ?? "unknown")})`,
          `Seven-day chance ${String(properties.prob7day ?? "unknown")} (${String(properties.risk7day ?? "unknown")})`,
          "Source: NOAA National Hurricane Center",
        ],
      };
    }

    const maxWind = Number(properties.maxWind);
    const lines: string[] = [];
    if (Number.isFinite(maxWind)) {
      lines.push(`${stormCategory(maxWind)}, ${maxWind} kt sustained`);
    }
    if (properties.pointLabel) lines.push(String(properties.pointLabel));
    if (properties.advisory) {
      lines.push(`Advisory ${String(properties.advisory)}`);
    }
    lines.push("Source: NOAA National Hurricane Center");

    return {
      title: String(properties.name ?? "Tropical system"),
      lines,
      url: "https://www.nhc.noaa.gov/",
    };
  },
};

export { relativeTime };

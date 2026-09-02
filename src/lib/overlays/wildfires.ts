import {
  boundsQuery,
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { translate } from "../../i18n";

const SERVICE =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
const FIELDS =
  "poly_IncidentName,poly_GISAcres,attr_PercentContained,attr_FireDiscoveryDateTime,poly_DateCurrent";

export function parseWildfires(payload: unknown): OverlayData {
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
    const acres = Number(properties.poly_GISAcres);

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        name:
          typeof properties.poly_IncidentName === "string"
            ? properties.poly_IncidentName
            : "Wildfire",
        acres: Number.isFinite(acres) ? acres : null,
        contained: Number(properties.attr_PercentContained) || 0,
        discovered: Number(properties.attr_FireDiscoveryDateTime) || null,
        updated: Number(properties.poly_DateCurrent) || null,
      },
    });
  }

  parsed.sort(
    (left, right) =>
      Number(right.properties.acres) - Number(left.properties.acres),
  );
  return { type: "FeatureCollection", features: parsed };
}

export const wildfiresOverlay: OverlayAdapter = {
  id: "wildfires",
  label: "Wildfires",
  attribution:
    '<a href="https://data-nifc.opendata.arcgis.com/">NIFC wildfire perimeters</a>',
  attributionUrl: "https://data-nifc.opendata.arcgis.com/",
  host: "services3.arcgis.com",
  refreshMs: 10 * 60_000,
  fetchData: async (bounds: OverlayBounds, signal) => {
    const query = new URLSearchParams({
      // Perimeters under a hundred acres are noise at these zoom levels.
      where: "poly_GISAcres>100",
      outFields: FIELDS,
      returnGeometry: "true",
      geometryPrecision: "3",
      // Full-resolution perimeters run to megabytes, so the server generalizes.
      maxAllowableOffset: "0.01",
      outSR: "4326",
      inSR: "4326",
      geometry: boundsQuery(bounds),
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: "200",
      f: "geojson",
    });
    const response = await fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`NIFC returned ${response.status}.`);
    }
    return parseWildfires(await response.json());
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      paint: { "fill-color": "#f97316", "fill-opacity": 0.3 },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      paint: { "line-color": "#fdba74", "line-width": 1.4 },
    },
  ],
  describe: (properties) => {
    const acres = Number(properties.acres);
    const updated = Number(properties.updated);
    return {
      title: String(properties.name ?? translate("popup.wildfire")),
      lines: [
        Number.isFinite(acres)
          ? translate("popup.acres", {
              // Raw, because the sentence counts by it.
              acres: Math.round(acres),
              contained: Number(properties.contained) || 0,
            })
          : translate("popup.sizeUnknown"),
        Number.isFinite(updated)
          ? translate("popup.perimeterUpdated", {
              when: relativeTime(updated),
            })
          : translate("popup.perimeterUnknown"),
        translate("popup.nifc"),
      ],
    };
  },
};

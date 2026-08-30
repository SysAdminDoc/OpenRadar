import type { StyleSpecification } from "maplibre-gl";
import type { MapStyleId } from "./settings";

export interface MapStyleOption {
  id: MapStyleId;
  label: string;
  detail: string;
  swatch: string;
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  {
    id: "grayscale",
    label: "Grayscale",
    detail: "Quiet labels",
    swatch: "#d6d8dc",
  },
  { id: "roads", label: "Roads", detail: "Street detail", swatch: "#e8d9b5" },
  {
    id: "aerial",
    label: "Aerial",
    detail: "USGS orthoimagery, United States",
    swatch: "#446448",
  },
  {
    id: "topography",
    label: "Topography",
    detail: "Terrain and contours",
    swatch: "#99a77e",
  },
  {
    id: "pro-dark",
    label: "Radar Dark",
    detail: "Low-glare radar",
    swatch: "#151b26",
  },
  {
    id: "pro-light",
    label: "Radar Light",
    detail: "Bright canvas",
    swatch: "#edf0ef",
  },
  {
    id: "daylight",
    label: "Daylight",
    detail: "High visibility",
    swatch: "#9fd6f0",
  },
];

const EMPTY_TEST_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#101722" },
    },
  ],
};

function rasterStyle(
  tiles: string[],
  attribution: string,
  maxzoom?: number,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom,
        attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

export function mapStyleDefinition(
  id: MapStyleId,
): string | StyleSpecification {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("testMode")
  ) {
    return EMPTY_TEST_STYLE;
  }

  switch (id) {
    case "grayscale":
    case "pro-light":
      return "https://tiles.openfreemap.org/styles/positron";
    case "roads":
      return "https://tiles.openfreemap.org/styles/liberty";
    case "daylight":
      return "https://tiles.openfreemap.org/styles/bright";
    case "aerial":
      // USGS orthoimagery is public domain and needs no key, unlike the Esri
      // World Imagery service, which requires an ArcGIS account outside Esri
      // software.
      return rasterStyle(
        [
          "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        ],
        "USDA, USGS The National Map: Orthoimagery",
        19,
      );
    case "topography":
      return rasterStyle(
        ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        // OpenTopoMap asks for this exact credit line.
        "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)",
        17,
      );
    case "dark":
    case "pro-dark":
    default:
      return "https://tiles.openfreemap.org/styles/dark";
  }
}

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
    detail: "Satellite imagery",
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

function rasterStyle(tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
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
      return rasterStyle(
        [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        "Tiles © Esri",
      );
    case "topography":
      return rasterStyle(
        ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        "Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap",
      );
    case "dark":
    case "pro-dark":
    default:
      return "https://tiles.openfreemap.org/styles/dark";
  }
}

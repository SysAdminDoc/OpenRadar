import type { StyleSpecification } from "maplibre-gl";
import type { IncidentPackReference, MapStyleId, ThemeMode } from "./settings";
import type { StringKey } from "../i18n";
import { incidentTileTemplate } from "./incidentPacks";

export interface MapStyleOption {
  id: MapStyleId;
  /** What the style is called, read through the catalogue when it is shown. */
  key: StringKey;
  detailKey: StringKey;
  swatch: string;
}

export const MAP_STYLE_OPTIONS: MapStyleOption[] = [
  {
    id: "auto",
    key: "style.auto",
    detailKey: "style.autoDetail",
    // Half of each, since it is whichever the workspace is.
    swatch: "linear-gradient(135deg, #11151e 50%, #d6d8dc 50%)",
  },
  {
    id: "grayscale",
    key: "style.grayscale",
    detailKey: "style.grayscaleDetail",
    swatch: "#d6d8dc",
  },
  {
    id: "roads",
    key: "style.roads",
    detailKey: "style.roadsDetail",
    swatch: "#e8d9b5",
  },
  {
    id: "aerial",
    key: "style.aerial",
    detailKey: "style.aerialDetail",
    swatch: "#446448",
  },
  {
    id: "topography",
    key: "style.topography",
    detailKey: "style.topographyDetail",
    swatch: "#99a77e",
  },
  {
    id: "pro-dark",
    key: "style.radarDark",
    detailKey: "style.radarDarkDetail",
    swatch: "#151b26",
  },
  {
    id: "pro-light",
    key: "style.radarLight",
    detailKey: "style.radarLightDetail",
    swatch: "#edf0ef",
  },
  {
    id: "daylight",
    key: "style.daylight",
    detailKey: "style.daylightDetail",
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
  minzoom?: number,
  bounds?: [number, number, number, number],
): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom,
        minzoom,
        bounds,
        attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

/**
 * The style a setting actually draws, with Auto resolved against the theme.
 *
 * Choosing Light in Settings used to leave the dark basemap under white
 * panels, because the theme only ever set an attribute on the document.
 */
export function resolvedMapStyle(id: MapStyleId, theme: ThemeMode): MapStyleId {
  if (id !== "auto") return id;
  return theme === "light" ? "pro-light" : "pro-dark";
}

export function mapStyleDefinition(
  id: MapStyleId,
  incidentPack?: IncidentPackReference | null,
): string | StyleSpecification {
  const incidentTile = incidentPack
    ? incidentTileTemplate(incidentPack.id)
    : null;
  if (incidentPack && incidentTile) {
    return rasterStyle(
      [incidentTile],
      incidentPack.attribution,
      incidentPack.maxZoom,
      incidentPack.minZoom,
      [
        incidentPack.bounds.west,
        incidentPack.bounds.south,
        incidentPack.bounds.east,
        incidentPack.bounds.north,
      ],
    );
  }

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

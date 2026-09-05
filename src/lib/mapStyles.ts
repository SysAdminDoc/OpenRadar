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

/** What the map is painted on where no tiles are drawn. */
export const MAP_GROUND_DARK = "#101722";
export const MAP_GROUND_LIGHT = "#e9edf2";

/**
 * A basemap with no tiles behind it, for the browser suite.
 *
 * Its ground follows the style it stands in for. It was one dark colour for
 * every style, so a spec that picked the light theme got a light workspace
 * over a near-black map: `data-over-light` was set, the ink flipped to dark
 * for it, and every contrast assertion about a light basemap was measured
 * against a dark canvas. A stand-in that gets the ground backwards cannot
 * catch the one class of defect it is standing in for.
 */
function emptyTestStyle(id: MapStyleId): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": isLightBasemap(id)
            ? MAP_GROUND_LIGHT
            : MAP_GROUND_DARK,
        },
      },
    ],
  };
}

/**
 * The credit for the map under the weather, for the style on screen.
 *
 * Five of the seven styles are OpenStreetMap data by way of OpenFreeMap, and
 * Auto is a chooser rather than a style of its own, so it never reaches here:
 * it has already resolved to one of the seven by the time a credit is asked
 * for. Counting it made the README say seven in one place and eight in
 * another, which reads as one of them being wrong.
 * saying so is right for those. Aerial is USGS orthoimagery and topography is
 * OpenTopoMap, which asks for an exact line, so a picture exported over either
 * one used to credit a service that had nothing to do with it. An incident
 * pack carries its own, because the tiles came out of the pack rather than off
 * a network at all.
 *
 * The same strings the map's own attribution bar shows, from the same place,
 * so the corner of an exported picture and the corner of the window cannot
 * drift apart.
 */
/**
 * The three the OpenFreeMap styles credit.
 *
 * Not "OpenStreetMap" alone, which is what the burned line used to say: the
 * attribution bar on screen reads the style's own TileJSON, and that names
 * OpenFreeMap for the hosting, OpenMapTiles for the schema and OpenStreetMap
 * for the data. A picture that credits one of the three is a picture whose
 * corner disagrees with the window it was taken from.
 */
export const OPENSTREETMAP_CREDIT = "OpenFreeMap, OpenMapTiles, OpenStreetMap";
export const USGS_IMAGERY_CREDIT = "USDA, USGS The National Map: Orthoimagery";
/** OpenTopoMap asks for this exact credit line. */
export const OPENTOPOMAP_CREDIT =
  "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)";

export function basemapCredit(
  id: MapStyleId,
  theme: ThemeMode,
  incidentPack?: IncidentPackReference | null,
): string {
  // A pack only gets the credit when its tiles are the ones being drawn.
  // `mapStyleDefinition` falls back to the network style when the pack has no
  // template to draw from, and crediting a pack for a picture it did not draw
  // is the same error as crediting OpenStreetMap for USGS imagery.
  if (incidentPack && incidentTileTemplate(incidentPack.id)) {
    return incidentPack.attribution;
  }
  switch (resolvedMapStyle(id, theme)) {
    case "aerial":
      return USGS_IMAGERY_CREDIT;
    case "topography":
      return OPENTOPOMAP_CREDIT;
    default:
      return OPENSTREETMAP_CREDIT;
  }
}

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
/**
 * Whether a style draws the ground light.
 *
 * Anything drawn over the basemap has to be legible against it, and the
 * basemap is chosen separately from the app's own look: somebody can run the
 * dark workspace over the aerial imagery. The reading here is about the
 * ground, not about the panels, which is why it lives with the styles rather
 * than with the theme.
 *
 * Aerial imagery is called dark. It is neither, but photographs of land are
 * mid-toned and a light line reads on them where a dark one disappears into
 * shadow.
 */
export function isLightBasemap(id: MapStyleId): boolean {
  switch (id) {
    case "grayscale":
    case "pro-light":
    case "roads":
    case "daylight":
    case "topography":
      return true;
    default:
      return false;
  }
}

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
    return emptyTestStyle(id);
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
        USGS_IMAGERY_CREDIT,
        19,
      );
    case "topography":
      return rasterStyle(
        ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        OPENTOPOMAP_CREDIT,
        17,
      );
    case "pro-dark":
    default:
      return "https://tiles.openfreemap.org/styles/dark";
  }
}

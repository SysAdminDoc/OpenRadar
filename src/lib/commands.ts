import { MAP_STYLE_OPTIONS } from "./mapStyles";
import { LEVEL2_PRODUCTS } from "./level2";
import type { LayerSettings, MapStyleId } from "./settings";

export type CommandAction =
  | { kind: "layer"; layer: keyof LayerSettings }
  | { kind: "style"; style: MapStyleId }
  | { kind: "product"; product: string }
  | { kind: "surface"; surface: string }
  | { kind: "tool"; tool: string };

export interface Command {
  id: string;
  label: string;
  group: string;
  /**
   * What people call the thing when they are not reading the label. Rotation
   * tracks are what everyone means by mesocyclone, and nobody types
   * "reflectivity" when they are looking for the radar.
   */
  keywords: string[];
  action: CommandAction;
}

/** Every layer, with the words people reach for instead of its label. */
const LAYER_COMMANDS: Array<{
  layer: keyof LayerSettings;
  label: string;
  keywords: string[];
}> = [
  {
    layer: "weatherAlerts",
    label: "Weather Alerts",
    keywords: ["warning", "watch", "tornado", "severe", "nws", "polygon"],
  },
  {
    layer: "earthquakes",
    label: "Earthquakes",
    keywords: ["quake", "seismic", "usgs", "magnitude"],
  },
  {
    layer: "wildfires",
    label: "Wildfires",
    keywords: ["fire", "burn", "perimeter", "nifc", "smoke"],
  },
  {
    layer: "tropical",
    label: "Tropical",
    keywords: ["hurricane", "cyclone", "cone", "nhc", "storm", "typhoon"],
  },
  {
    layer: "satellite",
    label: "Satellite",
    keywords: ["goes", "geocolor", "cloud", "imagery", "visible", "infrared"],
  },
  {
    layer: "rotationTracks",
    label: "Rotation Tracks",
    keywords: [
      "meso",
      "mesocyclone",
      "shear",
      "azimuthal",
      "couplet",
      "tornado",
      "spin",
    ],
  },
  {
    layer: "hail",
    label: "Hail Size",
    keywords: ["mesh", "hail", "stones", "size", "severe"],
  },
  {
    layer: "lightningDensity",
    label: "Lightning Density",
    keywords: ["lightning", "strike", "cloud to ground", "cg", "nldn", "flash"],
  },
  {
    layer: "lightningFlashes",
    label: "Lightning Flashes",
    keywords: ["lightning", "glm", "flash", "total", "satellite", "strike"],
  },
  {
    layer: "customOverlay",
    label: "Custom Overlay",
    keywords: ["geojson", "placefile", "import", "upload", "shapes"],
  },
];

const SURFACE_COMMANDS: Array<{
  surface: string;
  label: string;
  keywords: string[];
}> = [
  {
    surface: "search",
    label: "Search",
    keywords: ["place", "city", "find", "go to"],
  },
  {
    surface: "alerts",
    label: "Alerts",
    keywords: ["warning", "watch", "list"],
  },
  {
    surface: "tropical",
    label: "Tropical panel",
    keywords: ["hurricane", "storm", "advisory", "cone"],
  },
  {
    surface: "history",
    label: "Storm history",
    keywords: ["hurdat", "past", "archive", "replay", "track", "ace"],
  },
  {
    surface: "route",
    label: "Route",
    keywords: ["drive", "trip", "journey", "rain along"],
  },
  {
    surface: "forecast",
    label: "Forecast",
    keywords: ["weather", "hourly", "temperature", "rain"],
  },
  {
    surface: "export",
    label: "Export",
    keywords: ["save", "picture", "video", "share", "png", "webm"],
  },
  {
    surface: "upload",
    label: "Upload",
    keywords: ["import", "geojson", "placefile", "palette", "pal", "colour"],
  },
  {
    surface: "layers",
    label: "Layers",
    keywords: ["overlay", "switches", "show", "hide"],
  },
  {
    surface: "map-type",
    label: "Map Type",
    keywords: ["basemap", "style", "theme", "terrain"],
  },
  {
    surface: "settings",
    label: "Settings",
    keywords: ["options", "preferences", "configure"],
  },
  {
    surface: "more",
    label: "Diagnostics",
    keywords: ["status", "health", "log", "version", "update", "sources"],
  },
];

const TOOL_COMMANDS: Array<{
  tool: string;
  label: string;
  keywords: string[];
}> = [
  {
    tool: "draw",
    label: "Draw",
    keywords: ["measure", "path", "line", "distance"],
  },
  {
    tool: "range",
    label: "Range",
    keywords: ["distance", "measure", "how far", "miles"],
  },
  {
    tool: "inspect",
    label: "Inspector",
    keywords: ["value", "point", "query", "what is"],
  },
];

/** Everything the palette can do, built from the same registries the panels use. */
export function allCommands(): Command[] {
  return [
    ...LAYER_COMMANDS.map((entry): Command => ({
      id: `layer:${entry.layer}`,
      label: entry.label,
      group: "Layer",
      keywords: entry.keywords,
      action: { kind: "layer", layer: entry.layer },
    })),
    ...LEVEL2_PRODUCTS.map((product): Command => ({
      id: `product:${product.id}`,
      label: product.label,
      group: "Radar product",
      keywords: [
        product.unit,
        "level 2",
        "single site",
        "nexrad",
        ...(product.id === "reflectivity" ? ["radar", "rain", "dbz"] : []),
        ...(product.id === "velocity" ? ["doppler", "wind", "rotation"] : []),
        ...(product.id === "correlation-coefficient"
          ? ["cc", "debris", "rhohv"]
          : []),
        ...(product.id === "differential-reflectivity" ? ["zdr"] : []),
        ...(product.id === "spectrum-width" ? ["sw", "turbulence"] : []),
      ].filter(Boolean),
      action: { kind: "product", product: product.id },
    })),
    ...MAP_STYLE_OPTIONS.map((style): Command => ({
      id: `style:${style.id}`,
      label: style.label,
      group: "Map type",
      keywords: ["basemap", "style", "theme"],
      action: { kind: "style", style: style.id },
    })),
    ...SURFACE_COMMANDS.map((entry): Command => ({
      id: `surface:${entry.surface}`,
      label: entry.label,
      group: "Panel",
      keywords: entry.keywords,
      action: { kind: "surface", surface: entry.surface },
    })),
    ...TOOL_COMMANDS.map((entry): Command => ({
      id: `tool:${entry.tool}`,
      label: entry.label,
      group: "Tool",
      keywords: entry.keywords,
      action: { kind: "tool", tool: entry.tool },
    })),
  ];
}

/**
 * Matches on the label first, then on what people actually call the thing. An
 * empty query offers everything, which is the point of a list you can browse.
 */
export function searchCommands(commands: Command[], query: string): Command[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return commands;
  const words = trimmed.split(/\s+/);

  return commands
    .map((command) => ({ command, rank: rank(command, words) }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .map((entry) => entry.command);
}

function rank(command: Command, words: string[]): number {
  const label = command.label.toLowerCase();
  const keywords = command.keywords.map((word) => word.toLowerCase());

  let total = 0;
  for (const word of words) {
    if (label.startsWith(word)) {
      total += 4;
    } else if (label.includes(word)) {
      total += 3;
    } else if (keywords.some((keyword) => keyword.startsWith(word))) {
      total += 2;
    } else if (keywords.some((keyword) => keyword.includes(word))) {
      total += 1;
    } else {
      // Every word has to land somewhere, or the match is not a match.
      return 0;
    }
  }
  return total;
}

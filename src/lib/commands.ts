import { MAP_STYLE_OPTIONS } from "./mapStyles";
import { LEVEL2_PRODUCTS } from "./level2";
import type { LayerSettings, MapStyleId } from "./settings";
import { translate, type LanguageId, type StringKey } from "../i18n";

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
  key: StringKey;
  /** Words to search by in the current language, beyond the English ones. */
  extra: StringKey;
  keywords: string[];
}> = [
  {
    layer: "weatherAlerts",
    key: "layer.weatherAlerts",
    extra: "keywords.weatherAlerts",
    keywords: ["warning", "watch", "tornado", "severe", "nws", "polygon"],
  },
  {
    layer: "spcOutlooks",
    key: "layer.spcOutlooks",
    extra: "keywords.spcOutlooks",
    keywords: ["spc", "outlook", "risk", "slight", "enhanced", "moderate"],
  },
  {
    layer: "spcDiscussions",
    key: "layer.spcDiscussions",
    extra: "keywords.spcDiscussions",
    keywords: ["md", "mesoscale", "discussion", "spc"],
  },
  {
    layer: "stormReports",
    key: "layer.stormReports",
    extra: "keywords.stormReports",
    keywords: ["lsr", "report", "hail", "damage", "spotter", "ground truth"],
  },
  {
    layer: "earthquakes",
    key: "layer.earthquakes",
    extra: "keywords.earthquakes",
    keywords: ["quake", "seismic", "usgs", "magnitude"],
  },
  {
    layer: "wildfires",
    key: "layer.wildfires",
    extra: "keywords.wildfires",
    keywords: ["fire", "burn", "perimeter", "nifc", "smoke"],
  },
  {
    layer: "tropical",
    key: "layer.tropical",
    extra: "keywords.tropical",
    keywords: ["hurricane", "cyclone", "cone", "nhc", "storm", "typhoon"],
  },
  {
    layer: "satellite",
    key: "layer.satellite",
    extra: "keywords.satellite",
    keywords: ["goes", "geocolor", "cloud", "imagery", "visible", "infrared"],
  },
  {
    layer: "rotationTracks",
    key: "layer.rotationTracks",
    extra: "keywords.rotationTracks",
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
    key: "layer.hail",
    extra: "keywords.hail",
    keywords: ["mesh", "hail", "stones", "size", "severe"],
  },
  {
    layer: "hailSwath",
    key: "layer.hailSwath",
    extra: "keywords.hailSwath",
    keywords: ["swath", "hail", "track", "yesterday", "past day"],
  },
  {
    layer: "echoTops",
    key: "layer.echoTops",
    extra: "keywords.echoTops",
    keywords: ["tops", "echo", "height", "eet", "updraft"],
  },
  {
    layer: "vil",
    key: "layer.vil",
    extra: "keywords.vil",
    keywords: ["vil", "liquid", "water", "column", "integrated"],
  },
  {
    layer: "precipRate",
    key: "layer.precipRate",
    extra: "keywords.precipRate",
    keywords: ["rate", "rain", "intensity", "how hard"],
  },
  {
    layer: "qpeHour",
    key: "layer.qpeHour",
    extra: "keywords.qpeHour",
    keywords: ["qpe", "accumulation", "hour", "how much"],
  },
  {
    layer: "qpeDay",
    key: "layer.qpeDay",
    extra: "keywords.qpeDay",
    keywords: ["qpe", "accumulation", "day", "24", "how much"],
  },
  {
    layer: "lightningDensity",
    key: "layer.lightningDensity",
    extra: "keywords.lightningDensity",
    keywords: ["lightning", "strike", "cloud to ground", "cg", "nldn", "flash"],
  },
  {
    layer: "lightningFlashes",
    key: "layer.lightningFlashes",
    extra: "keywords.lightningFlashes",
    keywords: ["lightning", "glm", "flash", "total", "satellite", "strike"],
  },
  {
    layer: "surge",
    key: "layer.surge",
    extra: "keywords.surge",
    keywords: ["surge", "flood", "inundation", "coast", "water", "hurricane"],
  },
  {
    layer: "customOverlay",
    key: "layer.customOverlay",
    extra: "keywords.customOverlay",
    keywords: ["geojson", "placefile", "import", "upload", "shapes"],
  },
];

const SURFACE_COMMANDS: Array<{
  surface: string;
  key: StringKey;
  extra: StringKey;
  keywords: string[];
}> = [
  {
    surface: "search",
    key: "panel.search",
    extra: "keywords.search",
    keywords: ["place", "city", "find", "go to"],
  },
  {
    surface: "alerts",
    key: "panel.alerts",
    extra: "keywords.alerts",
    keywords: ["warning", "watch", "list"],
  },
  {
    surface: "tropical",
    key: "panel.tropical",
    extra: "keywords.tropicalPanel",
    keywords: ["hurricane", "storm", "advisory", "cone"],
  },
  {
    surface: "history",
    key: "panel.history",
    extra: "keywords.history",
    keywords: ["hurdat", "past", "archive", "replay", "track", "ace"],
  },
  {
    surface: "route",
    key: "panel.route",
    extra: "keywords.route",
    keywords: ["drive", "trip", "journey", "rain along"],
  },
  {
    surface: "forecast",
    key: "panel.forecast",
    extra: "keywords.forecast",
    keywords: ["weather", "hourly", "temperature", "rain"],
  },
  {
    surface: "guidance",
    key: "panel.guidance",
    extra: "keywords.guidance",
    keywords: ["model", "ensemble", "compare", "gfs", "ecmwf", "icon"],
  },
  {
    surface: "tides",
    key: "panel.tides",
    extra: "keywords.tides",
    keywords: ["tide", "high water", "low water", "coast", "noaa"],
  },
  {
    surface: "export",
    key: "panel.export",
    extra: "keywords.export",
    keywords: ["save", "picture", "video", "share", "png", "webm"],
  },
  {
    surface: "upload",
    key: "panel.upload",
    extra: "keywords.upload",
    keywords: ["import", "geojson", "placefile", "palette", "pal", "colour"],
  },
  {
    surface: "layers",
    key: "panel.layers",
    extra: "keywords.layers",
    keywords: ["overlay", "switches", "show", "hide"],
  },
  {
    surface: "map-type",
    key: "panel.mapType",
    extra: "keywords.mapType",
    keywords: ["basemap", "style", "theme", "terrain"],
  },
  {
    surface: "settings",
    key: "panel.settings",
    extra: "keywords.settings",
    keywords: ["options", "preferences", "configure"],
  },
  {
    surface: "more",
    key: "panel.more",
    extra: "keywords.more",
    keywords: ["status", "health", "log", "version", "update", "sources"],
  },
];

const TOOL_COMMANDS: Array<{
  tool: string;
  key: StringKey;
  extra: StringKey;
  keywords: string[];
}> = [
  {
    tool: "draw",
    key: "tool.draw",
    extra: "keywords.draw",
    keywords: ["measure", "path", "line", "distance"],
  },
  {
    tool: "range",
    key: "tool.range",
    extra: "keywords.range",
    keywords: ["distance", "measure", "how far", "miles"],
  },
  {
    tool: "inspect",
    key: "tool.inspect",
    extra: "keywords.inspect",
    keywords: ["value", "point", "query", "what is"],
  },
];

/**
 * The words a command answers to, in English and in the current language.
 *
 * The English terms stay whatever the language is: someone reading a Spanish
 * window may still type "mesh", and losing that would make the list worse
 * rather than better.
 */
function searchTerms(
  english: string[],
  extra: StringKey,
  which?: LanguageId,
): string[] {
  const translated = translate(extra, undefined, which)
    .split(/\s+/)
    .filter(Boolean);
  return [...english, ...translated];
}

/** The Spanish words for a Level II product, added to its English ones. */
function productTerms(id: string, which?: LanguageId): string[] {
  const key: StringKey | null =
    id === "reflectivity"
      ? "keywords.reflectivity"
      : id === "velocity"
        ? "keywords.velocity"
        : id === "spectrum-width"
          ? "keywords.spectrumWidth"
          : id === "differential-reflectivity"
            ? "keywords.differential"
            : id === "correlation-coefficient"
              ? "keywords.correlation"
              : null;
  return key
    ? translate(key, undefined, which).split(/\s+/).filter(Boolean)
    : [];
}

/**
 * Everything the palette can do, built from the same registries the panels use.
 *
 * The language is a parameter rather than read from the store, because the
 * list is memoised by its caller and a hidden read would leave yesterday's
 * words in it after a switch.
 */
export function allCommands(which?: LanguageId): Command[] {
  return [
    ...LAYER_COMMANDS.map((entry): Command => ({
      id: `layer:${entry.layer}`,
      label: translate(entry.key, undefined, which),
      group: translate("command.group.layer", undefined, which),
      keywords: searchTerms(entry.keywords, entry.extra, which),
      action: { kind: "layer", layer: entry.layer },
    })),
    ...LEVEL2_PRODUCTS.map((product): Command => ({
      id: `product:${product.id}`,
      label: translate(product.key, undefined, which),
      group: translate("command.group.product", undefined, which),
      keywords: [
        ...productTerms(product.id, which),
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
      label: translate(style.key, undefined, which),
      group: translate("command.group.style", undefined, which),
      keywords: searchTerms(
        ["basemap", "style", "theme"],
        "keywords.mapType",
        which,
      ),
      action: { kind: "style", style: style.id },
    })),
    ...SURFACE_COMMANDS.map((entry): Command => ({
      id: `surface:${entry.surface}`,
      label: translate(entry.key, undefined, which),
      group: translate("command.group.panel", undefined, which),
      keywords: searchTerms(entry.keywords, entry.extra, which),
      action: { kind: "surface", surface: entry.surface },
    })),
    ...TOOL_COMMANDS.map((entry): Command => ({
      id: `tool:${entry.tool}`,
      label: translate(entry.key, undefined, which),
      group: translate("command.group.tool", undefined, which),
      keywords: searchTerms(entry.keywords, entry.extra, which),
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

import { MAP_STYLE_OPTIONS } from "./mapStyles";
import { LEVEL2_PRODUCTS } from "./level2";
import type { LayerSettings, MapStyleId } from "./settings";
import { translate, type LanguageId, type StringKey } from "../i18n";

export type CommandAction =
  | { kind: "layer"; layer: keyof LayerSettings }
  | { kind: "style"; style: MapStyleId }
  | { kind: "product"; product: string }
  | { kind: "surface"; surface: string; find?: boolean }
  | { kind: "tool"; tool: string }
  | { kind: "capture" }
  | { kind: "ambientScreen" }
  | { kind: "home" };

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
    layer: "stormCells",
    key: "layer.stormCells",
    extra: "keywords.stormCells",
    keywords: ["cell", "track", "motion", "arrival", "radar"],
  },
  {
    layer: "classification",
    key: "layer.classification",
    extra: "keywords.classification",
    keywords: ["hydrometeor", "hail", "snow", "rain", "dual-pol", "hca"],
  },
  {
    layer: "probSevere",
    key: "layer.probSevere",
    extra: "keywords.probSevere",
    keywords: ["probsevere", "probability", "hail", "wind", "tornado"],
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
    keywords: ["fire", "burn", "perimeter", "nifc"],
  },
  {
    layer: "smoke",
    key: "layer.smoke",
    extra: "keywords.smoke",
    keywords: ["haze", "air quality", "plume", "hms", "wildfire smoke"],
  },
  {
    layer: "forecastSmoke",
    key: "layer.forecastSmoke",
    extra: "keywords.forecastSmoke",
    keywords: ["hrrr", "model", "plume", "forecast", "air quality"],
  },
  {
    layer: "metar",
    key: "layer.metar",
    extra: "keywords.metar",
    keywords: ["metar", "station", "airport", "dewpoint", "wind barb"],
  },
  {
    layer: "riverGauges",
    key: "layer.riverGauges",
    extra: "keywords.riverGauges",
    keywords: ["river", "flood", "gauge", "stage", "crest", "water"],
  },
  {
    layer: "aviation",
    key: "layer.aviation",
    extra: "keywords.aviation",
    keywords: ["aviation", "sigmet", "airmet", "pirep", "turbulence", "icing"],
  },
  {
    layer: "buoys",
    key: "layer.buoys",
    extra: "keywords.buoys",
    keywords: ["buoy", "wave", "swell", "marine", "sea", "ndbc", "offshore"],
  },
  {
    layer: "cocorahs",
    key: "layer.cocorahs",
    extra: "keywords.cocorahs",
    keywords: ["rain", "gauge", "hail", "volunteer", "cocorahs", "observer"],
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
    layer: "wpcExcessiveRain",
    key: "layer.wpcExcessiveRain",
    extra: "keywords.wpcExcessiveRain",
    keywords: ["ero", "flash flood", "rainfall", "excessive", "wpc"],
  },
  {
    layer: "wpcWinterSeverity",
    key: "layer.wpcWinterSeverity",
    extra: "keywords.wpcWinterSeverity",
    keywords: ["wssi", "winter", "severity", "impact", "wpc"],
  },
  {
    layer: "azShear",
    key: "layer.azShear",
    extra: "keywords.azShear",
    keywords: ["azshear", "shear", "meso", "rotation", "couplet", "llsd"],
  },
  {
    layer: "hail",
    key: "layer.hail",
    extra: "keywords.hail",
    keywords: ["mesh", "hail", "stones", "size", "severe"],
  },
  {
    layer: "posh",
    key: "layer.posh",
    extra: "keywords.posh",
    keywords: ["posh", "hail", "probability", "chance", "severe"],
  },
  {
    layer: "shi",
    key: "layer.shi",
    extra: "keywords.shi",
    keywords: ["shi", "hail", "index", "energy", "witt"],
  },
  {
    layer: "vilDensity",
    key: "layer.vilDensity",
    extra: "keywords.vilDensity",
    keywords: ["vild", "density", "vil", "liquid", "hail"],
  },
  {
    layer: "vii",
    key: "layer.vii",
    extra: "keywords.vii",
    keywords: ["vii", "ice", "integrated", "frozen", "hail"],
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
    layer: "counties",
    key: "layer.counties",
    extra: "keywords.counties",
    keywords: ["county", "counties", "state", "borders", "boundaries"],
  },
  {
    layer: "night",
    key: "layer.night",
    extra: "keywords.night",
    keywords: ["night", "day", "dark", "sun", "terminator", "twilight"],
  },
  {
    layer: "gaugeQpe",
    key: "layer.gaugeQpe",
    extra: "keywords.gaugeQpe",
    keywords: ["qpe", "gauge", "corrected", "accumulation", "how much"],
  },
  {
    layer: "ffgHour",
    key: "layer.ffgHour",
    extra: "keywords.ffgHour",
    keywords: ["flash", "flood", "guidance", "ffg", "hour", "ratio"],
  },
  {
    layer: "ffgThreeHour",
    key: "layer.ffgThreeHour",
    extra: "keywords.ffgThreeHour",
    keywords: ["flash", "flood", "guidance", "ffg", "three", "ratio"],
  },
  {
    layer: "unitStreamflow",
    key: "layer.unitStreamflow",
    extra: "keywords.unitStreamflow",
    keywords: ["flood", "runoff", "streamflow", "flash", "water"],
  },
  {
    layer: "precipType",
    key: "layer.precipType",
    extra: "keywords.precipType",
    keywords: ["snow", "sleet", "freezing", "rain", "type", "winter"],
  },
  {
    layer: "snowfall",
    key: "layer.snowfall",
    extra: "keywords.snowfall",
    keywords: ["snow", "snowfall", "accumulation", "total", "depth", "winter"],
  },
  {
    layer: "lightningDensity",
    key: "layer.lightningDensity",
    extra: "keywords.lightningDensity",
    keywords: ["lightning", "strike", "cloud to ground", "cg", "nldn", "flash"],
  },
  {
    layer: "lightningForecast",
    key: "layer.lightningForecast",
    extra: "keywords.lightningForecast",
    keywords: ["lightning", "probability", "chance", "forecast", "next"],
  },
  {
    layer: "lightningJump",
    key: "layer.lightningJump",
    extra: "keywords.lightningJump",
    keywords: ["lightning", "jump", "surge", "sigma", "rate", "increase"],
  },
  {
    layer: "isothermReflectivity",
    key: "layer.isothermReflectivity",
    extra: "keywords.isothermReflectivity",
    keywords: ["reflectivity", "isothermal", "ice", "freezing", "dbz", "cold"],
  },
  {
    layer: "cappi",
    key: "layer.cappi",
    extra: "keywords.cappi",
    keywords: ["cappi", "height", "level", "merged", "cube", "correlation"],
  },
  {
    layer: "lightningFlashes",
    key: "layer.lightningFlashes",
    extra: "keywords.lightningFlashes",
    keywords: ["lightning", "glm", "flash", "total", "satellite", "strike"],
  },
  {
    layer: "wind",
    key: "layers.wind",
    extra: "keywords.windLayer",
    keywords: ["wind", "gfs", "particles", "speed", "direction"],
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

/**
 * What a surface is called and how much room it takes, for the frame drawn
 * while the module that draws it is still arriving.
 *
 * The panels all live behind a `lazy`, including the module holding the lot
 * of them, so the frame cannot ask the panel either question. Both answers
 * are copied out of the panel component, and `surfaceFrames.test.ts` reads
 * them back out of those same files on every run: a stand-in fifty pixels
 * narrower than the panel it stands in for moves the map chrome twice, which
 * is the jump the stand-in exists to prevent.
 *
 * Keyed on more surfaces than `SURFACE_COMMANDS` holds, and on the panel's
 * own title rather than that table's label. The palette cannot offer itself
 * and the cross-section panel is opened by a tool rather than by a command,
 * so both were missing and both got named after the radar products; and a
 * command is named for the reader looking for it, which is not always what
 * the panel calls itself once it is open.
 */
export const SURFACE_FRAMES: Record<
  string,
  { key: StringKey; className: string }
> = {
  search: { key: "search.title", className: "surface-panel--left" },
  alerts: { key: "alerts.title", className: "surface-panel--right" },
  nearby: { key: "nearby.title", className: "surface-panel--right" },
  tropical: { key: "tropical.title", className: "surface-panel--right" },
  history: { key: "history.title", className: "surface-panel--right" },
  commands: { key: "palette.title", className: "surface-panel--left" },
  route: {
    key: "route.title",
    className: "surface-panel--right surface-panel--settings",
  },
  guidance: {
    key: "guidance.title",
    className: "surface-panel--right surface-panel--settings",
  },
  sounding: {
    key: "sounding.title",
    className: "surface-panel--right surface-panel--wide",
  },
  vwp: { key: "vwp.title", className: "surface-panel--right" },
  tides: { key: "tides.title", className: "surface-panel--right" },
  "map-type": {
    key: "mapType.title",
    className: "surface-panel--left surface-panel--wide",
  },
  layers: { key: "layers.title", className: "surface-panel--left" },
  export: { key: "export.title", className: "surface-panel--right" },
  upload: { key: "upload.title", className: "surface-panel--right" },
  forecast: { key: "forecast.title", className: "surface-panel--right" },
  settings: {
    key: "settings.title",
    className: "surface-panel--right surface-panel--settings",
  },
  more: { key: "diagnostics.title", className: "surface-panel--right" },
  section: { key: "section.title", className: "surface-panel--right" },
  // Not a `SurfaceId`. The product panel is opened by a switch of its own and
  // can be on screen beside a surface, but it shares the one lazy module, so
  // the frame has to be able to name it too.
  "radar-product": { key: "radar.title", className: "surface-panel--product" },
};

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
    surface: "nearby",
    key: "panel.nearby",
    extra: "keywords.nearby",
    keywords: ["accessible", "screen reader", "text", "distance", "bearing"],
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
    surface: "vwp",
    key: "panel.vwp",
    extra: "keywords.vwp",
    keywords: ["vad", "vwp", "wind profile", "barbs", "shear", "hodograph"],
  },
  {
    surface: "sounding",
    key: "panel.sounding",
    extra: "keywords.sounding",
    keywords: [
      "skew-t",
      "skewt",
      "hodograph",
      "raob",
      "cape",
      "shear",
      "upper air",
    ],
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
    surface: "radar-product",
    key: "panel.radarProducts",
    extra: "keywords.radarProducts",
    keywords: ["radar", "product", "composite", "level 2", "mosaic"],
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
    {
      // The layers panel holds forty-six switches under seven headings, and
      // this is the way in for somebody who knows the word and not the
      // heading. It opens the panel with the box already under the cursor,
      // which is the whole difference between it and the panel command
      // above.
      id: "find-layer",
      label: translate("layers.find", undefined, which),
      group: translate("command.group.panel", undefined, which),
      keywords: searchTerms(
        ["filter", "search", "find", "layer"],
        "keywords.findLayer",
        which,
      ),
      action: { kind: "surface", surface: "layers", find: true },
    },
    {
      // One action back to the place the reader watches, from anywhere,
      // including the far side of the globe.
      id: "home",
      label: translate("watch.goHome", undefined, which),
      group: translate("command.group.layout", undefined, which),
      keywords: searchTerms(
        ["home", "back", "my place", "watched"],
        "keywords.home",
        which,
      ),
      action: { kind: "home" },
    },
    {
      id: "capture",
      label: translate("capture.title", undefined, which),
      group: translate("command.group.layout", undefined, which),
      keywords: searchTerms(
        ["obs", "stream", "streaming", "broadcast", "capture", "clean"],
        "keywords.capture",
        which,
      ),
      action: { kind: "capture" },
    },
    {
      id: "ambient-screen",
      label: translate("command.ambientScreen", undefined, which),
      group: translate("command.group.layout", undefined, which),
      keywords: searchTerms(
        ["ambient", "second monitor", "screen", "fullscreen", "kiosk", "wall"],
        "keywords.ambientScreen",
        which,
      ),
      action: { kind: "ambientScreen" },
    },
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
 * A word as somebody typing in a hurry writes it.
 *
 * Lowercased and stripped of its accents. Every French and Spanish label the
 * palette offers carries at least one, and nobody reaching for the command
 * bar stops to hold a dead key: a reader looking for Prévisions types
 * "prevision", and before this that missed the label entirely and only landed
 * because the catalogue carried an unaccented copy of the same word beside
 * it. Decomposing first is what separates the accent from the letter, so this
 * is one normalise and one replace rather than a table.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Matches on the label first, then on what people actually call the thing. An
 * empty query offers everything, which is the point of a list you can browse.
 */
export function searchCommands(commands: Command[], query: string): Command[] {
  const trimmed = query.trim();
  if (!trimmed) return commands;
  const words = fold(trimmed).split(/\s+/);

  return commands
    .map((command) => ({
      command,
      rank: rank(command.label, command.keywords, words),
    }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .map((entry) => entry.command);
}

/**
 * Whether a label and the words beside it answer what somebody typed.
 *
 * The same rule the palette ranks by, asked as a yes or no. A settings list
 * is already in the order its reader learned it, so filtering it must not
 * reorder it, and an empty box hides nothing.
 */
export function answersQuery(
  label: string,
  beside: readonly string[],
  query: string,
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return rank(label, beside, fold(trimmed).split(/\s+/)) > 0;
}

function rank(
  name: string,
  beside: readonly string[],
  words: string[],
): number {
  const label = fold(name);
  const keywords = beside.map(fold);

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

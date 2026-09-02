import {
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { formatNumber, translate } from "../../i18n";
import { formatClock } from "../units";

/**
 * River gauges, for the hazard radar cannot see.
 *
 * Rain on the radar is not the flood. The flood is what the river does with
 * it hours later and tens of miles downstream, and in a tropical system or a
 * training line that is the part that hurts people. The National Water
 * Prediction Service publishes every forecast point in the country: what the
 * gauge reads now, what the office expects it to reach, and the stages at
 * which that river floods.
 *
 * This is deliberately a thin incident layer rather than a hydrology
 * workstation. It answers one question, which is whether the water near the
 * storm on screen is rising into trouble, and it links out to the official
 * page for everything else.
 *
 * NWPS answers with sentinels rather than absences: -999 for a value it does
 * not have, -9999 for a threshold, a zero year for a time, and a category of
 * `not_defined` for a gauge with no flood stages at all. Every one of those
 * has to be read as nothing, because drawing -999 feet of water on a map is
 * worse than drawing no gauge.
 */

const HOST = "api.water.noaa.gov";
const SERVICE = `https://${HOST}/nwps/v1/gauges`;

/** The official page for one gauge, which the panel links to. */
export function gaugeUrl(lid: string): string {
  return `https://water.noaa.gov/gauges/${encodeURIComponent(lid)}`;
}

/**
 * Below this the country's gauges are a smear of dots nobody can read, and
 * the box is most of a continent.
 */
export const GAUGE_MIN_ZOOM = 7;

/**
 * How bad it is, worst first, which is also how the map ranks them.
 *
 * `unknown` is last and is not a state of the river: it is the service
 * declining to say. Most of the gauges in a typical box are that, because
 * they have no flood stages defined at all, and calling them "below flood
 * stage" would be telling a reader something nobody knows.
 */
export const FLOOD_CATEGORIES = [
  "major",
  "moderate",
  "minor",
  "action",
  "none",
  "unknown",
] as const;

export type FloodCategory = (typeof FLOOD_CATEGORIES)[number];

/**
 * Colour per category. Blue for a river behaving, warm for one that is not,
 * grey for one nobody has said anything about.
 */
export const FLOOD_COLOR: Record<FloodCategory, string> = {
  major: "#c026d3",
  moderate: "#ef4444",
  minor: "#f59e0b",
  action: "#facc15",
  none: "#38bdf8",
  unknown: "#94a3b8",
};

/** The service's own words for a category, and what this layer calls them. */
function categoryOf(value: unknown): FloodCategory | null {
  switch (String(value)) {
    case "major":
      return "major";
    case "moderate":
      return "moderate";
    case "minor":
      return "minor";
    case "action":
      return "action";
    case "no_flooding":
      return "none";
    // `not_defined` is a gauge with no flood stages, and the three `not_current`
    // and `out_of_service` cases are a gauge that is not reporting. None of
    // them is a state of the river, so none of them gets a colour.
    default:
      return null;
  }
}

/** A number the service means, rather than one of its sentinels. */
function reading(value: unknown): number | null {
  // `Number(null)`, `Number("")` and `Number(false)` are all 0, which is a
  // perfectly good river stage and would be drawn as one. A field the service
  // starts sending as null has to read as nothing, not as a gauge at zero.
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // -999 for a stage, -9999 for a threshold; both are "no value" and both
  // are far outside any river's range.
  return number <= -900 ? null : number;
}

/** A time the service means, rather than its zero year. */
function moment(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  // The service writes `0001-01-01T00:00:00Z` for "there isn't one".
  return at < Date.parse("1970-01-01T00:00:00Z") ? null : at;
}

interface GaugeStatus {
  primary?: unknown;
  primaryUnit?: unknown;
  secondary?: unknown;
  secondaryUnit?: unknown;
  floodCategory?: unknown;
  validTime?: unknown;
}

/**
 * The gauges in one answer, as points.
 *
 * A gauge with no position, or with nothing to say in either direction, is
 * dropped: a dot that reads "unknown" in a panel nobody opened is noise on a
 * map that is already busy.
 */
export function parseGauges(payload: unknown): OverlayData {
  const raw = payload as { gauges?: unknown };
  const rows = Array.isArray(raw?.gauges) ? raw.gauges : [];
  const parsed: OverlayFeature[] = [];

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      lid?: unknown;
      name?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      status?: { observed?: GaugeStatus; forecast?: GaugeStatus };
      wfo?: { abbreviation?: unknown };
    };
    const lid = typeof row.lid === "string" ? row.lid : "";
    const lon = Number(row.longitude);
    const lat = Number(row.latitude);
    if (!lid || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon === 0 && lat === 0) continue;

    const observed = row.status?.observed ?? {};
    const forecast = row.status?.forecast ?? {};
    const stage = reading(observed.primary);
    const observedAt = moment(observed.validTime);
    const forecastStage = reading(forecast.primary);
    const forecastAt = moment(forecast.validTime);
    const observedCategory = categoryOf(observed.floodCategory);
    const forecastCategory = categoryOf(forecast.floodCategory);

    // Nothing measured and nothing forecast is a gauge with nothing to say.
    if (stage === null && forecastStage === null) continue;

    // The map is coloured by the worse of the two, because a river that is
    // fine now and major by morning is not a blue dot. Neither side saying
    // anything is `unknown` rather than `none`: most gauges have no flood
    // stages defined, and painting them the same blue as a river measured to
    // be below its own flood stage claims something nobody said.
    const worst: FloodCategory =
      observedCategory && forecastCategory
        ? FLOOD_CATEGORIES.indexOf(forecastCategory) <
          FLOOD_CATEGORIES.indexOf(observedCategory)
          ? forecastCategory
          : observedCategory
        : (forecastCategory ?? observedCategory ?? "unknown");

    parsed.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        lid,
        name: typeof row.name === "string" ? row.name : lid,
        office:
          typeof row.wfo?.abbreviation === "string" ? row.wfo.abbreviation : "",
        stage,
        stageUnit:
          typeof observed.primaryUnit === "string" ? observed.primaryUnit : "",
        observedAt,
        observedCategory,
        forecastStage,
        forecastUnit:
          typeof forecast.primaryUnit === "string" ? forecast.primaryUnit : "",
        forecastAt,
        forecastCategory,
        category: worst,
        rank: FLOOD_CATEGORIES.indexOf(worst),
        // True when the office expects this river to get worse than it is,
        // which is the one thing on this layer radar cannot tell anybody.
        rising: Boolean(
          forecastCategory &&
          observedCategory &&
          FLOOD_CATEGORIES.indexOf(forecastCategory) <
            FLOOD_CATEGORIES.indexOf(observedCategory),
        ),
        url: gaugeUrl(lid),
      },
    });
  }

  // Worst first, so the dot that matters is the one drawn on top.
  parsed.sort(
    (left, right) =>
      Number(left.properties.rank) - Number(right.properties.rank),
  );
  return { type: "FeatureCollection", features: parsed };
}

/**
 * How much of a date a time needs.
 *
 * A reading from this morning wants the clock. One from Saturday wants to say
 * Saturday, and a crest two days out wants to say which day it is two days
 * from. The cut is six hours, which is inside any gauge's own reporting
 * interval and outside anything anybody would read as "now".
 */
function clockOptions(at: number): Intl.DateTimeFormatOptions {
  const near = Math.abs(Date.now() - at) < 6 * 3_600_000;
  return near
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
}

function stageLine(value: unknown, unit: unknown): string {
  const number = Number(value);
  const suffix = typeof unit === "string" && unit ? ` ${unit}` : "";
  return `${formatNumber(number, 2)}${suffix}`;
}

export const riverGaugesOverlay: OverlayAdapter = {
  id: "riverGauges",
  label: "River gauges",
  attribution:
    '<a href="https://water.noaa.gov/">NOAA National Water Prediction Service</a>',
  attributionUrl: "https://water.noaa.gov/",
  host: HOST,
  // The service publishes on a fifteen minute cycle and sends no cache
  // headers of its own, so the app's own interval is the whole of the
  // politeness here. Ten minutes catches a new cycle without asking twice
  // for the same one.
  refreshMs: 10 * 60_000,
  minZoom: GAUGE_MIN_ZOOM,
  // The service answers per gauge rather than per area and does not thin its
  // answer, so a little padding is cheap and saves a request on a short pan.
  boundsPadding: 0.25,
  fetchData: async (bounds: OverlayBounds, signal) => {
    const query = new URLSearchParams({
      // Without this the service reads the box as web mercator metres and
      // answers with nothing at all, which is not an error anywhere.
      srid: "EPSG_4326",
      "bbox.xmin": bounds.west.toFixed(4),
      "bbox.ymin": bounds.south.toFixed(4),
      "bbox.xmax": bounds.east.toFixed(4),
      "bbox.ymax": bounds.north.toFixed(4),
    });
    const response = await fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        translate("rivers.failed", { status: String(response.status) }),
      );
    }
    return parseGauges(await response.json());
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          GAUGE_MIN_ZOOM,
          4,
          11,
          7,
        ],
        "circle-color": [
          "match",
          ["get", "category"],
          "major",
          FLOOD_COLOR.major,
          "moderate",
          FLOOD_COLOR.moderate,
          "minor",
          FLOOD_COLOR.minor,
          "action",
          FLOOD_COLOR.action,
          "none",
          FLOOD_COLOR.none,
          // A gauge the service says nothing about is grey rather than the
          // blue of one measured to be below its own flood stage.
          FLOOD_COLOR.unknown,
        ],
        "circle-stroke-width": 1.5,
        // A ring in the forecast's own colour on a river the office expects
        // to rise, so measured and forecast are told apart on the map and not
        // only in the panel.
        "circle-stroke-color": [
          "case",
          ["get", "rising"],
          "#f8fafc",
          "rgba(2, 6, 23, 0.65)",
        ],
        "circle-opacity": 0.9,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const stage = properties.stage;
    if (typeof stage === "number") {
      // A gauge the service marks as not reporting can be days behind, and a
      // bare clock time on a four-day-old reading reads as this afternoon.
      // The date goes on anything older than the morning.
      const when =
        properties.observedAt === null || properties.observedAt === undefined
          ? Number.NaN
          : Number(properties.observedAt);
      lines.push(
        translate("rivers.observed", {
          stage: stageLine(stage, properties.stageUnit),
          when: Number.isFinite(when)
            ? formatClock(when, clockOptions(when))
            : translate("rivers.timeUnknown"),
        }),
      );
    } else {
      lines.push(translate("rivers.noObservation"));
    }

    const forecast = properties.forecastStage;
    if (typeof forecast === "number") {
      const when =
        properties.forecastAt === null || properties.forecastAt === undefined
          ? Number.NaN
          : Number(properties.forecastAt);
      lines.push(
        translate("rivers.forecast", {
          stage: stageLine(forecast, properties.forecastUnit),
          // A crest can be days out, so this carries its day as well as its
          // clock whenever it is not within a few hours.
          when: Number.isFinite(when)
            ? formatClock(when, clockOptions(when))
            : translate("rivers.timeUnknown"),
        }),
      );
    } else {
      lines.push(translate("rivers.noForecast"));
    }

    const category = String(properties.category);
    if (category === "unknown") {
      // The service said `not_defined`, `out_of_service` or one of the
      // `not_current` codes. None of those is a state of the river.
      lines.push(translate("rivers.categoryUnknown"));
    } else if (category === "none") {
      lines.push(translate("rivers.categoryNone"));
    } else {
      lines.push(
        translate("rivers.category", {
          category: translate(
            `rivers.flood.${category}` as "rivers.flood.minor",
          ),
        }),
      );
    }
    if (properties.rising === true) {
      lines.push(translate("rivers.rising"));
    }
    const office = String(properties.office ?? "");
    if (office) lines.push(translate("rivers.office", { office }));

    return {
      title: String(properties.name ?? properties.lid ?? ""),
      lines,
      url: String(properties.url ?? ""),
    };
  },
};

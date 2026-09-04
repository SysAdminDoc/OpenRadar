import { translate } from "../../i18n";
import { serviceAnswer } from "../serviceAnswer";
import { cachedUrl } from "../tileCache";
import { formatReportMagnitude } from "../units";
import {
  relativeTime,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";

const SERVICE = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";
const ATTRIBUTION =
  '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet storm reports</a>';

/**
 * How far back the reports go.
 *
 * A day is what a person means by "what happened", and the feed is small
 * enough at that window to fetch whole rather than by viewport: about seven
 * hundred reports across the country over two days.
 */
export const REPORT_HOURS = 24;

/**
 * The kinds a report can be drawn as, named once for both feeds.
 *
 * The archive letters them and the weather service writes them out, so the
 * two are read by different code and were free to disagree: they did, with
 * a funnel cloud drawn in the full tornado colour from one source and the
 * lighter one from the other. Named constants are what stops the next pair
 * from drifting. A funnel is aloft and a waterspout is on the water, which
 * is why one of them is the tornado colour and the other is not.
 */
const TORNADO = { kind: "tornado", color: "#f43f5e" };
const FUNNEL = { kind: "tornado", color: "#fb7185" };
const HAIL = { kind: "hail", color: "#22d3ee" };
const WIND = { kind: "wind", color: "#f59e0b" };
const FLOOD = { kind: "flood", color: "#818cf8" };
const OTHER = { kind: "other", color: "#94a3b8" };

/**
 * What a report is about, from the single letter the feed uses.
 *
 * Only the ones a radar viewer is looking for get a colour of their own. The
 * rest are real reports and are drawn, in grey, rather than dropped.
 */
const KINDS: Record<string, { kind: string; color: string }> = {
  T: TORNADO,
  H: HAIL,
  D: WIND,
  G: WIND,
  O: WIND,
  N: WIND,
  // Sustained wind and the marine reports, both of which the weather service
  // writes out as wind and this table used to leave grey, so the same report
  // was one kind or the other depending on which source answered. Read off
  // the live feed on 2026-09-04: `A` is HIGH SUST WINDS and `M` is MARINE
  // TSTM WIND.
  A: WIND,
  M: WIND,
  // Waterspout and landspout, which are both a tornado somewhere awkward.
  W: TORNADO,
  C: FUNNEL,
  F: FLOOD,
  E: FLOOD,
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reports the network has taken in, newest last.
 *
 * The feed carries a magnitude and the unit it is in, which is the difference
 * between an inch of hail and sixty miles an hour of wind, so both travel with
 * the report rather than being guessed from the type.
 */
export function parseReports(payload: unknown): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    const feature = item as {
      geometry?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    };
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!geometry || !properties) continue;
    if (geometry.type !== "Point") continue;

    const at = Date.parse(text(properties.valid));
    if (!Number.isFinite(at)) continue;

    const letter = text(properties.type).toUpperCase();
    const { kind, color } = KINDS[letter] ?? OTHER;
    // Wind damage is reported without a number, and the feed sends null for
    // it. Number(null) is 0, which would put "0 mph" on a report that never
    // claimed a speed.
    // The live feed calls it `magf` and the archive calls it `magnitude`,
    // and both send null for a report that never claimed a number: wind
    // damage is reported without a speed, and `Number(null)` is 0, which
    // would put "0 mph" on it.
    const raw = properties.magf ?? properties.magnitude;
    const magnitude =
      typeof raw === "number" && Number.isFinite(raw) ? raw : null;

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        kind,
        color,
        label: text(properties.typetext) || kind,
        city: text(properties.city),
        state: text(properties.state) || text(properties.st),
        source: text(properties.source),
        remark: text(properties.remark),
        magnitude,
        unit: text(properties.unit),
        at,
      },
    });
  }

  // Oldest first, so the newest report is the one drawn on top where two
  // land on the same spot.
  parsed.sort(
    (left, right) => Number(left.properties.at) - Number(right.properties.at),
  );
  return { type: "FeatureCollection", features: parsed };
}

/** The archive of past reports, on the host the live feed already uses. */
const ARCHIVE =
  "https://mesonet.agron.iastate.edu/api/1/nws/lsrs_by_point.geojson";

/**
 * How far around the view a replay looks for reports.
 *
 * The archive answers by point and radius rather than by box, so the box is
 * turned into the circle that covers it. Bounded, because a reader zoomed out
 * to the hemisphere is not asking for every report in it, and floored so a
 * reader zoomed into one county still gets the reports around them.
 */
export const REPLAY_RADIUS_DEGREES = { least: 1, most: 12 };

export function replayReportsUrl(
  bounds: OverlayBounds,
  window: { from: number; to: number },
): string {
  const lon = (bounds.west + bounds.east) / 2;
  const lat = (bounds.south + bounds.north) / 2;
  const across = Math.max(
    Math.abs(bounds.north - bounds.south),
    Math.abs(bounds.east - bounds.west),
  );
  const radius = Math.min(
    REPLAY_RADIUS_DEGREES.most,
    Math.max(REPLAY_RADIUS_DEGREES.least, across / 2),
  );
  const search = new URLSearchParams({
    lon: lon.toFixed(3),
    lat: lat.toFixed(3),
    // The parameter is named for its unit: there is a `radius_miles` beside
    // it, and a bare `radius` is accepted and ignored.
    radius_degrees: radius.toFixed(2),
    begints: new Date(window.from).toISOString(),
    endts: new Date(window.to).toISOString(),
  });
  return `${ARCHIVE}?${search.toString()}`;
}

/**
 * The same reports, from the weather service's own map service.
 *
 * One host for a layer means a quiet afternoon and a host that is down look
 * identical, and a reader has no way to tell which they are looking at. Two
 * chasers lost their feed mid-storm on 2026-09-03 in software that had only
 * one. This is the second answer, on a host the workspace already reads
 * warnings and outlooks from.
 *
 * A different shape, so a different parse: the type is written out rather
 * than lettered, the magnitude arrives as a string, and the time is epoch
 * milliseconds rather than a stamp.
 */
const FALLBACK =
  "https://mapservices.weather.noaa.gov/vector/rest/services/obs" +
  "/nws_local_storm_reports/MapServer/0/query";

/**
 * The service writes the type out; this is the same grouping by its words.
 *
 * It abbreviates, which is the whole difficulty. The words the two feeds
 * published on 2026-09-04 were `Tstm Wnd Gst`, `Tstm Wnd Dmg`, `Non-Tstm Wnd
 * Gst`, `Non-Tstm Wnd Dmg`, `Marine Tstm Wind`, `High Sust Winds`, `Hail`,
 * `Tornado`, `Funnel Cloud`, `Waterspout`, `Landspout`, `Flash Flood`,
 * `Flood`, `Fog`, `Rain`, `Lightning`, `Debris Flow` and `Landslide`. A match
 * on the whole word "wind" caught the marine one and let the two that make up
 * most of a severe day fall through to grey; a match that then forgot the
 * plural would have dropped the sustained-wind reports the same way.
 */
function kindOfWords(said: string): { kind: string; color: string } {
  const lower = said.toLowerCase();
  if (lower.includes("waterspout") || lower.includes("landspout")) {
    return TORNADO;
  }
  if (lower.includes("funnel")) return FUNNEL;
  if (lower.includes("tornado")) return TORNADO;
  if (lower.includes("hail")) return HAIL;
  if (/\b(wind|wnd|gust|gst)s?\b/.test(lower)) return WIND;
  if (lower.includes("flood") || lower.includes("flash")) return FLOOD;
  return OTHER;
}

/**
 * The weather service's own reports, in the shape the map already draws.
 *
 * Exported so the fallback is checkable on its own: the two feeds agree on
 * nothing but the geometry, and a field read from the wrong one is a report
 * drawn with no size on it or at the wrong hour.
 */
export function parseServiceReports(payload: unknown): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    const feature = item as {
      geometry?: Record<string, unknown>;
      properties?: Record<string, unknown>;
    };
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (!geometry || !properties) continue;
    if (geometry.type !== "Point") continue;

    // Epoch milliseconds here, not a stamp. `Date.parse` of a number is NaN,
    // so reading it the other feed's way drops every report.
    const at = properties.lsr_validtime;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;

    const said = text(properties.descript);
    const { kind, color } = kindOfWords(said);
    // A string here, and blank for a report that claimed no number, which is
    // most wind damage. `Number("")` is 0, which would put "0 mph" on it.
    const size = text(properties.magnitude);
    const magnitude = size === "" ? null : Number(size);

    parsed.push({
      type: "Feature",
      geometry,
      properties: {
        kind,
        color,
        label: said || kind,
        city: text(properties.loc_desc),
        state: text(properties.state),
        // The office that took the report, which is the nearest thing this
        // feed has to the other one's source.
        source: text(properties.wfo),
        remark: text(properties.remarks),
        magnitude:
          magnitude !== null && Number.isFinite(magnitude) ? magnitude : null,
        unit: text(properties.units),
        at,
      },
    });
  }

  parsed.sort(
    (left, right) => Number(left.properties.at) - Number(right.properties.at),
  );
  return { type: "FeatureCollection", features: parsed };
}

/** How many reports one ask of the fallback brings back. */
const SERVICE_PAGE = 500;

/**
 * How many of those a single refresh will make.
 *
 * Bounded so a service that always claims there is more cannot turn one
 * refresh into an unending run of requests. Six pages is three thousand
 * reports, against the eight hundred and fifty-four the layer held on
 * 2026-09-04, so the ceiling is for a day nobody has seen yet.
 */
const SERVICE_PAGES = 6;

/**
 * The fallback's own request, for the window the live layer covers.
 *
 * Newest first, and bounded to the same twenty-four hours the archive
 * answers for. Neither was there to begin with, and an ArcGIS layer asked
 * for nothing in particular hands back its rows in object-id order and stops
 * at the record count: measured against the live service on 2026-09-04, the
 * layer held 854 rows, the first 500 of them ended at 14:12Z, and the newest
 * report it had was 15:37Z. The hour a reader opens this layer for was the
 * hour it left out.
 */
export function serviceReportsUrl(offset = 0): string {
  // The service's own date syntax, which wants a space rather than the T and
  // no milliseconds. Its dates are UTC, which is what `toISOString` gives.
  //
  // Rounded down to the hour, so the same hour asks the same question. The
  // address is the native cache's key, and one carrying the current second
  // is a key nothing can ever hit again: every refresh would write entries
  // that are dead on arrival and push real tiles out of the budget, and the
  // offline view would have no copy of this layer to fall back to. The
  // window is then a day and up to an hour, which is the direction to err.
  const since = new Date(Date.now() - REPORT_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 13)
    .replace("T", " ");
  const search = new URLSearchParams({
    where: `lsr_validtime >= TIMESTAMP '${since}:00:00'`,
    // The time is not a total order: reports cluster on the minute, and a
    // tie split across two pages can be ordered differently by each of the
    // two requests, which drops one report and repeats another. The row id
    // breaks the tie the same way for both.
    orderByFields: "lsr_validtime DESC,objectid DESC",
    outFields:
      "objectid,descript,magnitude,units,lsr_validtime,loc_desc,state,remarks,wfo",
    returnGeometry: "true",
    geometryPrecision: "4",
    outSR: "4326",
    resultRecordCount: String(SERVICE_PAGE),
    resultOffset: String(offset),
    f: "geojson",
  });
  return `${FALLBACK}?${search.toString()}`;
}

export const stormReportsOverlay: OverlayAdapter = {
  id: "stormReports",
  label: "Storm reports",
  attribution: ATTRIBUTION,
  attributionUrl: "https://mesonet.agron.iastate.edu/",
  host: "mesonet.agron.iastate.edu",
  // A whole day of reports for the whole country, which is small enough that
  // panning does not need to ask again.
  global: true,
  refreshMs: 5 * 60_000,
  // A replay asks for the reports of that afternoon, once, rather than
  // today's over somebody else's day.
  variant: (choices) =>
    choices.replay ? `replay:${choices.replay.from}` : "live",
  fetchData: async (bounds, signal, choices) => {
    if (choices.replay) {
      const response = await fetch(
        cachedUrl(replayReportsUrl(bounds, choices.replay)),
        { signal, headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(
          translate("reports.serviceStatus", {
            answer: serviceAnswer(response.status),
          }),
        );
      }
      return parseReports(await response.json());
    }
    const query = new URLSearchParams({
      // Airport observations are automatic and repeat the same wind all day.
      inc_ap: "no",
      hours: String(REPORT_HOURS),
    });
    let failed: string;
    try {
      const response = await fetch(
        cachedUrl(`${SERVICE}?${query.toString()}`),
        { signal, headers: { Accept: "application/json" } },
      );
      if (response.ok) return parseReports(await response.json());
      failed = serviceAnswer(response.status);
    } catch (error) {
      // An aborted request is the workspace changing its mind, not a source
      // that is down, and asking the second one for it would be a request
      // nobody wants and an answer nobody reads.
      if (signal?.aborted) throw error;
      failed = error instanceof Error ? error.message : "";
    }
    // The second answer. A layer with one source cannot tell a quiet
    // afternoon from a host that is down, and neither can the reader.
    //
    // Asked a page at a time, because the service caps a page and says when
    // it is holding more: five hundred rows covered twelve hours of the
    // twenty-four the archive answers for on 2026-09-04, so one ask stops
    // half way through the window. The rows are gathered and parsed together
    // at the end rather than page by page, so the sort that puts the newest
    // report on top sees all of them.
    const rows: unknown[] = [];
    const seen = new Set<number>();
    for (let page = 0; page < SERVICE_PAGES; page += 1) {
      const answer = await fetch(
        cachedUrl(serviceReportsUrl(page * SERVICE_PAGE)),
        { signal, headers: { Accept: "application/json" } },
      );
      if (!answer.ok) {
        // Nothing at all is a failure worth saying. A page that fails after
        // others landed is not: the reader is already looking at the second
        // source because the first one is down, and the newest reports are
        // the ones already in hand.
        if (page === 0) {
          throw new Error(
            translate("reports.serviceStatus", {
              answer: failed || serviceAnswer(answer.status),
            }),
          );
        }
        break;
      }
      const body = (await answer.json()) as {
        features?: unknown;
        exceededTransferLimit?: unknown;
      };
      if (Array.isArray(body.features)) {
        for (const row of body.features) {
          // A report filed between two of these requests shifts every row
          // down one, so the next page begins with the row the last one
          // ended on. Its own id is what says it has already been counted.
          const id = (row as { properties?: { objectid?: unknown } })
            ?.properties?.objectid;
          if (typeof id === "number") {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          rows.push(row);
        }
      }
      if (body.exceededTransferLimit !== true) break;
    }
    return {
      ...parseServiceReports({ features: rows }),
      partial: translate("reports.fromService"),
    };
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-points`,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 7],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#0b1220",
        "circle-stroke-width": 1,
        // The older a report is, the less it says about what is happening now.
        "circle-opacity": 0.85,
      },
    },
  ],
  describe: (properties) => {
    const at = Number(properties.at);
    const magnitude = properties.magnitude;
    const unit = String(properties.unit ?? "");
    const lines: string[] = [];

    if (typeof magnitude === "number" && unit) {
      lines.push(formatReportMagnitude(magnitude, unit));
    }
    lines.push(
      Number.isFinite(at)
        ? translate("reports.reported", { when: relativeTime(at) })
        : translate("reports.reportedUnknown"),
    );
    const source = String(properties.source ?? "");
    if (source) lines.push(translate("reports.source", { source }));
    const remark = String(properties.remark ?? "");
    if (remark) lines.push(remark);

    const city = String(properties.city ?? "");
    const state = String(properties.state ?? "");
    return {
      title: [
        String(properties.label ?? ""),
        [city, state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
      lines,
    };
  },
};

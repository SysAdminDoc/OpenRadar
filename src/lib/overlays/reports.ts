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
 * What a report is about, from the single letter the feed uses.
 *
 * Only the ones a radar viewer is looking for get a colour of their own. The
 * rest are real reports and are drawn, in grey, rather than dropped.
 */
const KINDS: Record<string, { kind: string; color: string }> = {
  T: { kind: "tornado", color: "#f43f5e" },
  H: { kind: "hail", color: "#22d3ee" },
  D: { kind: "wind", color: "#f59e0b" },
  G: { kind: "wind", color: "#f59e0b" },
  O: { kind: "wind", color: "#f59e0b" },
  N: { kind: "wind", color: "#f59e0b" },
  W: { kind: "tornado", color: "#f43f5e" },
  C: { kind: "tornado", color: "#fb7185" },
  F: { kind: "flood", color: "#818cf8" },
  E: { kind: "flood", color: "#818cf8" },
};

const OTHER = { kind: "other", color: "#94a3b8" };

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
    const response = await fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        translate("reports.serviceStatus", {
          answer: serviceAnswer(response.status),
        }),
      );
    }
    return parseReports(await response.json());
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

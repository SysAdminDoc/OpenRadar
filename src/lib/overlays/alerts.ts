import { serviceAnswer } from "../serviceAnswer";
import {
  boundsQuery,
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { translate } from "../../i18n";
import { formatClock } from "../units";
import type { DataDrivenPropertyValueSpecification } from "maplibre-gl";
import { alertType, type AlertType } from "../alertTypes";
import { ecccUrl, parseEcccAlerts, reachesCanada } from "./ecccAlerts";
import { dwdUrl, parseDwdWarnings, reachesGermany } from "./dwdWarnings";
import { language } from "../../i18n";
import { pairingFor } from "../alertPairings";
import { highContrastRequested } from "../../hooks/useClock";

/**
 * How heavily a warning outline is stroked, by how much damage the office
 * expects. Half again as heavy for a reader who has asked for more contrast.
 */
export function alertWidths(
  highContrast: boolean,
): DataDrivenPropertyValueSpecification<number> {
  const heavier = highContrast ? 1.6 : 1;
  return [
    "case",
    [">=", ["get", "impactRank"], 2],
    4 * heavier,
    [">=", ["get", "impactRank"], 1],
    3 * heavier,
    [">=", ["get", "severityRank"], 2],
    2.2 * heavier,
    1.2 * heavier,
  ];
}

const SERVICE =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const FIELDS =
  "objectid,cap_id,prod_type,msg_type,phenom,sig,wfo,url,onset,ends,expiration,issuance";

/**
 * The active alerts as the National Weather Service publishes them.
 *
 * The map service the polygons come from carries no damage threat: its fields
 * are the product type, the office and the times, and nothing else. The tag
 * that separates a considerable warning from an ordinary one lives only in the
 * alert feed, which has no geometry worth drawing. So both are asked for and
 * joined on the common alert identifier, which the two sources spell the same
 * way.
 */
const ALERT_FEED = "https://api.weather.gov/alerts/active?status=actual";

/**
 * The tags from the last read, and when they were read.
 *
 * The feed is a megabyte and a half of every active alert in the country,
 * unpaginated, and it is asked for beside every bounds-limited polygon query:
 * on the overlay's own minute, on the watch's forty-five seconds, and on every
 * pan past the padded bounds. Reading it once a minute and sharing the answer
 * is the difference between that and a few megabytes a minute of somebody
 * else's bandwidth for a handful of tags.
 */
const TAG_TTL_MS = 60_000;
let cachedTags: { at: number; tags: Map<string, AlertTags> } | null = null;
let inFlight: Promise<Map<string, AlertTags>> | null = null;

/**
 * The tags this build has, without ever waiting for them.
 *
 * A read is started when what is held has gone stale, and whatever is held
 * right now is returned: at worst a minute old, which is nothing against a
 * warning that runs for half an hour. Waiting would put a megabyte and a half
 * of somebody else's bandwidth in front of the polygons, and the polygons are
 * what the map draws.
 *
 * Nothing here ever rejects. A warning with no tag is an ordinary warning,
 * which is most of them.
 */
function alertTags(): Map<string, AlertTags> {
  const now = Date.now();
  const held = cachedTags?.tags ?? new Map<string, AlertTags>();
  if (cachedTags && now - cachedTags.at < TAG_TTL_MS) return held;
  // One read at a time. Two overlays and a watch asking at once would be three
  // copies of the same megabyte and a half.
  if (inFlight) return held;

  inFlight = fetch(cachedUrl(ALERT_FEED), {
    headers: { Accept: "application/geo+json" },
  })
    .then(async (answer) => {
      if (!answer.ok) throw new Error(String(answer.status));
      const tags = parseAlertTags(await answer.json());
      cachedTags = { at: Date.now(), tags };
      return tags;
    })
    .catch(() => cachedTags?.tags ?? new Map<string, AlertTags>())
    .finally(() => {
      inFlight = null;
    });
  return held;
}

/**
 * How long the first draw of the session will wait for the tags, and no more.
 *
 * Long enough for a read of a megabyte and a half on an ordinary connection,
 * short enough that a tag feed having a bad minute cannot keep a tornado
 * warning off the map.
 */
const FIRST_TAG_WAIT_MS = 3_000;

/**
 * The tags, waiting for them once and never again.
 *
 * Not waiting at all was wrong at the start of a session and right afterwards.
 * The first read has nothing held, so every warning already in force was drawn
 * with no damage threat on it, ranked as untagged, and announced. A minute
 * later the tags arrived, the same warnings ranked higher, and the watch read
 * that as the office saying they had got worse: everybody heard about every
 * standing warning twice, and the first time was the one without the tag on
 * it. The map had the same problem in silence, drawing a catastrophic tornado
 * warning in the ordinary outline for its first minute.
 *
 * Once anything is held this returns straight away, which is the case that
 * matters for bandwidth: the feed is unpaginated and asked for beside every
 * pan.
 */
async function alertTagsReady(
  signal?: AbortSignal,
): Promise<Map<string, AlertTags>> {
  const held = alertTags();
  const pending = inFlight;
  if (cachedTags || !pending) return held;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const waits: Array<Promise<Map<string, AlertTags>>> = [
      pending,
      new Promise<Map<string, AlertTags>>((resolve) => {
        timer = setTimeout(() => resolve(held), FIRST_TAG_WAIT_MS);
      }),
    ];
    if (signal) {
      waits.push(
        new Promise<Map<string, AlertTags>>((_, reject) => {
          onAbort = () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      );
    }
    return await Promise.race(waits);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Forgets the last read, so a test does not carry one between cases. */
export function resetAlertTags() {
  cachedTags = null;
  inFlight = null;
}

/** How much damage the office said to expect, when they said anything. */
export type ImpactTag = "considerable" | "destructive" | "catastrophic";

export const IMPACT_RANK: Record<ImpactTag, number> = {
  considerable: 1,
  destructive: 2,
  catastrophic: 3,
};

function impactOf(word: unknown): ImpactTag | null {
  const named = typeof word === "string" ? word.trim().toLowerCase() : "";
  if (named === "considerable") return "considerable";
  if (named === "destructive") return "destructive";
  if (named === "catastrophic") return "catastrophic";
  return null;
}

/** A parameter in the feed is a list, because one alert can carry several. */
function firstParameter(parameters: unknown, name: string): unknown {
  if (!parameters || typeof parameters !== "object") return null;
  const found = (parameters as Record<string, unknown>)[name];
  return Array.isArray(found) ? found[0] : found;
}

export interface AlertTags {
  impact: ImpactTag | null;
  /** The larger of the two threats, since a warning can carry both. */
  hailSize: string;
  motion: string;
  /**
   * What the office actually wrote.
   *
   * The map service the polygons come from carries a product type and some
   * times, so the app was showing "Tornado Warning", an expiry and a link
   * out, and writing its own line about what to do because the office's own
   * was never read. It is in this feed, which is already fetched once a
   * minute for the damage tags: taking three more fields off it costs nothing
   * and asks nobody for anything.
   */
  description: string;
  instruction: string;
  area: string;
}

/**
 * The tags in the alert feed, by the identifier the polygons also carry.
 *
 * A tornado warning and a thunderstorm warning name their threat in different
 * parameters, and the stronger of the two is the one worth drawing.
 */
export function parseAlertTags(payload: unknown): Map<string, AlertTags> {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const out = new Map<string, AlertTags>();
  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const properties = (item as { properties?: Record<string, unknown> })
      .properties;
    if (!properties) continue;
    const id = text(properties.id);
    if (!id) continue;
    const parameters = properties.parameters;
    const tornado = impactOf(firstParameter(parameters, "tornadoDamageThreat"));
    const thunderstorm = impactOf(
      firstParameter(parameters, "thunderstormDamageThreat"),
    );
    const impact =
      tornado && thunderstorm
        ? IMPACT_RANK[tornado] >= IMPACT_RANK[thunderstorm]
          ? tornado
          : thunderstorm
        : (tornado ?? thunderstorm);
    out.set(id, {
      impact,
      hailSize: text(firstParameter(parameters, "maxHailSize")),
      motion: text(firstParameter(parameters, "eventMotionDescription")),
      // The office's own words, exactly as issued.
      //
      // An earlier version folded the hard wrapping out, on the theory that
      // sixty-six columns is a teleprinter's width and a panel wraps for
      // itself. It is not only wrapping. A flood warning lists three rivers
      // with three different severities one per line, a warning's details
      // are a dash-bulleted list, and the stage, the crest and the flood
      // stage are three separate figures on three lines: every one of those
      // came out as a single run-on sentence. The layout is the office's too,
      // so nothing here touches it and the stylesheet keeps the breaks.
      description: text(properties.description),
      instruction: text(properties.instruction),
      area: text(properties.areaDesc),
    });
  }
  return out;
}

export type AlertSeverity = "extreme" | "severe" | "moderate" | "minor";

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  extreme: 3,
  severe: 2,
  moderate: 1,
  minor: 0,
};

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  extreme: "#f43f5e",
  severe: "#fb923c",
  moderate: "#facc15",
  minor: "#38bdf8",
};

const EXTREME = [
  "tornado warning",
  "flash flood emergency",
  "extreme wind warning",
  "hurricane warning",
  "tsunami warning",
];

/**
 * The service publishes a CAP significance code (W, A, Y, S). It is blank on a
 * few product types, so the product name is the fallback and life-threatening
 * warnings are lifted above the rest.
 */
export function alertSeverity(prodType: string, sig: string): AlertSeverity {
  const name = prodType.trim().toLowerCase();
  if (EXTREME.includes(name)) return "extreme";

  switch (sig.trim().toUpperCase()) {
    case "W":
      return "severe";
    case "A":
      return "moderate";
    case "Y":
      return "minor";
    default:
      break;
  }

  if (name.endsWith("warning")) return "severe";
  if (name.endsWith("watch")) return "moderate";
  return "minor";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function epoch(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The alerts a reader has asked to see.
 *
 * Filtering here rather than in the fetch keeps one request answering for
 * every combination of switches: turning a kind back on redraws rather than
 * waiting on the service.
 */
export function alertsOfKind(
  alerts: OverlayData,
  wanted: Partial<Record<AlertType, boolean>>,
): OverlayData {
  return {
    ...alerts,
    features: alerts.features.filter(
      (feature) => wanted[feature.properties.kind as AlertType] !== false,
    ),
  };
}

export function parseAlerts(
  payload: unknown,
  tags: Map<string, AlertTags> = new Map(),
): OverlayData {
  const raw = payload as { features?: unknown };
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const parsed: OverlayFeature[] = [];

  for (const item of features) {
    if (!item || typeof item !== "object") continue;
    const feature = item as {
      geometry?: unknown;
      properties?: Record<string, unknown>;
    };
    if (!feature.geometry || typeof feature.geometry !== "object") continue;
    const properties = feature.properties ?? {};
    const prodType = text(properties.prod_type) || "Weather alert";
    const severity = alertSeverity(prodType, text(properties.sig));
    const capId = text(properties.cap_id);
    const tagged = tags.get(capId);

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        headline: prodType,
        severity,
        severityRank: SEVERITY_RANK[severity],
        capId,
        // Which switch in the panel this one belongs to.
        kind: alertType(prodType),
        // A polygon with no tag is an ordinary warning, which is most of them,
        // and is drawn as it always was.
        impact: tagged?.impact ?? "",
        impactRank: tagged?.impact ? IMPACT_RANK[tagged.impact] : 0,
        hailSize: tagged?.hailSize ?? "",
        motion: tagged?.motion ?? "",
        description: tagged?.description ?? "",
        instruction: tagged?.instruction ?? "",
        area: tagged?.area ?? "",
        office: text(properties.wfo),
        url: text(properties.url),
        issued: epoch(properties.issuance) ?? epoch(properties.onset),
        expires: epoch(properties.expiration) ?? epoch(properties.ends),
      },
    });
  }

  // A destructive warning goes on top of an ordinary one of the same kind, so
  // the tag is part of the order rather than only part of the outline.
  parsed.sort(
    (left, right) =>
      Number(right.properties.severityRank) -
        Number(left.properties.severityRank) ||
      Number(right.properties.impactRank) - Number(left.properties.impactRank),
  );
  return { type: "FeatureCollection", features: parsed };
}

/**
 * A moment, with a year when it is not this one.
 *
 * A warning replayed out of the 2011 archive read "Apr 27, 22:00" here, which
 * is indistinguishable from this April, and that is the one way this layer
 * could do harm. Adding a year unconditionally would put one on every live
 * warning for the sake of the rare historical one, so it is added when it
 * says something.
 */
function timeLabel(value: unknown): string {
  if (typeof value !== "number") return "unknown";
  const at = new Date(value);
  const thisYear = at.getFullYear() === new Date().getFullYear();
  return formatClock(at, {
    ...(thisYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The Canadian warnings, or none.
 *
 * A failure here is not a failure of the layer. The American polygons are
 * already drawn by the time this is asked for, and taking the whole layer
 * down because a second country's service had a bad minute would lose a
 * tornado warning over Oklahoma to an outage in Ottawa.
 */
async function ecccFeatures(
  bounds: OverlayBounds,
  signal?: AbortSignal,
): Promise<OverlayFeature[]> {
  try {
    const answer = await fetch(cachedUrl(ecccUrl(bounds)), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!answer.ok) return [];
    return parseEcccAlerts(await answer.json(), language().startsWith("fr"));
  } catch {
    return [];
  }
}

/**
 * The German warnings, or none.
 *
 * Same terms as the Canadian ones: a second country's service having a bad
 * minute must not take the layer down, because the American polygons are
 * already drawn by the time this is asked for.
 */
async function dwdFeatures(
  bounds: OverlayBounds,
  signal?: AbortSignal,
): Promise<OverlayFeature[]> {
  try {
    const answer = await fetch(cachedUrl(dwdUrl(bounds)), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!answer.ok) return [];
    return parseDwdWarnings(await answer.json());
  } catch {
    return [];
  }
}

export const alertsOverlay: OverlayAdapter = {
  id: "alerts",
  label: "Weather Alerts",
  attribution:
    '<a href="https://www.weather.gov/">NWS watches and warnings</a>',
  attributionUrl: "https://www.weather.gov/",
  host: "mapservices.weather.noaa.gov",
  refreshMs: 60_000,
  fetchData: async (bounds: OverlayBounds, signal) => {
    const query = new URLSearchParams({
      where: "1=1",
      outFields: FIELDS,
      returnGeometry: "true",
      geometryPrecision: "3",
      outSR: "4326",
      inSR: "4326",
      geometry: boundsQuery(bounds),
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: "300",
      f: "geojson",
    });
    // The tags. The first read of a session waits for them, briefly, because
    // a warning drawn and announced without its damage threat is announced
    // again when the threat turns up. Every read after that takes what is held
    // and never waits: the feed is unpaginated and the polygons are what the
    // map draws.
    const tagged = await alertTagsReady(signal);
    const response = await fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        translate("alerts.failed", { answer: serviceAnswer(response.status) }),
      );
    }
    const drawn = parseAlerts(await response.json(), tagged);

    // And Canada, when the view reaches it. The same layer rather than a
    // switch of its own: the hazard filters, the watch, the readout and the
    // popup then treat a Canadian warning exactly as they treat an American
    // one, which is the whole point. A view over Kansas asks nobody.
    if (reachesCanada(bounds)) {
      drawn.features.push(...(await ecccFeatures(bounds, signal)));
    }
    // And Germany, on the same terms. The DWD composite has been on the map
    // since the app learned to look at Europe, and nothing said a
    // Gewitterwarnung stood over it.
    if (reachesGermany(bounds)) {
      drawn.features.push(...(await dwdFeatures(bounds, signal)));
    }
    if (reachesCanada(bounds) || reachesGermany(bounds)) {
      drawn.features.sort(
        (left, right) =>
          Number(right.properties.severityRank) -
            Number(left.properties.severityRank) ||
          Number(right.properties.impactRank) -
            Number(left.properties.impactRank),
      );
    }
    return drawn;
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "match",
          ["get", "severity"],
          "extreme",
          SEVERITY_COLOR.extreme,
          "severe",
          SEVERITY_COLOR.severe,
          "moderate",
          SEVERITY_COLOR.moderate,
          SEVERITY_COLOR.minor,
        ],
        "fill-opacity": 0.2,
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": [
          "match",
          ["get", "severity"],
          "extreme",
          SEVERITY_COLOR.extreme,
          "severe",
          SEVERITY_COLOR.severe,
          "moderate",
          SEVERITY_COLOR.moderate,
          SEVERITY_COLOR.minor,
        ],
        // A tagged warning is drawn heavier than an ordinary one of the same
        // kind, because that is exactly the distinction the tag makes: the
        // office is saying this one will do more damage than the usual.
        //
        // Every width is scaled together under more contrast. The colours are
        // the alert severities, which are fixed and not ours to change, so the
        // outline itself is what has to carry further: a warning is easier to
        // find as a heavier line, and the ordering between the four survives
        // because they all move by the same factor.
        "line-width": alertWidths(highContrastRequested()),
      },
    },
  ],
  describe: (properties) => {
    // A warning out of the archive is a picture of a day that is over, and
    // turning on today's rainfall to explain it would be the false-currency
    // mistake the whole replay path is careful about.
    const pairing = properties.historical
      ? null
      : pairingFor(String(properties.headline ?? ""));
    return {
      title: String(properties.headline ?? translate("popup.alert")),
      lines: [
        // First, and only on a polygon out of the archive. A warning from 2011
        // reading like something somebody is being told right now is the one
        // way this layer could do harm, so the date leads rather than sitting
        // under the issue time where a reader might take it for a refresh.
        ...(properties.historical
          ? [
              translate("replay.warningsHistorical", {
                when: timeLabel(properties.polygonBegin),
              }),
            ]
          : []),
        translate("popup.issued", { when: timeLabel(properties.issued) }),
        translate("popup.expires", { when: timeLabel(properties.expires) }),
        ...(properties.impact
          ? [
              translate("alerts.impactLine", {
                tag: translate(
                  `alerts.impact.${String(properties.impact)}` as never,
                ),
              }),
            ]
          : []),
        ...(properties.hailSize
          ? [translate("alerts.hailTo", { size: Number(properties.hailSize) })]
          : []),
        // What the office wrote, which is what the reader came for. Its own
        // words are not summarised, shortened or rewritten: an instruction
        // out of a warning is the one piece of text in this app that must
        // arrive exactly as it was issued.
        ...(properties.area
          ? [translate("alerts.area", { places: String(properties.area) })]
          : []),
        ...(properties.description ? [String(properties.description)] : []),
        ...(properties.instruction ? [String(properties.instruction)] : []),
        translate("popup.alertSource", {
          office:
            String(properties.office ?? "").trim() ||
            translate("popup.alertOffice"),
        }),
      ],
      url: typeof properties.url === "string" ? properties.url : undefined,
      action: pairing
        ? { id: pairing.id, label: translate(pairing.key) }
        : undefined,
    };
  },
};

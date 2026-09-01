import { alertType } from "./alertTypes";
import {
  alertSeverity,
  IMPACT_RANK,
  SEVERITY_RANK,
  type ImpactTag,
} from "./overlays/alerts";
import type { OverlayData } from "./overlays";

/**
 * The warnings that were actually in force while an archived storm was on the
 * map.
 *
 * The app replays radar back to 2003 and drew today's warnings over it, or
 * nothing. Both are wrong in the same way: a picture of the sky on one day
 * with a polygon from another is a claim nobody made. The Iowa State archive
 * keeps every storm-based warning polygon as it stood at any instant, so a
 * replay can show what the offices were saying at the moment on screen.
 *
 * Two dates bound what it can say. Storm-based polygons became the official
 * product on 2007-10-01; before that offices warned by county and only some
 * polygons exist, so the layer says its coverage is partial. Before 2002 the
 * archive holds none at all, and saying so is better than an empty map that
 * looks like a quiet afternoon.
 */

/** The first moment the archive holds any polygon at all. */
export const POLYGONS_FROM = Date.UTC(2002, 0, 1);

/** When storm-based warnings became the official product. */
export const POLYGONS_OFFICIAL_FROM = Date.UTC(2007, 9, 1);

const HOST = "https://mesonet.agron.iastate.edu";

/** What the archive can say about a moment. */
export type ArchiveCoverage = "none" | "partial" | "full";

export function archiveCoverage(atMs: number): ArchiveCoverage {
  if (atMs < POLYGONS_FROM) return "none";
  if (atMs < POLYGONS_OFFICIAL_FROM) return "partial";
  return "full";
}

function stamp(at: number): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Every polygon a warning held during the replay, not just the one it opened
 * with.
 *
 * This is the whole reason the obvious endpoint is not the one used. The
 * `geojson/sbw.py` service, asked for a time window, answers only the rows
 * with a status of `NEW`: one polygon per warning, the shape at issuance, and
 * a `polygon_end` that is the moment the office first revised it rather than
 * the moment the warning ended. Filtering that on the polygon window drops a
 * tornado warning off the map partway through its life, which was measured at
 * a third of the polygons and two thirds of the tornado warnings on
 * 2011-04-27. `only_new=false` on the interval service returns the revisions
 * as well, each with the window it actually stood for.
 *
 * One request for the whole replay, rather than one per frame. A replay is a
 * few dozen frames the reader scrubs back and forth through, and asking per
 * frame would be a request every time the playhead moved: slower for the
 * reader and rude to a service that publishes for nothing.
 */
/**
 * How long before the replay each class of product has to be looked for.
 *
 * The service filters on issuance, not on overlap, so a warning already in
 * force when the replay starts is only found if the window opens before it
 * was issued. There is no overlap parameter; the OpenAPI document calls
 * `begints` and `endts` the issuance window and that is all it offers.
 *
 * Two hours was assumed to cover everything and does not. Measured over the
 * week of 2011-04-22 on the service itself: not one of 2,679 tornado polygons
 * or 3,778 severe thunderstorm polygons lasted longer than 1.2 hours, and one
 * of 155 marine polygons reached exactly two. The flood products are a
 * different kind of thing: 389 of 518 areal flood polygons and 387 of 572
 * flash flood polygons ran past two hours, the longest for 185 hours.
 *
 * So the two hours stays for the products it fits, and the flood products get
 * their own window wide enough for the longest one seen. Asking for ten days
 * of everything instead would be several megabytes of tornado warnings from
 * the week before, none of which is in force.
 */
const SHORT_LOOKBACK_MS = 2 * 3_600_000;
const LONG_LOOKBACK_MS = 10 * 24 * 3_600_000;

/**
 * The VTEC phenomena whose polygons outlive the short window.
 *
 * `FL`, the river flood warning, is the one that matters most and was missed
 * when this was measured on a tornado outbreak, because that week held not a
 * single one. On a tropical frame it is most of the map: at 12Z on
 * 2024-09-27, during Helene, 161 warnings were in force and 100 of them were
 * river flood warnings, 73 of those issued before the short window opens.
 */
const LONG_FUSE = ["FA", "FF", "FL"] as const;

/**
 * How many phenomena the service will filter on at once.
 *
 * Three is a 422 with a message that says so, so the long-fuse products are
 * asked for in pairs rather than in one request.
 */
const PHENOMENA_PER_REQUEST = 2;

/**
 * The requests that together cover the window, in the order they are merged.
 *
 * More than one, because the only way to widen the search is to widen the
 * issuance window, and widening it for every product costs far more than it
 * buys. One short request for everything, then the flood products two
 * phenomena at a time. At noon on the day Helene came ashore the short
 * request alone found 88 of the 161 warnings in force and the set finds
 * every one.
 */
export function archiveWarningsUrls(fromMs: number, toMs: number): string[] {
  const window = (fromMs: number, extra = "") =>
    `${HOST}/api/1/vtec/sbw_interval.geojson` +
    `?begints=${stamp(fromMs)}&endts=${stamp(toMs)}&only_new=false${extra}`;
  const urls = [window(fromMs - SHORT_LOOKBACK_MS)];
  for (let at = 0; at < LONG_FUSE.length; at += PHENOMENA_PER_REQUEST) {
    urls.push(
      window(
        fromMs - LONG_LOOKBACK_MS,
        LONG_FUSE.slice(at, at + PHENOMENA_PER_REQUEST)
          .map((phenomena) => `&ph=${phenomena}`)
          .join(""),
      ),
    );
  }
  return urls;
}

/**
 * How many of those requests must answer for the layer to be right.
 *
 * The first one is the short window and carries most of what is in force at
 * any frame. The rest are the flood products, and one of them failing is a
 * layer missing a class of warning rather than a layer with nothing on it, so
 * they are allowed to fail with a note.
 */
export const ARCHIVE_REQUIRED_URLS = 1;

/**
 * The same window from the service that carries the offices' own tags.
 *
 * The interval service knows every polygon and nothing about hail size or a
 * damage threat; `sbw.py` knows the tags and only the issuance polygon. So
 * both are asked, once each, and joined on the event they describe. If this
 * one fails the polygons still draw, untagged, because the polygons are the
 * feature and the tags are what the office added to them.
 */
export function archiveTagsUrl(fromMs: number, toMs: number): string {
  // The short window only. This feed takes no phenomena filter, so widening
  // it to the flood products' ten days would be five megabytes of issuance
  // rows to reach a handful of tags. A flood warning issued before the window
  // therefore draws without its damage tag, which is the same trade the whole
  // feed already makes: the polygon is the warning and the tag is what the
  // office added to it.
  const issuedFrom = fromMs - SHORT_LOOKBACK_MS;
  return `${HOST}/geojson/sbw.py?sts=${stamp(issuedFrom)}&ets=${stamp(toMs)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A field that is a number on one service and a string on the other.
 *
 * `hailtag` comes back from sbw.py as a JSON number, so reading it as a
 * string dropped every hail size the archive had and, with it, every row that
 * carried nothing else.
 */
function measure(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function moment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * One VTEC event, as both services name it.
 *
 * An office, a year, a hazard, a significance and a number. That is what makes
 * a warning one warning across however many polygons it held, and it is the
 * only thing the two services agree on well enough to join by.
 */
function eventKey(properties: Record<string, unknown>): string {
  return [
    text(properties.wfo),
    String(properties.year ?? ""),
    text(properties.phenomena),
    text(properties.significance),
    String(properties.eventid ?? ""),
  ].join("|");
}

/** Where the archive's own browser shows one event. */
function eventUrl(properties: Record<string, unknown>): string {
  const query = new URLSearchParams({
    year: String(properties.year ?? ""),
    wfo: text(properties.wfo),
    phenomena: text(properties.phenomena),
    significance: text(properties.significance),
    eventid: String(properties.eventid ?? ""),
  });
  return `${HOST}/vtec/?${query.toString()}`;
}

export interface ArchiveTags {
  impact: ImpactTag | "";
  hailSize: string;
}

/**
 * The damage threat the office tagged, in the words the live feed uses.
 *
 * The archive spells these in its own way and carries an emergency as its own
 * flag rather than as a tag, so the two are brought together here or the same
 * warning would read differently depending on which service answered.
 */
function impactOf(properties: Record<string, unknown>): ImpactTag | "" {
  if (properties.is_emergency === true) return "catastrophic";
  for (const raw of [properties.damagetag, properties.floodtag_damage]) {
    const tag = text(raw).toLowerCase();
    if (tag === "catastrophic") return "catastrophic";
    if (tag === "destructive") return "destructive";
    if (tag === "considerable") return "considerable";
  }
  return "";
}

/** The tag feed, keyed by the event each row describes. */
export function parseArchiveTags(payload: unknown): Map<string, ArchiveTags> {
  const out = new Map<string, ArchiveTags>();
  const source = payload as { features?: unknown[] } | null;
  if (!source || !Array.isArray(source.features)) return out;
  for (const raw of source.features) {
    const properties = (raw as { properties?: Record<string, unknown> })
      .properties;
    if (!properties) continue;
    const impact = impactOf(properties);
    const hailSize = measure(properties.hailtag);
    if (!impact && !hailSize) continue;
    out.set(eventKey(properties), { impact, hailSize });
  }
  return out;
}

/**
 * The archive's answer, in the shape the live warnings layer already draws.
 *
 * Deliberately the same properties, so one adapter draws both and a historical
 * polygon cannot end up styled as something other than a warning. What it adds
 * is the two times the polygon was actually in force between, which is what
 * makes scrubbing possible, and the flag that says this is history.
 */
export function parseArchiveWarnings(
  payloads: unknown[],
  tags: Map<string, ArchiveTags> = new Map(),
): OverlayData {
  const features: OverlayData["features"] = [];
  // The two windows overlap by design: a flood warning issued in the last two
  // hours is in both answers. One polygon version is one feature, so the same
  // event, begin and end arriving twice is the same row rather than two.
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const payload of payloads) {
    const source = payload as { features?: unknown[] } | null;
    if (source && Array.isArray(source.features)) rows.push(...source.features);
  }

  for (const raw of rows) {
    const feature = raw as {
      geometry?: unknown;
      properties?: Record<string, unknown>;
    };
    const properties = feature.properties;
    if (!feature.geometry || !properties) continue;

    // A cancellation's polygon is the area being released, not an area under
    // warning, and drawing it would say the opposite of what happened.
    if (text(properties.status) === "CAN") continue;

    const headline = text(properties.event_label);
    if (!headline) continue;
    const begin = moment(properties.utc_polygon_begin);
    if (begin === null) continue;
    const end = moment(properties.utc_polygon_end);

    const severity = alertSeverity(
      headline,
      text(properties.significance) || "W",
    );
    const event = eventKey(properties);
    const version = `${event}|${begin}|${end}`;
    if (seen.has(version)) continue;
    seen.add(version);

    const tag = tags.get(event);
    const impact = tag?.impact ?? "";

    features.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        headline,
        severity,
        severityRank: SEVERITY_RANK[severity],
        capId: text(properties.product_id),
        kind: alertType(headline),
        impact,
        impactRank: impact ? IMPACT_RANK[impact] : 0,
        hailSize: tag?.hailSize ?? "",
        motion: "",
        office: text(properties.wfo),
        // The event's own page, addressed the way the VTEC browser's parser
        // reads first. `/vtec/event/<product_id>` looks right and is not: a
        // product id is a text product, the route wants a seven-part VTEC
        // string, and the page falls through to its defaults and shows an
        // unrelated warning rather than failing.
        url: eventUrl(properties),
        // The event's own life, which is what the popup reports, rather than
        // this polygon's slice of it.
        issued: moment(properties.utc_issue) ?? begin,
        expires: moment(properties.utc_expire) ?? end,
        // What this layer adds. The first two decide which frame a polygon
        // belongs to; the third is what stops a warning from 2011 reading as
        // something somebody is being told right now.
        polygonBegin: begin,
        polygonEnd: end,
        historical: true,
        // Which warning this is, across every polygon it held. The office,
        // the year, the hazard, the significance and the number: the only
        // thing that identifies one warning rather than one shape of one.
        event,
      },
    });
  }

  // Most severe first, then by damage tag, which is the order the live layer
  // draws in and the order any readout takes the worst one from.
  features.sort(
    (left, right) =>
      Number(right.properties.severityRank) -
        Number(left.properties.severityRank) ||
      Number(right.properties.impactRank) - Number(left.properties.impactRank),
  );
  return { type: "FeatureCollection", features };
}

/**
 * The polygons in force at one instant.
 *
 * A warning's polygon is not one shape for its whole life. An office shrinks
 * it as the storm passes, and the archive keeps each version with the window
 * it stood for, so the same warning appears several times and only one of them
 * belongs on any given frame. Comparing against both ends is what picks it.
 *
 * The end is exclusive: a polygon replaced at 22:15 and its replacement
 * beginning at 22:15 would otherwise both be drawn on that frame, one over the
 * other, which is the shrink rendered as a smear.
 */
export function archiveWarningsAt(
  archived: OverlayData | null,
  atMs: number,
): OverlayData | null {
  if (!archived) return null;
  return {
    type: "FeatureCollection",
    features: archived.features.filter((feature) => {
      const begin = feature.properties.polygonBegin;
      const end = feature.properties.polygonEnd;
      if (typeof begin !== "number" || begin > atMs) return false;
      // A polygon the archive has not closed is still the current one.
      return typeof end !== "number" || end > atMs;
    }),
  };
}

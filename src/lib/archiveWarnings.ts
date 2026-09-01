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

const SERVICE = "https://mesonet.agron.iastate.edu/geojson/sbw.py";

/** What the archive can say about a moment. */
export type ArchiveCoverage = "none" | "partial" | "full";

export function archiveCoverage(atMs: number): ArchiveCoverage {
  if (atMs < POLYGONS_FROM) return "none";
  if (atMs < POLYGONS_OFFICIAL_FROM) return "partial";
  return "full";
}

/**
 * One request for the whole replay, rather than one per frame.
 *
 * A replay is twenty-five frames over six hours and the reader scrubs back and
 * forth through them. Asking the archive per frame would be twenty-five
 * requests for a window it will answer in one, and hammering a service that
 * publishes for nothing.
 */
export function archiveWarningsUrl(fromMs: number, toMs: number): string {
  const stamp = (at: number) =>
    new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${SERVICE}?sts=${stamp(fromMs)}&ets=${stamp(toMs)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function moment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * The damage threat the office tagged, in the words the live feed uses.
 *
 * The archive spells these in its own way and carries an emergency as its own
 * flag rather than as a tag, so the two have to be brought together here or
 * the same warning would read differently depending on which side of
 * 2007 it came from.
 */
function impactOf(properties: Record<string, unknown>): ImpactTag | "" {
  if (properties.is_emergency === true) return "catastrophic";
  const tag = text(properties.damagetag).toLowerCase();
  if (tag === "catastrophic") return "catastrophic";
  if (tag === "destructive") return "destructive";
  if (tag === "considerable") return "considerable";
  const flood = text(properties.floodtag_damage).toLowerCase();
  if (flood === "catastrophic") return "catastrophic";
  if (flood === "considerable") return "considerable";
  return "";
}

/**
 * The archive's answer, in the shape the live warnings layer already draws.
 *
 * Deliberately the same properties, so one adapter draws both and a historical
 * polygon cannot end up styled as something other than a warning. What it adds
 * is the two times the polygon was actually in force between, which is what
 * makes scrubbing possible, and the flag that says this is history.
 */
export function parseArchiveWarnings(payload: unknown): OverlayData {
  const source = payload as { features?: unknown[] } | null;
  const features: OverlayData["features"] = [];
  if (!source || !Array.isArray(source.features)) {
    return { type: "FeatureCollection", features };
  }

  for (const raw of source.features) {
    const feature = raw as {
      geometry?: unknown;
      properties?: Record<string, unknown>;
    };
    const properties = feature.properties;
    if (!feature.geometry || !properties) continue;

    // The archive names the product in `ps` and the office's own code in
    // `phenomena` and `significance`, which is what the severity table reads.
    const headline = text(properties.ps);
    if (!headline) continue;
    const severity = alertSeverity(
      headline,
      text(properties.significance) || "W",
    );
    const impact = impactOf(properties);
    const begin = moment(properties.polygon_begin);
    const end = moment(properties.polygon_end);
    if (begin === null) continue;

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
        hailSize: text(properties.hailtag),
        motion: "",
        office: text(properties.wfo),
        url: text(properties.href),
        issued: begin,
        expires: end,
        // What this layer adds. The first two decide which frame a polygon
        // belongs to; the third is what stops a warning from 2011 reading as
        // something somebody is being told right now.
        polygonBegin: begin,
        polygonEnd: end,
        historical: true,
      },
    });
  }

  // Most severe first, then by damage tag, which is the order the live layer
  // draws in and the order the capture strip reads the worst one from.
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

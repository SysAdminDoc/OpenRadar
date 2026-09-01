import {
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { translate } from "../../i18n";
import { formatClock } from "../units";

/**
 * NOAA's Hazard Mapping System smoke analysis.
 *
 * Analysts at NESDIS draw these by hand off satellite imagery once a day and
 * publish them as KML, keyless, one file per day. It is the only national
 * answer to "is the sky brown because of a fire" that is not a model, and
 * smoke has become an annual event rather than a western one: the 2023 Quebec
 * plume put air-quality apps on the front page, and New York issued advisories
 * again in July 2026.
 *
 * The polygons are an analysis, not an observation, and they say so. Three
 * densities, Light, Medium and Heavy, and nothing between them.
 */

const HOST = "satepsanone.nesdis.noaa.gov";
const BASE = `https://${HOST}/pub/FIRE/web/HMS/Smoke_Polygons/KML`;

export type SmokeDensity = "light" | "medium" | "heavy";

/** Where the day's file lives. The path carries the year and month too. */
export function smokeUrl(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${BASE}/${year}/${month}/hms_smoke${year}${month}${day}.kml`;
}

/** The day before, so a file that is not published yet has a fallback. */
export function previousDay(at: Date): Date {
  return new Date(at.getTime() - 86_400_000);
}

const DENSITY_ORDER: Record<SmokeDensity, number> = {
  light: 0,
  medium: 1,
  heavy: 2,
};

function densityOf(placemark: Element): SmokeDensity | null {
  // Two places say it and they agree: the style reference and a line in the
  // description. The style is read first because it is a single token rather
  // than prose, and the description is the fallback for a file whose styles
  // have been renamed.
  const style = placemark
    .getElementsByTagName("styleUrl")[0]
    ?.textContent?.toLowerCase();
  const description =
    placemark.getElementsByTagName("description")[0]?.textContent ?? "";
  const said = /density:\s*(light|medium|heavy)/i.exec(description)?.[1];
  for (const density of ["light", "medium", "heavy"] as const) {
    if (style?.includes(`smoke_${density}`)) return density;
  }
  return said ? (said.toLowerCase() as SmokeDensity) : null;
}

/**
 * A KML ring as a GeoJSON one.
 *
 * The coordinates are whitespace separated `lon,lat,alt` triples, which is
 * the format's own layout rather than anything this file invented. A ring
 * that does not close is closed here, because KML allows an implicit close
 * and GeoJSON does not.
 */
function ring(text: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const token of text.trim().split(/\s+/)) {
    const [lon, lat] = token.split(",").map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    points.push([lon, lat]);
  }
  // Fewer than three distinct corners is not an area. Counted as distinct
  // rather than as positions, because a ring that already closes itself
  // carries its first corner twice and three positions would then be a line
  // written as a polygon. A file with one of these in it is otherwise fine,
  // so the ring is dropped rather than the day.
  const corners = new Set(points.map(([lon, lat]) => `${lon},${lat}`));
  if (corners.size < 3) return [];
  const [firstLon, firstLat] = points[0];
  const [lastLon, lastLat] = points[points.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    points.push([firstLon, firstLat]);
  }
  return points;
}

/**
 * The analysis time the file stamps on itself.
 *
 * `HMS Smoke Mapping-20260901` in the document name. Read from the document
 * rather than from the URL, so a file served for one date that actually holds
 * another says what it holds.
 */
function analysedOn(document: Document): number | null {
  const name = document.getElementsByTagName("name")[0]?.textContent ?? "";
  const found = /(\d{4})(\d{2})(\d{2})/.exec(name);
  if (!found) return null;
  const at = Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]));
  return Number.isFinite(at) ? at : null;
}

/**
 * The analysis date, written the way the file wrote it.
 *
 * This is a calendar day rather than an instant: the file is named for the
 * day the analyst worked, and midnight UTC is only how that day is carried
 * about. Formatting it in the reader's own zone dated every analysis a day
 * early for everybody west of Greenwich, which is everybody this layer is
 * for.
 */
export function analysisDate(at: number, withYear = false): string {
  return formatClock(at, {
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
  });
}

/**
 * Reads a day's file.
 *
 * Throws for a document that is not this document, because a layer that
 * silently draws nothing when the format changes is worse than one that says
 * it could not read it. An empty day is not that: the analysis genuinely
 * finds no smoke on plenty of days and publishes a file with no polygons in
 * it, so no placemarks is an answer and is returned as one.
 */
export function parseSmoke(xml: string): OverlayData {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("the smoke analysis could not be read");
  }
  if (document.getElementsByTagName("kml").length === 0) {
    throw new Error("the smoke analysis was not a KML document");
  }
  const analysed = analysedOn(document);
  const features: OverlayFeature[] = [];

  for (const placemark of Array.from(
    document.getElementsByTagName("Placemark"),
  )) {
    const density = densityOf(placemark);
    if (!density) continue;
    const rings: Array<Array<[number, number]>> = [];
    for (const outer of Array.from(
      placemark.getElementsByTagName("outerBoundaryIs"),
    )) {
      const text =
        outer.getElementsByTagName("coordinates")[0]?.textContent ?? "";
      const points = ring(text);
      if (points.length) rings.push(points);
    }
    for (const points of rings) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [points] },
        properties: { density, analysed },
      });
    }
  }

  // Heavy on top of light, so the worst of an overlap is what shows.
  features.sort(
    (left, right) =>
      DENSITY_ORDER[left.properties.density as SmokeDensity] -
      DENSITY_ORDER[right.properties.density as SmokeDensity],
  );
  return { type: "FeatureCollection", features };
}

/**
 * The day's analysis, or yesterday's when today's is not published yet.
 *
 * The fallback is on the fetch failing, never on an empty answer. A day the
 * analysts found no smoke on publishes a real file with no polygons, and
 * showing yesterday's smoke instead of that would be a claim nobody made.
 */
export async function fetchSmoke(
  now: Date,
  signal?: AbortSignal,
): Promise<OverlayData> {
  const download = async (at: Date) => {
    const response = await fetch(cachedUrl(smokeUrl(at)), {
      signal,
      headers: { Accept: "application/vnd.google-earth.kml+xml" },
    });
    if (!response.ok) {
      throw new Error(`NOAA HMS returned ${response.status}.`);
    }
    return response.text();
  };

  let text: string;
  try {
    text = await download(now);
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") {
      throw failure;
    }
    // One step back and no further. Two days without an analysis is the
    // service being down, which is a note beside the switch rather than a
    // week of walking backwards through the archive.
    text = await download(previousDay(now));
  }
  // Outside the fallback deliberately. A file that will not parse is a file
  // that changed shape or arrived truncated, and answering that with
  // yesterday's plume would put smoke on the map that nothing had confirmed
  // was there today. The fallback is for a file that is not published yet.
  return parseSmoke(text);
}

export const smokeOverlay: OverlayAdapter = {
  id: "smoke",
  label: "Smoke",
  attribution:
    '<a href="https://www.ospo.noaa.gov/products/land/hms.html">NOAA Hazard Mapping System</a>',
  attributionUrl: "https://www.ospo.noaa.gov/products/land/hms.html",
  host: HOST,
  // Published once a day, so the hour is about catching the day's file after
  // it lands rather than about the picture moving.
  refreshMs: 60 * 60_000,
  global: true,
  fetchData: (_bounds: OverlayBounds, signal) => fetchSmoke(new Date(), signal),
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": [
          "match",
          ["get", "density"],
          "heavy",
          "#78350f",
          "medium",
          "#b45309",
          "#d97706",
        ],
        "fill-opacity": [
          "match",
          ["get", "density"],
          "heavy",
          0.45,
          "medium",
          0.3,
          0.18,
        ],
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      paint: { "line-color": "#fcd34d", "line-width": 0.6 },
    },
  ],
  describe: (properties) => {
    const analysed = Number(properties.analysed);
    const density = String(properties.density);
    return {
      title: translate(`smoke.${density}` as "smoke.light"),
      lines: [
        Number.isFinite(analysed)
          ? translate("smoke.analysed", { when: analysisDate(analysed, true) })
          : translate("smoke.analysedUnknown"),
        translate("smoke.note"),
      ],
    };
  },
};

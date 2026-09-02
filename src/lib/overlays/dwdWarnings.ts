import type { OverlayBounds, OverlayFeature } from "./registry";
import type { AlertType } from "../alertTypes";
import { SEVERITY_RANK, type AlertSeverity } from "./alerts";

/**
 * Public weather warnings for Germany, from the Deutscher Wetterdienst.
 *
 * The DWD composite of seventeen radars has been on the map for as long as
 * the app has looked at Europe, and nothing said a Gewitterwarnung stood over
 * it. These go on the same layer as the American and Canadian warnings, so
 * the hazard switches, the watch, the notification and the readout treat a
 * German warning as they treat any other.
 *
 * The text stays German. The office publishes in German only, and a warning
 * is the office's own words: an English paraphrase of a Sturmbö would be this
 * app inventing a warning nobody issued. Everything the app writes around it
 * is in the reader's language as usual.
 */
const SERVICE = "https://maps.dwd.de/geoserver/dwd/ows";

/** Germany, generously, including its coasts. */
const GERMANY: OverlayBounds = {
  west: 5.5,
  south: 47.0,
  east: 15.5,
  north: 55.5,
};

/** Whether a view has any of Germany in it. */
export function reachesGermany(bounds: OverlayBounds): boolean {
  return (
    bounds.west <= GERMANY.east &&
    bounds.east >= GERMANY.west &&
    bounds.south <= GERMANY.north &&
    bounds.north >= GERMANY.south
  );
}

/** The address for a view, asking only about the part of it in Germany. */
export function dwdUrl(bounds: OverlayBounds): string {
  const west = Math.max(bounds.west, GERMANY.west);
  const east = Math.min(bounds.east, GERMANY.east);
  const south = Math.max(bounds.south, GERMANY.south);
  const north = Math.min(bounds.north, GERMANY.north);
  const query = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: "dwd:Warnungen_Gemeinden",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: "400",
    // WFS 2.0 takes the box in the order the CRS declares, and EPSG:4326 is
    // latitude first. Naming the CRS on the end is what stops a box being
    // read as longitude first and answering about the sea off Somalia.
    bbox: `${south},${west},${north},${east},EPSG:4326`,
  });
  return `${SERVICE}?${query.toString()}`;
}

/**
 * Which hazard group a German warning belongs to.
 *
 * Read from `EC_GROUP`, which is the office's own grouping and a small closed
 * vocabulary, with the event text as a second opinion. Anything unrecognised
 * falls to "other" rather than being guessed at: that is what the American
 * classifier does with a product it has not met, and it means a new kind of
 * warning appears on the map under a switch nobody has turned off instead of
 * vanishing.
 *
 * Only WIND was live when this was written, so the rest of the table is the
 * published vocabulary rather than something observed. The fallback is what
 * makes that safe.
 */
export function dwdHazard(group: string, event: string): AlertType {
  const said = `${group} ${event}`.toUpperCase();

  // Wind and thunderstorms are one switch here as they are for the American
  // warnings: the hazard is the same and so is what a reader does about it.
  if (
    said.includes("GEWITTER") ||
    said.includes("WIND") ||
    said.includes("STURM") ||
    said.includes("ORKAN") ||
    said.includes("BÖE")
  ) {
    return "thunderstorm";
  }
  if (
    said.includes("SCHNEE") ||
    said.includes("GLATT") ||
    said.includes("GLÄTTE") ||
    said.includes("FROST") ||
    said.includes("EIS") ||
    said.includes("KÄLTE") ||
    said.includes("TAUWETTER")
  ) {
    return "winter";
  }
  if (said.includes("REGEN") || said.includes("HOCHWASSER")) return "flood";
  if (said.includes("HITZE")) return "heat";
  return "other";
}

/**
 * How serious the DWD says it is.
 *
 * `SEVERITY` is the CAP word, which is the same vocabulary this app already
 * draws in four colours, so nothing has to be translated. An unrecognised
 * value is the least severe rather than the most: a warning drawn louder than
 * the office issued it is the one direction that costs a reader's trust.
 */
export function dwdSeverity(severity: string): AlertSeverity {
  switch (severity.toLowerCase()) {
    case "extreme":
      return "extreme";
    case "severe":
      return "severe";
    case "moderate":
      return "moderate";
    default:
      return "minor";
  }
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function epoch(value: unknown): number | undefined {
  const said = text(value);
  if (!said) return undefined;
  const at = Date.parse(said);
  return Number.isFinite(at) ? at : undefined;
}

/** The warnings, in the shape the map already draws. */
export function parseDwdWarnings(payload: unknown): OverlayFeature[] {
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

    // The office's own headline, which is a whole sentence: "Amtliche WARNUNG
    // vor WINDBÖEN". The event on its own is what the rest of this layer
    // calls a headline, so that is what is used.
    const event = text(properties.EVENT);
    if (!event) continue;
    const severity = dwdSeverity(text(properties.SEVERITY));

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        headline: titled(event),
        severity,
        severityRank: SEVERITY_RANK[severity],
        capId: text(properties.IDENTIFIER),
        kind: dwdHazard(text(properties.EC_GROUP), event),
        impact: "",
        impactRank: 0,
        hailSize: "",
        motion: "",
        office: text(properties.SENDERNAME) || "Deutscher Wetterdienst",
        url: text(properties.WEB) || "https://www.dwd.de/warnungen",
        issued: epoch(properties.ONSET) ?? epoch(properties.EFFECTIVE),
        expires: epoch(properties.EXPIRES),
        area: text(properties.NAME) || text(properties.AREADESC),
        description: text(properties.DESCRIPTION),
        instruction: text(properties.INSTRUCTION),
      },
    });
  }

  return parsed;
}

/**
 * "WINDBÖEN" as a headline rather than as shouting.
 *
 * The office writes its event names in capitals, and every other headline on
 * this layer is in title case; left alone, a German warning would be the one
 * line in the list in block capitals, which reads as more severe than the
 * office said it was.
 */
function titled(said: string): string {
  return said
    .toLocaleLowerCase("de")
    .replace(
      /(^|\s|-)(\p{Ll})/gu,
      (_, before: string, letter: string) =>
        before + letter.toLocaleUpperCase("de"),
    );
}

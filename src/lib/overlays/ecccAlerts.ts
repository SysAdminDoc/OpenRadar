import type { OverlayBounds, OverlayFeature } from "./registry";
import { alertType } from "../alertTypes";
import { alertSeverity, SEVERITY_RANK, type AlertSeverity } from "./alerts";

/**
 * Public weather alerts for Canada, from Environment and Climate Change
 * Canada.
 *
 * The app has drawn ECCC radar since it learned to look north of the border,
 * and it ships Canadian French, but a watched place in Saskatchewan never
 * said a word: the only warnings it knew about were the American ones. These
 * are the same hazards from the office that issues them, and they go into the
 * same layer as the NWS polygons rather than a switch of their own, so the
 * watch, the hazard filters, the readout and the popup all treat a Canadian
 * warning exactly as they treat an American one.
 *
 * The licence forbids altering the content or the intent of an alert, which
 * is the same rule this app already keeps for the American ones: the office's
 * text is carried through and never shortened, summarised or rewritten.
 */
const SERVICE = "https://api.weather.gc.ca/collections/weather-alerts/items";

/** The whole of Canada, generously. Nothing else is worth a request. */
const CANADA: OverlayBounds = {
  west: -141.1,
  south: 41.6,
  east: -52.5,
  north: 83.2,
};

/** Whether a view has any of Canada in it. */
export function reachesCanada(bounds: OverlayBounds): boolean {
  return (
    bounds.west <= CANADA.east &&
    bounds.east >= CANADA.west &&
    bounds.south <= CANADA.north &&
    bounds.north >= CANADA.south
  );
}

/** The address for a view, asking only for what is in it. */
export function ecccUrl(bounds: OverlayBounds): string {
  const west = Math.max(bounds.west, CANADA.west);
  const east = Math.min(bounds.east, CANADA.east);
  const south = Math.max(bounds.south, CANADA.south);
  const north = Math.min(bounds.north, CANADA.north);
  const query = new URLSearchParams({
    f: "json",
    limit: "300",
    bbox: [west, south, east, north].map((n) => n.toFixed(3)).join(","),
  });
  return `${SERVICE}?${query.toString()}`;
}

/**
 * How serious ECCC says it is.
 *
 * The stage the hazard is at, and then the same promotion the American side
 * applies to its own product names: `alertSeverity` is what puts a tornado
 * warning above a thunderstorm warning, and running the Canadian name
 * through it is what makes a Canadian warning and its American twin rank the
 * same.
 *
 * The office's colour is deliberately NOT read. An earlier version took red
 * as extreme before looking at anything else, and ECCC paints a severe
 * thunderstorm warning red: it outranked the identical American product,
 * took the top fill and the extreme tone, and pierced quiet hours at every
 * override setting. Colour is how the office draws a warning, not how bad it
 * is.
 */
export function ecccSeverity(type: string, english: string): AlertSeverity {
  const stage = type.toLowerCase();
  if (stage === "warning") {
    // The same ladder the American products climb, so "tornado warning" is
    // extreme in Regina exactly as it is in Kansas.
    return alertSeverity(english, "W");
  }
  if (stage === "watch") return "moderate";
  // An advisory or a special weather statement is the office saying keep an
  // eye on this, which is the bottom of the scale here as it is in the south.
  return "minor";
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** A moment, in milliseconds, or nothing. */
function epoch(value: unknown): number | undefined {
  const said = text(value);
  if (!said) return undefined;
  const at = Date.parse(said);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * The warnings, in the shape the map already draws.
 *
 * Every property the American polygons carry is filled in with the Canadian
 * equivalent or left empty, so nothing downstream has to know which country a
 * warning came from. `headline` is the office's own name for the product in
 * the reader's own language where the service offers one, which is what the
 * hazard grouping reads and what the panel shows.
 */
export function parseEcccAlerts(
  payload: unknown,
  french = false,
): OverlayFeature[] {
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
    // The feature's own identifier, which is the only unique one here.
    // `feature_id` is the REGION the alert covers: it is reused by every
    // alert over that region and empty for a good many of them, so fourteen
    // warnings shared the empty string on the day this was written.
    const id = text((feature as { id?: unknown }).id);

    // The office's own name for the product. The English one is what the
    // hazard grouping reads, because that grouping is written in English
    // words; the reader sees whichever language they are in.
    const english = text(properties.alert_name_en);
    if (!english) continue;

    // An alert the office has ended is not a warning. ECCC keeps ended
    // alerts in the same collection with an expiry still hours away, so
    // nothing downstream drops them: sixty-five of three hundred were ended
    // on the day this was written, among them a tornado warning that would
    // have been drawn in red and announced at a watched place.
    if (text(properties.status_en).toLowerCase() === "ended") continue;

    const shown = french ? text(properties.alert_name_fr) || english : english;
    const severity = ecccSeverity(text(properties.alert_type), english);

    parsed.push({
      type: "Feature",
      geometry: feature.geometry as Record<string, unknown>,
      properties: {
        // Title case, because every other headline on this layer is: the
        // service publishes them in lower case.
        headline: french ? sentence(shown) : titled(shown),
        severity,
        severityRank: SEVERITY_RANK[severity],
        capId: id || text(properties.feature_id),
        kind: alertType(english),
        // ECCC publishes no damage threat and no hail size. An empty tag is
        // what an ordinary warning carries on the American side too.
        impact: "",
        impactRank: 0,
        hailSize: "",
        motion: "",
        office: "Environment and Climate Change Canada",
        url: "https://weather.gc.ca/warnings/index_e.html",
        issued: epoch(properties.publication_datetime),
        expires:
          epoch(properties.expiration_datetime) ??
          epoch(properties.event_end_datetime),
        area: text(
          french ? properties.feature_name_fr : properties.feature_name_en,
        ),
        // The office's own text, unaltered: the licence requires it and so
        // does the reason for showing it at all.
        description: text(
          french ? properties.alert_text_fr : properties.alert_text_en,
        ),
        instruction: "",
      },
    });
  }

  return parsed;
}

/**
 * "severe thunderstorm warning" the way every other headline is written.
 *
 * The service publishes its names in lower case and every other headline on
 * this layer is in title case, so a Canadian warning would otherwise read as
 * a different kind of thing in the same list.
 */
function titled(said: string): string {
  return said.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) =>
    space === "" ? letter.toUpperCase() : space + letter.toUpperCase(),
  );
}

/**
 * The French names, capitalised once and left alone after that.
 *
 * Title case is an English convention: "veille d'orages violents" becomes
 * "Veille D'orages Violents" under the rule above, which is not how French is
 * written and is not what the office published.
 */
function sentence(said: string): string {
  return said ? said[0].toLocaleUpperCase("fr") + said.slice(1) : said;
}

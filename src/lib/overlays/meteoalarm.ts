import type { OverlayBounds, OverlayFeature } from "./registry";
import type { AlertType } from "../alertTypes";
import { SEVERITY_RANK, type AlertSeverity } from "../alertSeverity";
import { translate } from "../../i18n";

/**
 * Public weather warnings for the rest of Europe, from MeteoAlarm.
 *
 * The app draws Canadian and German warnings beside the American ones, and a
 * reader in Bern or Oslo with the radar on had nothing at all. MeteoAlarm is
 * EUMETNET's shared publication of every member service's warnings, keyless
 * and under terms equivalent to CC BY 4.0, and it is one feed per country in
 * CAP.
 *
 * These go on the same layer as the rest, so the hazard switches, the watch,
 * the readout and the popup treat a Swiss warning exactly as they treat an
 * American one. Every service's own text is carried through unaltered: a
 * warning is the office's own words, and the licence and the reason for
 * showing it at all agree about that.
 *
 * Germany is deliberately not here. `dwdWarnings.ts` reads the DWD's own
 * service, which publishes the warning cell geometry MeteoAlarm's German feed
 * does not, so a German warning would otherwise draw twice.
 */

/**
 * The Atom feed rather than the JSON one beside it.
 *
 * Both are published and both carry the geometry, and the difference is a
 * hundred and sixty times over: Switzerland's JSON was 9.6 MB on the day this
 * was written and its Atom was 60 kB. Most of that weight is what MeteoAlarm
 * calls a green warning, which is the words "No warnings for Drenthe" wrapped
 * in a CAP alert, one per region per hazard per language: 2,307 of the 3,115
 * entries across twelve countries. The Atom carries only what a reader would
 * call a warning.
 *
 * What the Atom does not carry is the office's own description and
 * instruction text. Those are in a per-alert CAP document one link away, at
 * 48 kB each, which is a request per drawn warning and fifty-one of them over
 * Italy. The map draws what the Atom says and the popup links to MeteoAlarm's
 * own page for the rest.
 */
const SERVICE = "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom";

/**
 * Every member country's feed, with a box generous enough to include its
 * coasts and its islands.
 *
 * All of them rather than the ones that happened to carry geometry the day
 * this was written. Which services publish a polygon is theirs to change, and
 * a country that starts publishing one should start drawing without a code
 * change; one that publishes none simply contributes nothing.
 */
export const METEOALARM_COUNTRIES: ReadonlyArray<{
  id: string;
  box: OverlayBounds;
  /**
   * The service that issues the country's warnings, as it names itself.
   *
   * Read out of each feed's own English `senderName` on 2026-09-10 rather
   * than written from memory, and absent for the six that had no warning at
   * all that day. The first reading of this table took whichever block came
   * first, which is not always the English one, and named the wrong
   * institution for three countries.
   *
   * One name per country, which is not always one office: Bosnia and
   * Herzegovina has two services and Poland has regional ones, so this names
   * whichever answered its feed on the day it was read. The popup carries it
   * beside MeteoAlarm's own credit rather than instead of it, which is what
   * keeps a warning from a sibling office from being credited outright to
   * the wrong one.
   */
  office?: string;
}> = [
  {
    id: "andorra",
    box: { west: 1.4, south: 42.4, east: 1.8, north: 42.7 },
    office: "National Meteorological Service of Andorra",
  },
  {
    id: "austria",
    box: { west: 9.5, south: 46.3, east: 17.2, north: 49.1 },
    office: "GeoSphere Austria",
  },
  {
    id: "belgium",
    box: { west: 2.5, south: 49.4, east: 6.5, north: 51.6 },
  },
  {
    id: "bosnia-herzegovina",
    box: { west: 15.7, south: 42.5, east: 19.7, north: 45.3 },
    office: "Republic Hydrometeorological Service of the Republic of Srpska",
  },
  {
    id: "bulgaria",
    box: { west: 22.3, south: 41.2, east: 28.7, north: 44.3 },
    office: "NIMH",
  },
  {
    id: "croatia",
    box: { west: 13.4, south: 42.3, east: 19.5, north: 46.6 },
    office: "DHMZ Državni hidrometeorološki zavod",
  },
  {
    id: "cyprus",
    box: { west: 32.2, south: 34.5, east: 34.7, north: 35.8 },
  },
  {
    id: "czechia",
    box: { west: 12.0, south: 48.5, east: 18.9, north: 51.1 },
  },
  {
    id: "denmark",
    box: { west: 8.0, south: 54.5, east: 15.3, north: 57.8 },
    office: "Danish Meteorological Institute",
  },
  {
    // Widened west and north on 2026-09-10: the live feed's own polygons
    // reached 21.387 and 59.938, so a view over Hiiumaa or the northern
    // gulf never asked Estonia at all.
    id: "estonia",
    box: { west: 21.2, south: 57.3, east: 28.4, north: 60.1 },
    office: "Estonian Environment Agency",
  },
  {
    id: "finland",
    box: { west: 19.0, south: 59.7, east: 31.6, north: 70.1 },
    office: "Finnish Meteorological Institute",
  },
  {
    id: "france",
    box: { west: -5.2, south: 41.3, east: 9.6, north: 51.2 },
    office: "METEO-FRANCE",
  },
  {
    id: "greece",
    box: { west: 19.3, south: 34.7, east: 28.3, north: 41.8 },
    office: "Hnms Forecaster",
  },
  {
    id: "hungary",
    box: { west: 16.1, south: 45.7, east: 22.9, north: 48.6 },
    office: "Hungarian Meteorologial Service",
  },
  {
    id: "iceland",
    box: { west: -24.6, south: 63.2, east: -13.4, north: 66.6 },
    office: "Icelandic Meteorological Office",
  },
  {
    id: "ireland",
    box: { west: -10.6, south: 51.4, east: -5.9, north: 55.4 },
    office: "Met Eireann",
  },
  {
    id: "israel",
    box: { west: 34.2, south: 29.4, east: 35.9, north: 33.4 },
    office: "Israel Meteorological Service",
  },
  {
    id: "italy",
    box: { west: 6.6, south: 35.4, east: 18.6, north: 47.1 },
    office: "Italian Air Force National Meteorological Service",
  },
  {
    id: "latvia",
    box: { west: 20.9, south: 55.6, east: 28.3, north: 58.1 },
    office: "Latvian Environment, Geology and Meteorology Centre",
  },
  {
    id: "lithuania",
    box: { west: 20.9, south: 53.8, east: 26.9, north: 56.5 },
    office:
      "Lithuanian Hydrometeorological Service under the Ministry of Environment",
  },
  {
    id: "luxembourg",
    box: { west: 5.7, south: 49.4, east: 6.6, north: 50.2 },
  },
  {
    id: "malta",
    box: { west: 14.1, south: 35.7, east: 14.6, north: 36.1 },
  },
  {
    id: "moldova",
    box: { west: 26.6, south: 45.4, east: 30.2, north: 48.5 },
    office: "Autoritatea de Meteorologie și Monitoring de Mediu",
  },
  {
    id: "montenegro",
    box: { west: 18.4, south: 41.8, east: 20.4, north: 43.6 },
    office: "Zavod za hidrometeorologiju i seizmologiju",
  },
  {
    // Widened north on 2026-09-10: the live feed's own polygons reached
    // 54.16, so the Wadden and the North Sea warnings, which is where the
    // wind warnings are, fell outside the box and were never asked for.
    id: "netherlands",
    box: { west: 3.2, south: 50.7, east: 7.3, north: 54.4 },
    office: "KNMI Royal Netherlands Meteorological Institute",
  },
  {
    id: "norway",
    box: { west: 4.0, south: 57.9, east: 31.8, north: 71.3 },
    office: "MET Norway",
  },
  {
    id: "poland",
    box: { west: 14.1, south: 48.9, east: 24.2, north: 55.0 },
    office: "IMGW-PIB Regional Meteorological Forecasting Office",
  },
  // Wide enough for the Azores and Madeira, which the same service warns for.
  {
    id: "portugal",
    box: { west: -31.3, south: 32.4, east: -6.1, north: 42.2 },
    office: "Instituto Português do Mar e da Atmosfera",
  },
  {
    id: "republic-of-north-macedonia",
    box: { west: 20.4, south: 40.8, east: 23.1, north: 42.4 },
    office: "National Hydrometeorological Service - Republic of Macedonia",
  },
  {
    id: "romania",
    box: { west: 20.2, south: 43.6, east: 29.8, north: 48.3 },
    office: "National Meteorological Administration",
  },
  {
    id: "serbia",
    box: { west: 18.8, south: 42.2, east: 23.1, north: 46.2 },
    office: "RHMS Serbia",
  },
  {
    id: "slovakia",
    box: { west: 16.8, south: 47.7, east: 22.6, north: 49.7 },
  },
  {
    id: "slovenia",
    box: { west: 13.3, south: 45.4, east: 16.7, north: 46.9 },
    office: "Slovenian Environment Agency (ARSO vreme)",
  },
  // Wide enough for the Canaries.
  {
    id: "spain",
    box: { west: -18.2, south: 27.6, east: 4.4, north: 43.9 },
    office: "AEMET. State Meteorological Agency",
  },
  {
    id: "sweden",
    box: { west: 10.9, south: 55.3, east: 24.2, north: 69.1 },
    office: "SMHI, Swedish Meteorological and Hydrological Institute",
  },
  {
    id: "switzerland",
    box: { west: 5.9, south: 45.8, east: 10.5, north: 47.9 },
    office: "MeteoSwiss",
  },
  {
    id: "ukraine",
    box: { west: 22.1, south: 44.3, east: 40.3, north: 52.4 },
    office: "Ukrainian Hydrometeorological Center",
  },
];

/**
 * How many feeds one pass will ask for.
 *
 * A view over the Alps reaches half a dozen countries and a view of the whole
 * continent reaches all of them, and one request each is not a reasonable
 * thing to do to a shared free service on every pan. The ones covering most
 * of what is on screen are the ones a reader is looking at.
 */
export const MAX_METEOALARM_COUNTRIES = 6;

/** How much of a view a box covers, in square degrees, or nothing. */
function overlap(bounds: OverlayBounds, box: OverlayBounds): number {
  const west = Math.max(bounds.west, box.west);
  const east = Math.min(bounds.east, box.east);
  const south = Math.max(bounds.south, box.south);
  const north = Math.min(bounds.north, box.north);
  if (east <= west || north <= south) return 0;
  return (east - west) * (north - south);
}

/**
 * Which feeds a view is worth asking, most of the view first.
 *
 * A second number comes back: how many more countries the view reaches that
 * were not asked, so the layer can say so rather than letting a country with
 * nothing drawn stand for one nobody asked about.
 */
export function meteoalarmCountriesIn(bounds: OverlayBounds): {
  asked: string[];
  skipped: number;
} {
  const reached = METEOALARM_COUNTRIES.map((country) => ({
    id: country.id,
    area: overlap(bounds, country.box),
  }))
    .filter((country) => country.area > 0)
    .sort((left, right) => right.area - left.area);
  return {
    asked: reached
      .slice(0, MAX_METEOALARM_COUNTRIES)
      .map((country) => country.id),
    skipped: Math.max(0, reached.length - MAX_METEOALARM_COUNTRIES),
  };
}

export function meteoalarmUrl(country: string): string {
  return `${SERVICE}-${country}`;
}

/**
 * Which hazard switch a MeteoAlarm warning lands under.
 *
 * Read from the hazard word MeteoAlarm itself puts in the entry's title,
 * which is a small closed vocabulary: Thunderstorm, Rain, Wind,
 * High-temperature, Low-temperature, Snow-ice, Coastalevent, Forest-fire,
 * Fog, Flooding, Rain-flood, Avalanches. Fog is deliberately not in the
 * table below: there is no fog switch and no hazard group it belongs in, so
 * it falls to "other" with everything else nobody has a switch for.
 *
 * Not from `cap:event`, which is each service's own words and is not a
 * vocabulary at all: the live feeds carry "Thunderstormwarning", "EXTREME
 * HIGH TEMP", "Gale", "Rain Level 1" and, from one service, the literal
 * string "awareness_type=5, awareness_level=2".
 *
 * Anything unrecognised is "other" for the reason the German and American
 * classifiers give: a hazard nobody has met appears under a switch nobody has
 * turned off rather than vanishing.
 */
export function meteoalarmHazard(said: string): AlertType {
  switch (said.trim().toLowerCase()) {
    case "wind":
    case "thunderstorm":
      return "thunderstorm";
    case "snow-ice":
    case "low-temperature":
    case "avalanches":
      return "winter";
    case "high-temperature":
      return "heat";
    case "forest-fire":
      return "fire";
    case "rain":
    case "flooding":
    case "rain-flood":
    case "coastalevent":
      return "flood";
    default:
      return "other";
  }
}

/** CAP's own severity, which is the scale this layer already ranks on. */
export function meteoalarmSeverity(said: string): AlertSeverity {
  switch (said.trim().toLowerCase()) {
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

/**
 * The colour and the hazard out of an entry's title.
 *
 * MeteoAlarm normalises these itself: every title reads "Orange Thunderstorm
 * Warning issued for Switzerland - Luganese". That makes the title the one
 * reliable statement of what a warning is about, across thirty-seven services
 * that each word their own event text differently.
 */
export function titleParts(title: string): {
  colour: string;
  hazard: string;
} | null {
  const said = /^(\S+)\s+(.*?)\s+Warning issued for\s/.exec(title.trim());
  if (!said) return null;
  return { colour: said[1], hazard: said[2] };
}

/**
 * Whether an awareness colour means there is nothing to say.
 *
 * Green is MeteoAlarm's way of publishing "no warnings for this region", and
 * the JSON feed is mostly that: 2,307 of 3,115 entries across twelve
 * countries on the day this was written, with headlines reading "No warnings
 * for Drenthe". The Atom feed carries none of them, which is one of the
 * reasons it is the one read here, and this is the guard that keeps it that
 * way if it ever starts.
 */
export function noAwareness(colour: string): boolean {
  return colour.trim().toLowerCase() === "green";
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function epoch(value: string): number | undefined {
  if (!value) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * A CAP polygon as GeoJSON.
 *
 * CAP writes a ring as space-separated `latitude,longitude` pairs, which is
 * the opposite order to GeoJSON, and closes the ring itself. A ring with
 * fewer than four points is not a polygon and is dropped rather than drawn as
 * a sliver.
 */
export function capRing(said: string): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const pair of said.trim().split(/\s+/)) {
    const [latitude, longitude] = pair.split(",").map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    ring.push([longitude, latitude]);
  }
  if (ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

/** The text of the first child with this tag, or an empty string. */
function child(entry: Element, tag: string): string {
  return text(entry.getElementsByTagName(tag)[0]?.textContent);
}

/**
 * The warnings in force now, in the shape the map already draws.
 *
 * `at` decides what "in force" means and is passed in rather than read from
 * the clock, because these feeds carry both what has already ended and what
 * starts tomorrow: the French JSON feed on the day this was written held
 * sixty-eight warnings, every one of which had expired five days earlier.
 *
 * One Atom entry is one polygon: MeteoAlarm splits an alert by its language,
 * its area and its polygon and puts the three indices in the entry's own
 * identifier. Two entries of the same alert share its CAP identifier, which
 * is what the watch keys on, so a warning covering three valleys is announced
 * once and drawn three times.
 */
export function parseMeteoalarm(
  xml: string,
  options: { at: number; country: string },
): { features: OverlayFeature[]; unshaped: number } {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(translate("alerts.officeUnanswered"));
  }
  const known = METEOALARM_COUNTRIES.find(
    (country) => country.id === options.country,
  );
  const parsed: OverlayFeature[] = [];
  // Warnings in force that this cannot draw, because the service publishes a
  // region code instead of an outline. Twenty-eight of the thirty-seven
  // member services do, so on a busy day over Austria or Spain the map is
  // clean and there are two hundred warnings standing. Counted and said,
  // because a country with nothing drawn must never read as a country with
  // nothing happening.
  let unshaped = 0;

  for (const entry of Array.from(document.getElementsByTagName("entry"))) {
    // A test message, an exercise and a system message are not warnings, and
    // a cancellation is the office saying this one is over.
    if (child(entry, "cap:status") !== "Actual") continue;
    const kindOfMessage = child(entry, "cap:message_type");
    if (kindOfMessage !== "Alert" && kindOfMessage !== "Update") continue;

    const parts = titleParts(child(entry, "title"));
    if (!parts) continue;
    if (noAwareness(parts.colour)) continue;

    const expires = epoch(child(entry, "cap:expires"));
    if (expires !== undefined && expires <= options.at) continue;
    const starts =
      epoch(child(entry, "cap:onset")) ?? epoch(child(entry, "cap:effective"));
    // Not yet in force is not in force. The feeds carry tomorrow's warnings
    // beside today's, and this layer draws what stands now.
    if (starts !== undefined && starts > options.at) continue;

    const severity = meteoalarmSeverity(child(entry, "cap:severity"));
    const identifier = child(entry, "cap:identifier");
    const area = child(entry, "cap:areaDesc");
    // "Orange Thunderstorm Warning", which is MeteoAlarm's own normalised
    // name for it. `cap:event` is each service's own wording and one service
    // publishes a debugging string there.
    const headline = `${parts.colour} ${parts.hazard} Warning`;

    const rings = Array.from(entry.getElementsByTagName("cap:polygon"));
    if (rings.length === 0) {
      unshaped += 1;
      continue;
    }
    for (const said of rings) {
      const ring = capRing(text(said.textContent));
      if (!ring) {
        unshaped += 1;
        continue;
      }
      parsed.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          headline,
          severity,
          severityRank: SEVERITY_RANK[severity],
          // The CAP identifier, which is the alert's own identity. Two
          // polygons of one warning share it on purpose: they are one
          // warning, and the watch should say so once.
          capId: identifier,
          kind: meteoalarmHazard(parts.hazard),
          impact: "",
          impactRank: 0,
          hailSize: "",
          motion: "",
          // The publication rather than the country, because the popup reads
          // this to decide whose heading to write and MeteoAlarm is not an
          // American forecast office.
          agency: "meteoalarm",
          // The service that issued it, where a live warning of theirs has
          // been read. MeteoAlarm alone otherwise, which is true and is
          // better than naming the wrong office.
          office: known?.office ?? "MeteoAlarm",
          url: entryLink(entry) || "https://www.meteoalarm.org/",
          issued: starts,
          expires,
          area,
          // The Atom carries no description and no instruction. They are a
          // request each away and the popup links to the alert instead.
          description: "",
          instruction: "",
        },
      });
    }
  }

  return { features: parsed, unshaped };
}

/** MeteoAlarm's own page for one warning, from the entry's links. */
function entryLink(entry: Element): string {
  for (const link of Array.from(entry.getElementsByTagName("link"))) {
    const href = text(link.getAttribute("href"));
    if (href.startsWith("https://meteoalarm.org")) return href;
  }
  return "";
}

import type { OverlayData } from "./overlays";

/**
 * The zones the National Hurricane Center stamps an advisory with, and how
 * far each is from UTC.
 *
 * Written out rather than handed to a date parser, because these are the
 * office's own abbreviations and no browser agrees about them: `Date.parse`
 * reads "EDT" on some engines and not others, and reads "HST" as nothing
 * anywhere. The Atlantic and both Pacific basins between them use these, and
 * a zone this does not know leaves the advisory in the office's own words
 * rather than guessing an hour.
 */
const ADVISORY_ZONES: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  AST: -4,
  EDT: -4,
  EST: -5,
  CDT: -5,
  CST: -6,
  MDT: -6,
  MST: -7,
  PDT: -7,
  PST: -8,
  AKDT: -8,
  AKST: -9,
  HST: -10,
  SST: -11,
  ChST: 10,
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * When an advisory was issued, from the fixed sentence the office stamps on
 * it: `1100 AM HST Mon Sep 07 2026`, or `200 PM PDT` with no leading zero.
 *
 * Every other clock in this app is the reader's own, and this one was the
 * forecast office's: a reader in Florida had to convert Hawaii time to know
 * whether an advisory was an hour old or six. Returns null for anything that
 * is not that sentence, which leaves the office's words on screen unchanged.
 */
export function advisoryTime(text: string): number | null {
  const said =
    /^(\d{3,4})\s+(AM|PM)\s+([A-Za-z]{2,4})\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})$/.exec(
      text.trim(),
    );
  if (!said) return null;
  const [, clock, meridiem, zone, month, day, year] = said;
  const offset = ADVISORY_ZONES[zone];
  const monthIndex = MONTHS.indexOf(month);
  if (offset === undefined || monthIndex < 0) return null;
  const minutes = Number(clock.slice(-2));
  let hours = Number(clock.slice(0, -2));
  if (minutes > 59 || hours < 1 || hours > 12) return null;
  // Noon and midnight are both written twelve, and one of them is zero.
  if (hours === 12) hours = 0;
  if (meridiem === "PM") hours += 12;
  const at = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    hours - offset,
    minutes,
  );
  return Number.isFinite(at) ? at : null;
}

export interface ActiveStorm {
  id: string;
  name: string;
  stormType: string;
  windKt: number;
  gustKt: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  advisoryNumber: string;
  /** The advisory's own words, exactly as the office wrote them. */
  advisoryDate: string;
  /** The same moment as a timestamp, or null when it could not be read. */
  advisoryAt: number | null;
  advisoryUrl: string;
}

function pointCoordinates(
  geometry: Record<string, unknown>,
): [number, number] | null {
  if (geometry.type !== "Point") return null;
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [lon, lat] = coordinates.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * The forecast-points layer carries one record per forecast hour. The hour-zero
 * record is where the storm is now, which is the row the panel lists.
 *
 * The storm list at nhc.noaa.gov/CurrentStorms.json would carry the same names
 * but serves no cross-origin header, so the map service is the only feed a
 * browser can read directly.
 */
export function activeStorms(data: OverlayData): ActiveStorm[] {
  const storms: ActiveStorm[] = [];

  for (const feature of data.features) {
    if (feature.properties.kind !== "point") continue;
    // Number(null) is 0, which would read a record with no forecast hour as
    // the storm's current position.
    const tau = feature.properties.tau;
    if (typeof tau !== "number" || tau !== 0) continue;
    const point = pointCoordinates(feature.geometry);
    if (!point) continue;

    const bin = String(feature.properties.bin ?? "").toLowerCase();
    const wind = Number(feature.properties.maxWind);
    storms.push({
      id: bin || `${point[0]},${point[1]}`,
      name: String(feature.properties.name ?? "Unnamed"),
      stormType: String(feature.properties.stormType ?? ""),
      windKt: Number.isFinite(wind) ? wind : 0,
      gustKt: Number(feature.properties.gust) || null,
      pressureMb: Number(feature.properties.pressure) || null,
      lon: point[0],
      lat: point[1],
      advisoryNumber: String(feature.properties.advisory ?? ""),
      advisoryDate: String(feature.properties.advisoryDate ?? ""),
      advisoryAt: advisoryTime(String(feature.properties.advisoryDate ?? "")),
      advisoryUrl: bin ? `https://www.nhc.noaa.gov/graphics_${bin}.shtml` : "",
    });
  }

  return storms.sort((left, right) => right.windKt - left.windKt);
}

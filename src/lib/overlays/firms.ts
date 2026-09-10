import { serviceAnswer } from "../serviceAnswer";
import {
  type OverlayAdapter,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { formatNumber, translate } from "../../i18n";
import { formatClock } from "../units";

/**
 * Where a satellite saw something burning in the last day.
 *
 * The wildfire perimeters layer is what an incident team has drawn, published
 * once the fire is big enough and mapped. This is the other end of it: an
 * instrument looking down twice a day, flagging every pixel hot enough to be
 * a fire, hours after it started and long before anybody has drawn a line
 * around it. Under a smoke plume it is often the only thing that says where
 * the fire actually is.
 *
 * A detection is not a fire. It is a pixel about four hundred metres across
 * that was hot when the satellite went over, and gas flares, furnaces and
 * sun glint all light one up. The popup says the confidence the algorithm
 * gave it and nothing here calls it a wildfire.
 *
 * NASA publishes the last 24 hours as a file per satellite, keyless. It sends
 * no CORS header, so like every other layer here it goes out through the
 * native side.
 */

const HOST = "firms.modaps.eosdis.nasa.gov";

/**
 * The three spacecraft carrying the instrument, and how each one's files are
 * named.
 *
 * All three, because they are the same instrument on three platforms crossing
 * at different times of day: each one left out is a third of the looks gone
 * and a fire that started between the others missed. NOAA-21 was left out of
 * the first version of this and was publishing more detections than either of
 * the two that were in it. Each detection carries the satellite that saw it.
 */
export const FIRMS_SATELLITES: ReadonlyArray<{
  id: string;
  folder: string;
  prefix: string;
}> = [
  {
    id: "Suomi NPP",
    folder: "suomi-npp-viirs-c2",
    prefix: "SUOMI_VIIRS_C2",
  },
  { id: "NOAA-20", folder: "noaa-20-viirs-c2", prefix: "J1_VIIRS_C2" },
  { id: "NOAA-21", folder: "noaa-21-viirs-c2", prefix: "J2_VIIRS_C2" },
];

/**
 * The areas the office publishes the country in.
 *
 * Two files rather than one, because that is how NASA cuts it: the lower
 * forty-eight and Hawaii in one, Alaska in another. Asking only for the first
 * meant no fire in Alaska could ever be drawn, in the state with the largest
 * burned acreage in the country, with nothing on the map saying why. In
 * September the Alaska file is usually empty, which is exactly why nothing
 * noticed.
 */
export const FIRMS_AREAS: ReadonlyArray<string> = [
  "USA_contiguous_and_Hawaii",
  "Alaska",
];

export const FIRMS_ATTRIBUTION =
  '<a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>';

/**
 * How often the files are asked for.
 *
 * Each satellite goes over twice a day and the files are rebuilt as passes
 * are processed, so an hour is already more often than there is anything new
 * in them. The item's own figure is at most hourly.
 */
export const FIRMS_REFRESH_MS = 60 * 60_000;

/** Below this a day of detections over the country is one orange smear. */
export const FIRMS_MIN_ZOOM = 4;

/** The columns the file publishes, in the order its header names them. */
const HEADER =
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite," +
  "confidence,version,bright_ti5,frp,daynight";

function reading(token: string | undefined): number | null {
  const trimmed = token?.trim() ?? "";
  // `Number("")` is 0 and finite, and zero is a real fire radiative power.
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * When the satellite went over, as an instant.
 *
 * The date is a plain `YYYY-MM-DD` and the time is four digits of UTC clock
 * with no separator and no zone, which the file's own documentation says is
 * UTC. Unlike the ground networks on this map there is no local clock to
 * preserve: an orbit is a UTC event.
 */
export function acquiredAt(date: string, time: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  // Padded only once there is something to pad. An empty field padded to
  // four zeroes is midnight, which is a real pass time and the wrong one:
  // a detection with no time on it would be drawn as the first second of
  // its day and read as twelve hours older than it is.
  const written = time.trim();
  const clock =
    written === "" ? null : /^(\d{1,2})(\d{2})$/.exec(written.padStart(4, "0"));
  if (!day || !clock) return null;
  const at = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  return Number.isFinite(at) ? at : null;
}

/**
 * Whether a file is one this can read at all.
 *
 * The header is what says the positions still mean what they meant, and it
 * is separate from whether there were any detections: an empty file with the
 * right header is an ordinary quiet day, and a full file with a moved header
 * parses to nothing at all.
 */
export function readable(text: string): boolean {
  return text.split(/\r?\n/)[0]?.trim() === HEADER;
}

/**
 * One file's detections.
 *
 * The header is read rather than assumed, because the columns are what this
 * depends on and a reordered file would otherwise put a longitude where a
 * brightness goes. A row that does not carry a position is dropped.
 */
export function parseFirms(text: string, satellite: string): OverlayFeature[] {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.trim();
  if (header !== HEADER) return [];
  const features: OverlayFeature[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 13) continue;
    const lat = reading(parts[0]);
    const lon = reading(parts[1]);
    if (lat === null || lon === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        satellite,
        // The algorithm's own word, one of low, nominal and high. Kept as it
        // wrote it: it is a term of art in the product's documentation, and
        // renaming somebody's confidence is not translating it.
        confidence: parts[8]?.trim() || null,
        acquiredAt: acquiredAt(parts[5] ?? "", parts[6] ?? ""),
        // Fire radiative power in megawatts, which is how much energy the
        // pixel was radiating and the closest thing here to how big it is.
        frpMw: reading(parts[11]),
        // Brightness temperature of the fire channel, in kelvin.
        brightnessK: reading(parts[2]),
        day: parts[12]?.trim() === "D",
      },
    });
  }
  return features;
}

/**
 * One file's address.
 *
 * Exported so the live contract can ask for each of the six by name. Going
 * through `fetchData` holds them only through `partial`, which says a file
 * went missing without saying which, and the Alaska files are empty from
 * about September to May, so nothing else distinguishes them.
 */
export function url(
  satellite: { folder: string; prefix: string },
  area: string,
) {
  const file = `${satellite.prefix}_${area}_24h`;
  return `https://${HOST}/data/active_fire/${satellite.folder}/csv/${file}.csv`;
}

export const firmsOverlay: OverlayAdapter = {
  id: "firms",
  nameKey: "layer.firms",
  label: "Fire Detections",
  attribution: FIRMS_ATTRIBUTION,
  attributionUrl: "https://firms.modaps.eosdis.nasa.gov/",
  host: HOST,
  refreshMs: FIRMS_REFRESH_MS,
  // One file per satellite for the whole country, so nothing about where the
  // reader is looking is sent and a pan is never a reason to ask again.
  global: true,
  minZoom: FIRMS_MIN_ZOOM,
  fetchData: async (_bounds, signal) => {
    const wanted = FIRMS_SATELLITES.flatMap((satellite) =>
      FIRMS_AREAS.map((area) => ({ satellite, area })),
    );
    const answers = await Promise.all(
      wanted.map(async ({ satellite, area }) => {
        const response = await fetch(cachedUrl(url(satellite, area)), {
          signal,
          headers: { Accept: "text/csv" },
        });
        if (!response.ok) {
          return { satellite, area, features: null, status: response.status };
        }
        const body = await response.text();
        const features = parseFirms(body, satellite.id);
        // A file that answered and parsed to nothing is two different
        // things, and they are worth telling apart. An empty file is an
        // ordinary day in Alaska. A file whose header has moved parses to
        // nothing too, and read as an empty day it would say there are no
        // fires in the country rather than that this cannot be read.
        const understood = readable(body);
        return {
          satellite,
          area,
          features: understood ? features : null,
          status: response.status,
        };
      }),
    );
    const missing = answers.filter((one) => one.features === null);
    if (missing.length === answers.length) {
      throw new Error(
        translate("firms.failed", {
          answer: serviceAnswer(missing[0]?.status ?? 0),
        }),
      );
    }
    // Named once each, however many of a spacecraft's areas went missing:
    // "NOAA-21" rather than "NOAA-21, NOAA-21".
    const quiet = [...new Set(missing.map((one) => one.satellite.id))];
    return {
      type: "FeatureCollection",
      features: answers.flatMap((one) => one.features ?? []),
      // One spacecraft going quiet takes a third of the looks and must not
      // read as a third of the fires having gone out.
      partial:
        quiet.length > 0
          ? translate("firms.partial", { satellites: quiet.join(", ") })
          : undefined,
    } satisfies OverlayData;
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      paint: {
        // Sized by how much energy the pixel was radiating, which is the
        // closest this product comes to saying how big the fire is. The
        // scale is wide, so it is read through its square root: a hundred
        // megawatt fire is ten times a one megawatt fire on the map rather
        // than a hundred times.
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["sqrt", ["coalesce", ["get", "frpMw"], 1]],
          1,
          3,
          10,
          9,
          32,
          16,
        ],
        // Confidence, because a nominal detection and a low one are different
        // claims and the low ones are where the flares and the glint are.
        "circle-color": [
          "match",
          ["coalesce", ["get", "confidence"], "nominal"],
          "high",
          "#ef4444",
          "low",
          "#fcd34d",
          "#f97316",
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(2, 6, 23, 0.65)",
        "circle-opacity": 0.85,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const confidence = properties.confidence;
    if (typeof confidence === "string") {
      lines.push(translate("firms.confidence", { confidence }));
    }
    const frp = properties.frpMw;
    if (typeof frp === "number") {
      lines.push(translate("firms.power", { power: formatNumber(frp, 1) }));
    }
    const brightness = properties.brightnessK;
    if (typeof brightness === "number") {
      lines.push(
        translate("firms.brightness", {
          brightness: formatNumber(brightness),
        }),
      );
    }
    const at = properties.acquiredAt;
    if (typeof at === "number") {
      lines.push(translate("firms.seen", { time: formatClock(at) }));
    }
    // What a detection is and is not, on every popup rather than in a note
    // somebody has to go and find. A hot pixel is not a wildfire, and this
    // layer sits beside one that draws real fire perimeters.
    lines.push(translate("firms.note"));
    const satellite = String(properties.satellite ?? "");
    return {
      title: translate("firms.detection", { satellite }),
      lines,
      url: "https://firms.modaps.eosdis.nasa.gov/",
    };
  },
};

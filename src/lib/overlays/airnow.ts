import { serviceAnswer } from "../serviceAnswer";
import {
  type OverlayAdapter,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { formatNumber, translate } from "../../i18n";

/**
 * What the air is actually like, from the monitors measuring it.
 *
 * The forecast smoke layer is a model's expectation of where smoke goes. This
 * is the other half of that question and the one a reader under a plume is
 * really asking: an instrument on the ground, an hour ago, saying how bad it
 * is to breathe. The two are never the same statement and the panel says
 * which is which.
 *
 * The Environmental Protection Agency publishes the whole reporting network
 * in one file, refreshed every hour, on a public bucket with no key and no
 * account. Every reporting area is in it, worldwide: the American network,
 * the Canadian one, and the State Department's embassy monitors.
 */

const HOST = "files.airnowtech.org";
const FEED = `https://${HOST}/airnow/today/reportingarea.dat`;

export const AIRNOW_ATTRIBUTION =
  '<a href="https://www.airnow.gov/">AirNow, US EPA and partners</a>';

/**
 * How often the file is asked for.
 *
 * The monitors report hourly and the file is rewritten on that cadence, so
 * anything shorter is asking for the same bytes again. The item's own figure
 * is at most hourly and this is exactly that.
 */
export const AIRNOW_REFRESH_MS = 60 * 60_000;

/**
 * Below this the reporting areas are a smear.
 *
 * There are around eight hundred of them reporting at any hour, spread over
 * every populated part of the continent, so this sits where the station plots
 * do rather than where the buoys do.
 */
export const AIRNOW_MIN_ZOOM = 4;

/**
 * The EPA's own scale, as the floor of each band and the colour it is drawn
 * in.
 *
 * These are the six colours the agency publishes and the numbers that define
 * them. The file also carries the category as a word, and the popup shows
 * that word rather than one invented here: it is the agency's own name for
 * the band and it arrives already written.
 */
export const AQI_BANDS: ReadonlyArray<{ at: number; color: string }> = [
  { at: 0, color: "#00e400" },
  { at: 51, color: "#ffff00" },
  { at: 101, color: "#ff7e00" },
  { at: 151, color: "#ff0000" },
  { at: 201, color: "#8f3f97" },
  { at: 301, color: "#7e0023" },
];

/**
 * The columns the file publishes, in order, pipe separated.
 *
 * Named here because the file has no header line at all. Every row carries
 * all of them, so the count is what says a row was understood.
 */
const COLUMNS = 17;

/** A row's day: `O` for one observed today, `Y` for yesterday's summary. */
const OBSERVED = "O";

/**
 * Whether this row is the parameter the area's index is being reported on.
 *
 * An area measures several pollutants and its air quality index is the worst
 * of them, which is what the agency reports and what a reader means by "the
 * AQI here". Drawing every parameter puts five dots on one town saying five
 * different numbers, and the worst one is underneath.
 */
const REPORTING = "Y";

function reading(token: string | undefined): number | null {
  const trimmed = token?.trim() ?? "";
  // `Number("")` is 0 and `Number.isFinite(0)` is true, so a blank left to
  // the parser reads as an index of zero, which is the top of the good band.
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function words(token: string | undefined): string | null {
  const trimmed = token?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The colour the agency gives an index. */
export function aqiColor(aqi: number): string {
  let found = AQI_BANDS[0].color;
  for (const band of AQI_BANDS) {
    if (aqi < band.at) break;
    found = band.color;
  }
  return found;
}

/**
 * The whole file, as one point per reporting area.
 *
 * Rows that are yesterday's summary are dropped, and so is every parameter
 * but the one the index is being reported on. Anything that does not read as
 * a row is skipped rather than failing the layer: one malformed area is not
 * a reason to draw none of them.
 */
export function parseAirNow(text: string): OverlayData {
  const features: OverlayFeature[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < COLUMNS) continue;
    if (parts[5]?.trim() !== OBSERVED) continue;
    if (parts[6]?.trim() !== REPORTING) continue;
    const lat = reading(parts[9]);
    const lon = reading(parts[10]);
    if (lat === null || lon === null) continue;
    const aqi = reading(parts[12]);
    if (aqi === null) continue;
    const area = words(parts[7]);
    if (area === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        area,
        state: words(parts[8]),
        // Kept as the file writes them: a local clock and the zone it is in.
        // The file carries no offset and no date on the hour, so turning
        // this into an instant would mean guessing the zone from its
        // abbreviation, and "CST" alone is three different zones.
        hour: words(parts[2]),
        zone: words(parts[3]),
        parameter: words(parts[11]),
        aqi,
        // The agency's own name for the band, which is what it publishes and
        // what every sign and forecast in the country repeats.
        category: words(parts[13]),
        actionDay: parts[14]?.trim() === "Yes",
        agency: words(parts[16]),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export const airnowOverlay: OverlayAdapter = {
  id: "airnow",
  nameKey: "layer.airnow",
  label: "Air Quality",
  attribution: AIRNOW_ATTRIBUTION,
  attributionUrl: "https://www.airnow.gov/",
  host: HOST,
  refreshMs: AIRNOW_REFRESH_MS,
  // One file for the whole network, so the viewport it is handed says nothing
  // about what to ask for and a pan is never a reason to ask again.
  global: true,
  minZoom: AIRNOW_MIN_ZOOM,
  fetchData: async (_bounds, signal) => {
    const response = await fetch(cachedUrl(FEED), {
      signal,
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
      throw new Error(
        translate("airnow.failed", { answer: serviceAnswer(response.status) }),
      );
    }
    return parseAirNow(await response.text());
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          AIRNOW_MIN_ZOOM,
          4,
          10,
          9,
        ],
        // The agency's six bands, written out because the map's own type
        // wants a tuple rather than a list. `the paint draws the bands the
        // key names` holds this against `AQI_BANDS`, so the two cannot
        // drift into disagreeing about what colour a reading is.
        "circle-color": [
          "step",
          ["get", "aqi"],
          "#00e400",
          51,
          "#ffff00",
          101,
          "#ff7e00",
          151,
          "#ff0000",
          201,
          "#8f3f97",
          301,
          "#7e0023",
        ],
        // A dark ring rather than a light one: the good band is a bright
        // green and the hazardous band is nearly black, and a light stroke
        // makes the worst reading on the map the faintest dot on it.
        "circle-stroke-width": 1.25,
        "circle-stroke-color": "rgba(2, 6, 23, 0.7)",
        "circle-opacity": 0.92,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const aqi = properties.aqi;
    const category = properties.category;
    if (typeof aqi === "number") {
      lines.push(
        typeof category === "string"
          ? translate("airnow.index", {
              aqi: formatNumber(aqi),
              category,
            })
          : translate("airnow.indexAlone", { aqi: formatNumber(aqi) }),
      );
    }
    const parameter = properties.parameter;
    if (typeof parameter === "string") {
      // The pollutant the index is being reported on, in the agency's own
      // notation: `PM2.5` is what every sign and forecast says.
      lines.push(translate("airnow.parameter", { parameter }));
    }
    if (properties.actionDay === true) {
      lines.push(translate("airnow.actionDay"));
    }
    const hour = properties.hour;
    const zone = properties.zone;
    if (typeof hour === "string") {
      lines.push(
        typeof zone === "string"
          ? translate("airnow.measured", { hour, zone })
          : translate("airnow.measuredAlone", { hour }),
      );
    }
    const agency = properties.agency;
    if (typeof agency === "string") lines.push(agency);
    const area = String(properties.area ?? "");
    const state = properties.state;
    return {
      title:
        typeof state === "string"
          ? translate("airnow.area", { area, state })
          : area,
      lines,
      url: "https://www.airnow.gov/",
    };
  },
};

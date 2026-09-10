import { serviceAnswer } from "../serviceAnswer";
import {
  type OverlayAdapter,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { formatNumber, translate } from "../../i18n";
import {
  formatClock,
  isMetric,
  speedFromMetres,
  speedUnit,
  temperatureFromCelsius,
  temperatureUnit,
} from "../units";

/**
 * What the water is actually doing, from the buoys moored in it.
 *
 * Every marine forecast on the map is a model. These are the instruments: a
 * hull in the water reporting the wind over it, the height of the sea it is
 * riding and the pressure above it, updated hourly. In a storm the buoy
 * offshore is the only thing that has already seen what is coming ashore, and
 * a wave height beside a hurricane track is the difference between a forecast
 * and a measurement.
 *
 * The National Data Buoy Center publishes every station's latest observation
 * in one file for the whole world, about a hundred kilobytes of it. That is
 * the whole design of this layer: one request answers every viewport, so the
 * feed is asked once and panning never asks again. NDBC asks callers to
 * retrieve as little as they can, and one national file every ten minutes is
 * as little as this can be.
 *
 * It sends no CORS header, so like every other layer here it goes out through
 * the native side.
 */

const HOST = "www.ndbc.noaa.gov";
const FEED = `https://${HOST}/data/latest_obs/latest_obs.txt`;

/**
 * How often the whole country is asked for.
 *
 * The stations report hourly and the file carries a ten minute max-age of its
 * own, so this is the file's own cadence rather than a number chosen here.
 */
export const BUOY_REFRESH_MS = 10 * 60_000;

/**
 * Below this the coast is a line and the buoys along it are a smear.
 *
 * Lower than the station plots, because there are nine hundred of these in
 * the world against tens of thousands of airports, and they are spread along
 * coastlines rather than packed into cities.
 */
export const BUOY_MIN_ZOOM = 4;

/**
 * What the service writes where an instrument had nothing to say.
 *
 * Every column is present on every row, so a missing reading is this rather
 * than a short line. Reading it as a number gives `NaN`, which would draw a
 * buoy with no wind as a buoy reporting nothing at all: the same thing on
 * screen and a different thing entirely.
 */
const MISSING = "MM";

/**
 * The columns the file publishes, in order.
 *
 * Named here rather than parsed out of the header, because the header is two
 * comment lines and the second is units rather than names. Every row carries
 * all of them; the count is what says a row was understood.
 */
const COLUMNS = 22;

function reading(token: string | undefined): number | null {
  if (token === undefined || token === MISSING) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/**
 * One station's line, as latitude, longitude and whatever it measured.
 *
 * A row with no position is dropped rather than placed at null island, which
 * is a real place in the Gulf of Guinea and has a buoy of its own.
 */
function parseRow(line: string): OverlayFeature | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== COLUMNS) return null;
  const [
    station,
    latitude,
    longitude,
    year,
    month,
    day,
    hour,
    minute,
    windFrom,
    windMs,
    gustMs,
    waveM,
    dominantPeriod,
    averagePeriod,
    waveFrom,
    pressureHpa,
    pressureTendency,
    airC,
    waterC,
    dewpointC,
    visibilityNmi,
    tideFt,
  ] = parts;
  const lat = reading(latitude);
  const lon = reading(longitude);
  if (lat === null || lon === null) return null;

  // The stamp is UTC, which the file's own header says in its second line and
  // the service says on the page it is published from.
  const at = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      station,
      observedAt: Number.isFinite(at) ? at : null,
      windFrom: reading(windFrom),
      windMs: reading(windMs),
      gustMs: reading(gustMs),
      waveM: reading(waveM),
      dominantPeriod: reading(dominantPeriod),
      averagePeriod: reading(averagePeriod),
      waveFrom: reading(waveFrom),
      pressureHpa: reading(pressureHpa),
      pressureTendency: reading(pressureTendency),
      airC: reading(airC),
      waterC: reading(waterC),
      dewpointC: reading(dewpointC),
      visibilityNmi: reading(visibilityNmi),
      tideFt: reading(tideFt),
    },
  };
}

/**
 * The whole file, as features.
 *
 * The two comment lines at the top are the header and its units, and anything
 * else that does not read as a row is skipped rather than failing the layer:
 * one malformed station is not a reason to draw none of them.
 */
export function parseBuoys(text: string): OverlayData {
  const features: OverlayFeature[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const feature = parseRow(line);
    if (feature) features.push(feature);
  }
  return { type: "FeatureCollection", features };
}

/** A wind the reader can read, or nothing where the buoy had none. */
function windLine(properties: Record<string, unknown>): string | null {
  const speed = properties.windMs;
  if (typeof speed !== "number") return null;
  const from = properties.windFrom;
  const gust = properties.gustMs;
  const said = `${Math.round(speedFromMetres(speed))} ${speedUnit()}`;
  const gusting =
    typeof gust === "number"
      ? translate("buoys.gusting", {
          speed: `${Math.round(speedFromMetres(gust))} ${speedUnit()}`,
        })
      : "";
  if (typeof from !== "number") {
    return `${translate("buoys.wind")}: ${said}${gusting}`;
  }
  return `${translate("buoys.wind")}: ${translate("buoys.windFrom", {
    from: Math.round(from),
    speed: said,
  })}${gusting}`;
}

/**
 * A wave height in the reader's own units.
 *
 * Metres or feet rather than the metres the file publishes, because a wave
 * height is the one number on this layer a reader compares against a forecast
 * they were given in their own units.
 */
function waveLine(properties: Record<string, unknown>): string | null {
  const height = properties.waveM;
  if (typeof height !== "number") return null;
  // Through the formatter rather than `toFixed`, which writes a point where a
  // Spanish or French reader expects a comma.
  const said = isMetric()
    ? `${formatNumber(height, 1)} m`
    : `${formatNumber(height * 3.28084, 1)} ft`;
  const period = properties.dominantPeriod;
  return typeof period === "number" && period > 0
    ? `${translate("buoys.waves")}: ${translate("buoys.wavesAt", {
        height: said,
        seconds: Math.round(period),
      })}`
    : `${translate("buoys.waves")}: ${said}`;
}

export const buoysOverlay: OverlayAdapter = {
  id: "buoys",
  nameKey: "layer.buoys",
  label: "Buoys",
  attribution:
    '<a href="https://www.ndbc.noaa.gov/">NOAA National Data Buoy Center</a>',
  attributionUrl: "https://www.ndbc.noaa.gov/",
  host: HOST,
  refreshMs: BUOY_REFRESH_MS,
  // One file for the whole world, so the viewport it is handed says nothing
  // about what to ask for and a pan is never a reason to ask again.
  global: true,
  minZoom: BUOY_MIN_ZOOM,
  fetchData: async (_bounds, signal) => {
    const response = await fetch(cachedUrl(FEED), {
      signal,
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
      throw new Error(
        translate("buoys.failed", { answer: serviceAnswer(response.status) }),
      );
    }
    return parseBuoys(await response.text());
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
          BUOY_MIN_ZOOM,
          3,
          10,
          6,
        ],
        // Sea state, which is what this layer is read for. A buoy that is not
        // reporting a wave height keeps the calm colour rather than being
        // dropped: it is still a station, and the popup says what it has.
        "circle-color": [
          "step",
          ["coalesce", ["get", "waveM"], 0],
          "#38bdf8",
          1.25,
          "#4ade80",
          2.5,
          "#facc15",
          4.0,
          "#fb923c",
          6.0,
          "#f43f5e",
        ],
        "circle-stroke-width": 1.25,
        "circle-stroke-color": "rgba(2, 6, 23, 0.65)",
        "circle-opacity": 0.9,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const wind = windLine(properties);
    if (wind) lines.push(wind);
    const waves = waveLine(properties);
    if (waves) lines.push(waves);
    const pressure = properties.pressureHpa;
    if (typeof pressure === "number") {
      lines.push(
        `${translate("buoys.pressure")}: ${formatNumber(pressure, 1)} hPa`,
      );
    }
    const water = properties.waterC;
    if (typeof water === "number") {
      lines.push(
        `${translate("buoys.water")}: ${Math.round(
          temperatureFromCelsius(water),
        )}${temperatureUnit()}`,
      );
    }
    const air = properties.airC;
    if (typeof air === "number") {
      lines.push(
        `${translate("buoys.air")}: ${Math.round(
          temperatureFromCelsius(air),
        )}${temperatureUnit()}`,
      );
    }
    const observed = properties.observedAt;
    if (typeof observed === "number") {
      lines.push(translate("buoys.observed", { time: formatClock(observed) }));
    }
    const station = String(properties.station ?? "");
    return {
      title: translate("buoys.station", { station }),
      lines,
      url: `https://www.ndbc.noaa.gov/station_page.php?station=${encodeURIComponent(
        station.toLowerCase(),
      )}`,
    };
  },
};

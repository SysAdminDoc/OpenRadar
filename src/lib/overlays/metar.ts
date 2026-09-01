import {
  type OverlayAdapter,
  type OverlayBounds,
  type OverlayData,
  type OverlayFeature,
} from "./registry";
import { cachedUrl } from "../tileCache";
import { translate } from "../../i18n";
import {
  formatClock,
  isMetric,
  temperatureFromCelsius,
  temperatureUnit,
} from "../units";
import { barbId, stationPlotImages } from "../stationPlot";

/**
 * Surface observations, as the station plots everybody already reads.
 *
 * This is the layer people pay for elsewhere. It is what the airport nearest
 * a storm is actually reporting: the wind, the temperature and dewpoint, how
 * much sky is covered. Radar says where the rain is and says nothing about
 * whether the air under it will support anything, and a plot at a station is
 * the oldest answer to that question there is.
 *
 * The Aviation Weather Center publishes it keyless, minute by minute, filtered
 * to a bounding box. It sends no CORS header, so like every other layer here
 * it goes out through the native side.
 */

const HOST = "aviationweather.gov";
const SERVICE = `https://${HOST}/api/data/metar`;

/**
 * The closest two plots are allowed to be, as a fraction of the screen's own
 * width.
 *
 * A station model is a disc, a staff and two numbers, about thirty pixels
 * across. Below this they overlap into a smear, and the country has enough
 * airports to do that at any zoom this layer is on at. A twenty-fifth of the
 * screen is roughly fifty pixels on an ordinary window, so the plots read.
 *
 * Thinned here rather than left to MapLibre's own collision: a plot is four
 * layers, and letting each of them drop independently leaves a barb with
 * nobody's temperature beside it.
 */
export const METAR_SPACING = 1 / 25;

/**
 * Below this the plots collide into a smear, and the box is most of a
 * continent. The layer says so beside the switch rather than drawing it.
 */
export const METAR_MIN_ZOOM = 6;

function number(value: unknown): number | null {
  // An empty string is not a zero. `Number("")` is, which would plot a
  // missing temperature as freezing rather than leaving the corner blank.
  if (typeof value === "string" && value.trim() === "") return null;
  const held = typeof value === "string" ? Number(value) : value;
  return typeof held === "number" && Number.isFinite(held) ? held : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One answer from the service, as points the map can place.
 *
 * A station with no wind, no temperature or no sky is kept: a plot with a
 * gap in it is what the observation actually said, and dropping the station
 * would say the airport is not there.
 */
export function parseMetars(payload: unknown): OverlayData {
  const rows = Array.isArray(payload) ? payload : [];
  const features: OverlayFeature[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const lat = number(row.lat);
    const lon = number(row.lon);
    if (lat === null || lon === null) continue;

    const speed = number(row.wspd);
    const direction = number(row.wdir);
    // Variable wind reports a direction of "VRB" rather than a number. It has
    // a speed and no way to point a barb, so it is drawn as a plot with no
    // staff rather than as a barb pointing north.
    const steady = direction !== null && speed !== null && speed > 0;

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        id: text(row.icaoId),
        name: text(row.name),
        observed: number(row.obsTime),
        tempC: number(row.temp),
        dewpC: number(row.dewp),
        windDirection: steady ? direction : 0,
        // Kept apart from the direction, because a variable wind has a speed
        // and no way to point a barb. Saying "from 0 degrees" would report a
        // due north wind the station explicitly did not report.
        windVariable: !steady && (speed ?? 0) > 0,
        windKnots: speed ?? 0,
        gustKnots: number(row.wgst),
        // Which of the fixed set of icons this station is drawn with. Worked
        // out here rather than in a map expression, because the rounding to
        // five knots is the convention's and belongs with the drawing.
        barb: steady ? barbId(speed) : "station-barb-0",
        sky: text(row.cover) || "SKC",
        raw: text(row.rawOb),
        flightCategory: text(row.fltCat),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** The temperature as the reader reads it, or nothing when there is none. */
function degrees(value: unknown): string {
  const celsius = number(value);
  if (celsius === null) return "";
  return String(Math.round(temperatureFromCelsius(celsius)));
}

/**
 * A whole-degree label for one Celsius property, in the reader's own scale.
 *
 * Built as an expression rather than written into the features, so the map
 * holds the observation as it arrived and converts it where it is drawn. The
 * whole overlay band is dropped and rebuilt when the reader changes units,
 * the same way it is when they ask for more contrast, so the layer is made
 * again with the other branch of this.
 */
function degreeLabel(field: string): unknown {
  const celsius = ["get", field];
  const shown = isMetric() ? celsius : ["+", ["*", celsius, 1.8], 32];
  return ["case", ["==", celsius, null], "", ["to-string", ["round", shown]]];
}

/**
 * The stations that can be drawn without sitting on top of each other.
 *
 * Nearest the middle of the screen first, then each one kept only if nothing
 * already kept is within the spacing. That is a greedy thinning rather than
 * anything clever, and it is stable in the way that matters: the reader keeps
 * looking at the same airports as the map refreshes, because the order the
 * stations are considered in does not depend on what the service happened to
 * return.
 */
export function thinStations(
  data: OverlayData,
  bounds: OverlayBounds,
): OverlayData {
  const width = Math.abs(bounds.east - bounds.west);
  const gap = width * METAR_SPACING;
  if (!(gap > 0)) return data;
  const middle = {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };
  const at = (feature: OverlayFeature) =>
    (feature.geometry as { coordinates: number[] }).coordinates;
  const ordered = [...data.features].sort((left, right) => {
    const [lx, ly] = at(left);
    const [rx, ry] = at(right);
    const apart =
      (lx - middle.lon) ** 2 +
      (ly - middle.lat) ** 2 -
      ((rx - middle.lon) ** 2 + (ry - middle.lat) ** 2);
    if (apart !== 0) return apart;
    // Two airports exactly the same distance from the middle is not rare, and
    // a sort is stable, so without this the winner is whichever the service
    // happened to list first and the reader's stations change on a refresh
    // that returned the same data in a different order.
    return String(left.properties.id).localeCompare(
      String(right.properties.id),
    );
  });

  const kept: OverlayFeature[] = [];
  for (const feature of ordered) {
    const [lon, lat] = at(feature);
    const clash = kept.some((held) => {
      const [x, y] = at(held);
      // Longitude runs together towards the poles, so the north-south gap is
      // the one in degrees and the east-west gap is measured against it.
      return (
        Math.abs(lon - x) * Math.cos((lat * Math.PI) / 180) < gap &&
        Math.abs(lat - y) < gap
      );
    });
    if (!clash) kept.push(feature);
  }
  return { type: "FeatureCollection", features: kept };
}

export const metarOverlay: OverlayAdapter = {
  id: "metar",
  label: "Surface observations",
  attribution:
    '<a href="https://aviationweather.gov/">NOAA Aviation Weather Center</a>',
  attributionUrl: "https://aviationweather.gov/",
  host: HOST,
  // The service asks for no more than a hundred requests a minute and caches
  // for sixty seconds of its own, so a minute is both polite and as fresh as
  // the answer can be.
  refreshMs: 60_000,
  minZoom: METAR_MIN_ZOOM,
  images: stationPlotImages,
  // The screen exactly, and no more. The service returns fewer stations the
  // larger the box it is given: asking for two and a half times the screen
  // came back with 38 of the 185 that were on it, an arbitrary scatter with
  // the big airports missing. Paying for a request on each pan is the cheaper
  // half of that trade at one a minute against a hundred allowed.
  boundsPadding: 0,
  fetchData: async (bounds: OverlayBounds, signal) => {
    const query = new URLSearchParams({
      format: "json",
      bbox: [bounds.south, bounds.west, bounds.north, bounds.east]
        .map((value) => value.toFixed(3))
        .join(","),
    });
    const response = await fetch(cachedUrl(`${SERVICE}?${query.toString()}`), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `The Aviation Weather Center returned ${response.status}.`,
      );
    }
    return thinStations(parseMetars(await response.json()), bounds);
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-barb`,
      type: "symbol",
      source: sourceId,
      minzoom: METAR_MIN_ZOOM,
      layout: {
        "icon-image": ["get", "barb"],
        "icon-rotate": ["get", "windDirection"],
        "icon-rotation-alignment": "map",
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: `${sourceId}-sky`,
      type: "symbol",
      source: sourceId,
      minzoom: METAR_MIN_ZOOM,
      layout: {
        "icon-image": ["concat", "station-sky-", ["get", "sky"]],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      // Upper left, where a station model puts the temperature.
      id: `${sourceId}-temp`,
      type: "symbol",
      source: sourceId,
      minzoom: METAR_MIN_ZOOM,
      layout: {
        "text-field": degreeLabel("tempC") as never,
        "text-size": 11,
        "text-offset": [-1.5, -0.9],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#f87171",
        "text-halo-color": "#0b0f16",
        "text-halo-width": 1.2,
      },
    },
    {
      // Lower left, where it puts the dewpoint.
      id: `${sourceId}-dewp`,
      type: "symbol",
      source: sourceId,
      minzoom: METAR_MIN_ZOOM,
      layout: {
        "text-field": degreeLabel("dewpC") as never,
        "text-size": 11,
        "text-offset": [-1.5, 0.9],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#4ade80",
        "text-halo-color": "#0b0f16",
        "text-halo-width": 1.2,
      },
    },
  ],
  describe: (properties) => {
    const observed = Number(properties.observed);
    const gust = Number(properties.gustKnots);
    const lines = [
      Number.isFinite(observed)
        ? translate("metar.observed", {
            when: formatClock(observed * 1000),
          })
        : translate("metar.observedUnknown"),
    ];
    const temperature = degrees(properties.tempC);
    const dewpoint = degrees(properties.dewpC);
    if (temperature) {
      lines.push(
        translate("metar.air", {
          temp: temperature,
          dewp: dewpoint || "?",
          unit: temperatureUnit(),
        }),
      );
    }
    const knots = Number(properties.windKnots);
    if (properties.windVariable === true) {
      lines.push(
        translate("metar.windVariable", {
          knots: String(Math.round(knots)),
        }),
      );
    } else if (Number.isFinite(knots) && knots > 0) {
      lines.push(
        Number.isFinite(gust) && gust > 0
          ? translate("metar.windGusting", {
              direction: String(properties.windDirection),
              knots: String(Math.round(knots)),
              gust: String(Math.round(gust)),
            })
          : translate("metar.wind", {
              direction: String(properties.windDirection),
              knots: String(Math.round(knots)),
            }),
      );
    } else {
      lines.push(translate("metar.calm"));
    }
    const raw = String(properties.raw ?? "");
    if (raw) lines.push(raw);
    lines.push(translate("metar.source"));
    return {
      title:
        String(properties.name || properties.id || "").split(",")[0] ||
        translate("metar.station"),
      lines,
    };
  },
};

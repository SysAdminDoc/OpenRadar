import {
  padBounds,
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
 * The most stations one answer may carry.
 *
 * The service caps a query at 400 and a screen full of overlapping plots is
 * unreadable long before that. Past this the layer says it is showing the
 * closest of what it found rather than quietly dropping the rest.
 */
export const METAR_LIMIT = 400;

/**
 * Below this the plots collide into a smear, and the box is most of a
 * continent. The layer says so beside the switch rather than drawing it.
 */
export const METAR_MIN_ZOOM = 6;

function number(value: unknown): number | null {
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
  fetchData: async (bounds: OverlayBounds, signal) => {
    // A little wider than the screen, so a station just off the edge is
    // already there when the reader pans a short way rather than appearing
    // after a round trip.
    const padded = padBounds(bounds, 0.2);
    const query = new URLSearchParams({
      format: "json",
      bbox: [padded.south, padded.west, padded.north, padded.east]
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
    const parsed = parseMetars(await response.json());
    if (parsed.features.length <= METAR_LIMIT) return parsed;
    // The service's own cap, applied here too, because it silently truncates
    // and a truncated answer with no order to it is a random half of the sky.
    const middle = {
      lon: (padded.west + padded.east) / 2,
      lat: (padded.south + padded.north) / 2,
    };
    const near = [...parsed.features].sort((left, right) => {
      const at = (feature: OverlayFeature) => {
        const [lon, lat] = (feature.geometry as { coordinates: number[] })
          .coordinates;
        return (lon - middle.lon) ** 2 + (lat - middle.lat) ** 2;
      };
      return at(left) - at(right);
    });
    return {
      type: "FeatureCollection",
      features: near.slice(0, METAR_LIMIT),
    };
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
        "icon-size": 0.5,
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
        "icon-size": 0.5,
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
    if (Number.isFinite(knots) && knots > 0) {
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

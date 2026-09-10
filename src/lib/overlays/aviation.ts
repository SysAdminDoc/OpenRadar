import { serviceAnswer } from "../serviceAnswer";
import { type OverlayAdapter, type OverlayFeature } from "./registry";
import { cachedUrl } from "../tileCache";
import { formatNumber, translate } from "../../i18n";
import { formatClock } from "../units";

/**
 * What the air is doing to aircraft, from the offices that say so.
 *
 * SIGMETs and AIRMETs are the hazard areas a forecaster drew: thunderstorms,
 * turbulence, icing, mountain obscuration. G-AIRMETs are the same hazards on a
 * three-hourly grid. A centre weather advisory is an air traffic control
 * centre's own short-fuse warning for the airspace it works. And a pilot
 * report is somebody who flew through it and said what it was like, which is
 * the only observation up there: everything else at altitude is a model.
 *
 * A commercial aviation chart costs sixty dollars a year and this is the same
 * public data underneath it. What it is not is a flight planning tool, and the
 * layer says so on every popup rather than in a note somebody has to find.
 *
 * Two services, each because it is the one that answers. The Aviation Weather
 * Center publishes the hazard areas as GeoJSON, including the domestic
 * convective SIGMETs the mapping service does not carry. The mapping service
 * carries the pilot reports and the centre advisories, and it answers with
 * CORS where the other does not.
 */

const AWC = "aviationweather.gov";
const ARCGIS = "mapservices.weather.noaa.gov";
const HAZARDS = `https://${AWC}/api/data`;
const CHARTS = `https://${ARCGIS}/vector/rest/services/aviation/awc_aviation_weather/MapServer`;

/**
 * How often the whole set is asked for.
 *
 * The Aviation Weather Center allows a hundred requests a minute and this is
 * four requests every five minutes, which is a fifth of one per minute per
 * product. The hazard areas are issued hourly and amended between, so five
 * minutes is well inside their own cadence.
 */
export const AVIATION_REFRESH_MS = 5 * 60_000;

/**
 * The most pilot reports drawn at once, newest first.
 *
 * There are a couple of thousand in the air at any moment and the mapping
 * service will send all of them. The newest few hundred is what a map can
 * show and what anybody is looking at: a report from six hours ago is
 * history rather than weather.
 */
export const PIREP_LIMIT = 400;

/** Which of the four a feature came from, which decides how it is drawn. */
export type AviationKind = "sigmet" | "gairmet" | "cwa" | "pirep";

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const held = Number(value);
  return Number.isFinite(held) ? held : null;
}

/**
 * A height the graphical AIRMETs write in hundreds of feet.
 *
 * `410` is flight level 410 and `080` is eight thousand feet. The same fields
 * also carry words where a height would not say it, and those come back as
 * nothing here and as themselves from `levelWord`.
 */
function flightLevel(value: unknown): number | null {
  const hundreds = number(value);
  return hundreds === null ? null : hundreds * 100;
}

/** `SFC` for the surface, `FZL` for the freezing level, and nothing else. */
function levelWord(value: unknown): string | null {
  const said = text(value);
  if (said === null || number(said) !== null) return null;
  return said;
}

/** An ISO stamp or an epoch in milliseconds, as an instant. */
function instant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const said = text(value);
  if (said === null) return null;
  const at = Date.parse(said);
  return Number.isFinite(at) ? at : null;
}

function collection(payload: unknown): OverlayFeature[] {
  const raw = payload as { features?: unknown };
  if (!Array.isArray(raw?.features)) return [];
  return raw.features.filter(
    (one): one is OverlayFeature =>
      !!one &&
      typeof one === "object" &&
      typeof (one as OverlayFeature).geometry === "object",
  );
}

/**
 * A hazard area the Aviation Weather Center drew.
 *
 * Convective SIGMETs and the non-convective ones come back through the same
 * endpoint and are told apart by the hazard on each, not by which was asked
 * for.
 */
function parseAirSigmets(payload: unknown): OverlayFeature[] {
  return collection(payload).map((feature) => {
    const from = feature.properties ?? {};
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        kind: "sigmet" satisfies AviationKind,
        title: text(from.airSigmetType) ?? "SIGMET",
        hazard: text(from.hazard),
        validFrom: instant(from.validTimeFrom),
        validTo: instant(from.validTimeTo),
        lowFeet: number(from.altitudeLow1),
        highFeet: number(from.altitudeHi1),
        lowText: null,
        highText: null,
        severity: null,
        because: null,
        contourFeet: null,
        raw: text(from.rawAirSigmet),
      },
    };
  });
}

/**
 * The same hazards on the three-hourly grid, and the freezing level contours
 * that come with them.
 *
 * The freezing level arrives as a line rather than an area, which is why this
 * layer draws lines at all.
 */
function parseGairmets(payload: unknown): OverlayFeature[] {
  return collection(payload).map((feature) => {
    const from = feature.properties ?? {};
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        kind: "gairmet" satisfies AviationKind,
        title: text(from.product) ?? "G-AIRMET",
        hazard: text(from.hazard),
        // What the forecaster actually said about it. A turbulence area with
        // no severity is the word "turbulence" and nothing else, and an IFR
        // area's whole content is why it is IFR.
        severity: text(from.severity),
        because: text(from.dueTo),
        validFrom: instant(from.validTime),
        validTo: null,
        // The turbulence and icing areas carry a base and a top in hundreds
        // of feet. Only the freezing level contours carry `level`, and
        // reading that alone left every one of those areas, which are the
        // hazards this layer is turned on for, drawn with no altitude at all.
        lowFeet: flightLevel(from.base),
        lowText: levelWord(from.base),
        highFeet: flightLevel(from.top),
        highText: levelWord(from.top),
        // A freezing level contour is a line saying where the freezing level
        // is, not an area reaching up to it.
        contourFeet:
          text(from.hazard) === "FZLVL" ? flightLevel(from.level) : null,
        raw: null,
        forecastHours: number(from.forecast),
      },
    };
  });
}

/** A control centre's own short-fuse advisory for the airspace it works. */
function parseCwas(payload: unknown): OverlayFeature[] {
  return collection(payload).map((feature) => {
    const from = feature.properties ?? {};
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        kind: "cwa" satisfies AviationKind,
        title: text(from.cwsu) ?? "CWA",
        hazard: text(from.hazard),
        validFrom: instant(from.validtimef),
        validTo: instant(from.validtimet),
        // Feet already, which the service says in its own field aliases:
        // "Lowest Altitude in Feet". Treating them as flight levels and
        // multiplying by a hundred put a Miami advisory reading TOPS FL440,
        // which the field carries as 44000, into a popup saying 4,400,000 ft.
        lowFeet: number(from.base),
        highFeet: number(from.top),
        lowText: null,
        highText: null,
        severity: null,
        because: null,
        contourFeet: null,
        raw: text(from.cwatext) ?? text(from.rawtext),
      },
    };
  });
}

/** Somebody who flew through it and said what it was like. */
function parsePireps(payload: unknown): OverlayFeature[] {
  return collection(payload).map((feature) => {
    const from = feature.properties ?? {};
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        kind: "pirep" satisfies AviationKind,
        title: text(from.aircraft_ref) ?? "PIREP",
        hazard: text(from.turbulence_intensity) ?? text(from.icing_intensity),
        validFrom: instant(from.observation_time),
        validTo: null,
        lowFeet: null,
        highFeet: number(from.altitude_ft_msl),
        lowText: null,
        highText: null,
        severity: null,
        because: null,
        contourFeet: null,
        raw: text(from.raw_text),
      },
    };
  });
}

async function ask(
  url: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const response = await fetch(cachedUrl(url), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      translate("aviation.failed", { answer: serviceAnswer(response.status) }),
    );
  }
  return response.json();
}

/** The mapping service's own query string, which wants every part named. */
function chartQuery(fields: string, order: string): string {
  return new URLSearchParams({
    where: "1=1",
    outFields: fields,
    orderByFields: order,
    resultRecordCount: String(PIREP_LIMIT),
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  }).toString();
}

export const aviationOverlay: OverlayAdapter = {
  id: "aviation",
  nameKey: "layer.aviation",
  label: "Aviation hazards",
  attribution:
    '<a href="https://aviationweather.gov/">NOAA Aviation Weather Center</a>',
  attributionUrl: "https://aviationweather.gov/",
  host: AWC,
  refreshMs: AVIATION_REFRESH_MS,
  // Every one of the four answers for the whole country at once, so the
  // viewport says nothing about what to ask for and a pan asks for nothing.
  global: true,
  fetchData: async (_bounds, signal) => {
    const answers = await Promise.allSettled([
      ask(`${HAZARDS}/airsigmet?format=geojson`, signal),
      ask(`${HAZARDS}/gairmet?format=geojson`, signal),
      ask(`${CHARTS}/113/query?${chartQuery("*", "validtimef DESC")}`, signal),
      ask(
        `${CHARTS}/0/query?${chartQuery(
          "observation_time,altitude_ft_msl,raw_text,aircraft_ref,turbulence_intensity,icing_intensity",
          "observation_time DESC",
        )}`,
        signal,
      ),
    ]);
    const readers = [parseAirSigmets, parseGairmets, parseCwas, parsePireps];
    const names = [
      "aviation.sigmets",
      "aviation.gairmets",
      "aviation.cwas",
      "aviation.pireps",
    ] as const;

    const features: OverlayFeature[] = [];
    const missing: string[] = [];
    answers.forEach((answer, at) => {
      if (answer.status === "fulfilled") {
        features.push(...readers[at](answer.value));
        return;
      }
      missing.push(translate(names[at]));
    });
    // One product failing must not read as that hazard being absent, which on
    // this layer is the difference between clear air and nobody answering.
    return missing.length
      ? {
          type: "FeatureCollection",
          features,
          partial: translate("aviation.partial", {
            missing: missing.join(", "),
          }),
        }
      : { type: "FeatureCollection", features };
  },
  layers: (sourceId) => [
    {
      id: `${sourceId}-fill`,
      type: "fill",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "match",
          ["get", "kind"],
          "sigmet",
          "#f43f5e",
          "cwa",
          "#fb923c",
          "#38bdf8",
        ],
        "fill-opacity": 0.12,
      },
    },
    {
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      filter: ["!=", ["geometry-type"], "Point"],
      paint: {
        "line-color": [
          "match",
          ["get", "kind"],
          "sigmet",
          "#f43f5e",
          "cwa",
          "#fb923c",
          "#38bdf8",
        ],
        "line-width": ["match", ["get", "kind"], "sigmet", 2, 1.25],
        "line-opacity": 0.9,
      },
    },
    {
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 9, 5],
        "circle-color": "#facc15",
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(2, 6, 23, 0.65)",
        "circle-opacity": 0.9,
      },
    },
  ],
  describe: (properties) => {
    const lines: string[] = [];
    const hazard = properties.hazard;
    if (typeof hazard === "string") lines.push(hazard);

    const from = properties.validFrom;
    const to = properties.validTo;
    if (typeof from === "number" && typeof to === "number") {
      lines.push(
        translate("aviation.validBetween", {
          from: formatClock(from),
          to: formatClock(to),
        }),
      );
    } else if (typeof from === "number") {
      lines.push(translate("aviation.validAt", { time: formatClock(from) }));
    }

    const severity = properties.severity;
    if (typeof severity === "string") {
      lines.push(translate("aviation.severity", { severity }));
    }

    // A freezing level contour is a line saying where the freezing level is.
    // Read as a ceiling it said the air was hazardous up to eight thousand
    // feet, which is not what a contour means.
    const contour = properties.contourFeet;
    if (typeof contour === "number") {
      lines.push(
        translate("aviation.freezingLevel", { high: formatNumber(contour) }),
      );
    } else {
      // The surface and the freezing level are words rather than heights, and
      // the service writes them where a height would go.
      // Each key named rather than built, so a string is findable by the
      // name it is written under and nothing is left behind when one goes.
      const said = (feet: unknown, word: unknown) => {
        if (word === "SFC") return translate("aviation.sfc");
        if (word === "FZL") return translate("aviation.fzl");
        // Any other word is the service's own and is shown as it wrote it,
        // which is better than dropping the altitude entirely.
        if (typeof word === "string") return word;
        return typeof feet === "number"
          ? translate("aviation.feet", { feet: formatNumber(feet) })
          : null;
      };
      const low = said(properties.lowFeet, properties.lowText);
      const high = said(properties.highFeet, properties.highText);
      if (properties.kind === "pirep") {
        // A pilot report is somebody at that altitude saying what it was
        // like there. It carries one height and it is not a ceiling: read as
        // one it said the turbulence ran from the ground to thirty-nine
        // thousand feet, when what the pilot reported was thirty-nine
        // thousand feet.
        if (high) lines.push(translate("aviation.atLevel", { high }));
      } else if (low && high) {
        lines.push(translate("aviation.between", { low, high }));
      } else if (high) {
        lines.push(translate("aviation.upTo", { high }));
      } else if (low) {
        // A base with no top. Both fields are independently absent on these
        // products and there was no branch for this one, so a hazard with a
        // floor and no ceiling had its altitude dropped entirely.
        lines.push(translate("aviation.from", { low }));
      }
    }

    const because = properties.because;
    if (typeof because === "string") lines.push(because);

    const raw = properties.raw;
    if (typeof raw === "string") lines.push(raw);
    // On every popup rather than in a note somebody has to go and find. This
    // is public weather data drawn on a weather map, and a pilot planning a
    // flight is owed the official briefing rather than this.
    lines.push(translate("aviation.notForFlight"));

    return {
      title: translate("aviation.title", {
        what: String(properties.title ?? ""),
      }),
      lines,
      url: "https://aviationweather.gov/",
    };
  },
};

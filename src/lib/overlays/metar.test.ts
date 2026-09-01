import { afterEach, describe, expect, it } from "vitest";
import {
  METAR_LIMIT,
  METAR_MIN_ZOOM,
  metarOverlay,
  parseMetars,
} from "./metar";
import { setUnits } from "../units";
import { stationPlotImages } from "../stationPlot";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** One row, in the shape the service actually answers with. */
function station(overrides: Record<string, unknown> = {}) {
  return {
    icaoId: "KXBP",
    receiptTime: "2026-09-01T15:42:07.426Z",
    obsTime: 1788276900,
    reportTime: "2026-09-01T15:35:00.000Z",
    temp: 33.8,
    dewp: 18.5,
    wdir: 160,
    wspd: 12,
    visib: "10+",
    altim: 1018.4,
    metarType: "METAR",
    rawOb: "METAR KXBP 011535Z AUTO 16012KT 10SM SCT110 34/19 A3007",
    lat: 33.1729,
    lon: -97.8268,
    elev: 256,
    name: "Bridgeport Muni, TX, US",
    cover: "SCT",
    clouds: [{ cover: "SCT", base: 11000 }],
    fltCat: "VFR",
    ...overrides,
  };
}

afterEach(() => setUnits("imperial"));

describe("reading a surface observation", () => {
  it("places the station and keeps what the plot is drawn from", () => {
    const [feature] = parseMetars([station()]).features;
    expect(feature.geometry).toEqual({
      type: "Point",
      coordinates: [-97.8268, 33.1729],
    });
    expect(feature.properties.id).toBe("KXBP");
    // Celsius as it arrived. The map converts where it draws, so a switch to
    // metric does not have to wait for the next request.
    expect(feature.properties.tempC).toBe(33.8);
    expect(feature.properties.dewpC).toBe(18.5);
    expect(feature.properties.windDirection).toBe(160);
    expect(feature.properties.sky).toBe("SCT");
    // Twelve knots is drawn as ten, which is the convention rounding rather
    // than this file losing two knots: the popup still says twelve.
    expect(feature.properties.barb).toBe("station-barb-10");
  });

  it("keeps a station whose report is missing pieces", () => {
    // An automated station with no cloud sensor reports no cover, and one
    // that cannot see reports no temperature. Dropping either would say the
    // airport is not there.
    const [feature] = parseMetars([
      station({ temp: null, dewp: null, cover: null, wspd: null, wdir: null }),
    ]).features;
    expect(feature.properties.tempC).toBeNull();
    expect(feature.properties.sky).toBe("SKC");
    expect(feature.properties.barb).toBe("station-barb-0");
    expect(feature.properties.windKnots).toBe(0);
  });

  it("draws a variable wind without pointing a barb somewhere", () => {
    // A variable direction comes back as the string VRB. Reading it as a
    // number gives NaN, and a barb rotated by NaN is drawn pointing north,
    // which is a direction the station did not report.
    const [feature] = parseMetars([station({ wdir: "VRB", wspd: 6 })]).features;
    expect(feature.properties.windDirection).toBe(0);
    expect(feature.properties.barb).toBe("station-barb-0");
  });

  it("drops a row with no position rather than putting it at zero", () => {
    expect(parseMetars([station({ lat: null })]).features).toHaveLength(0);
    expect(parseMetars([station({ lon: "nowhere" })]).features).toHaveLength(0);
  });

  it("answers an empty or unexpected payload with no stations", () => {
    expect(parseMetars([]).features).toEqual([]);
    expect(parseMetars(null).features).toEqual([]);
    expect(parseMetars({ stations: [] }).features).toEqual([]);
    expect(parseMetars(["not an object"]).features).toEqual([]);
  });

  it("names an icon the layer actually holds, for every station", () => {
    const names = new Set(stationPlotImages().map((image) => image.id));
    const rows = [0, 3, 7, 12, 48, 63, 140].map((wspd) => station({ wspd }));
    for (const feature of parseMetars(rows).features) {
      expect(names.has(String(feature.properties.barb))).toBe(true);
      expect(names.has(`station-sky-${feature.properties.sky}`)).toBe(true);
    }
  });
});

describe("what the popup says", () => {
  it("gives the reader their own degrees and the raw report", () => {
    const [feature] = parseMetars([station()]).features;
    const said = metarOverlay.describe(feature.properties);
    expect(said.title).toBe("Bridgeport Muni");
    expect(said.lines.join(" ")).toContain("93°F");
    expect(said.lines.join(" ")).toContain("Wind from 160 degrees at 12 kt");
    expect(said.lines.join(" ")).toContain("METAR KXBP");

    setUnits("metric");
    const metric = metarOverlay.describe(feature.properties);
    expect(metric.lines.join(" ")).toContain("34°C");
  });

  it("says a gust when there was one and calm when there was none", () => {
    const gusty = parseMetars([station({ wspd: 18, wgst: 31 })]).features[0];
    expect(metarOverlay.describe(gusty.properties).lines.join(" ")).toContain(
      "gusting 31",
    );
    const still = parseMetars([station({ wspd: 0, wdir: 0 })]).features[0];
    expect(metarOverlay.describe(still.properties).lines.join(" ")).toContain(
      "Calm",
    );
  });
});

describe("what the layer asks the service for", () => {
  it("is switched off below the zoom the plots are legible at", () => {
    expect(metarOverlay.minZoom).toBe(METAR_MIN_ZOOM);
    for (const layer of metarOverlay.layers("s")) {
      expect(layer.minzoom).toBe(METAR_MIN_ZOOM);
    }
  });

  it("registers every icon its own symbols name", () => {
    const held = new Set(metarOverlay.images?.().map((one) => one.id) ?? []);
    expect(held.size).toBeGreaterThan(20);
    expect(held.has("station-sky-OVC")).toBe(true);
    expect(held.has("station-barb-25")).toBe(true);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still answers a bounding box with the fields the plot needs", async () => {
    const data = await metarOverlay.fetchData({
      west: -101,
      south: 33,
      east: -94,
      north: 38,
    });
    // Airports report all day, every day, so an empty answer over this much
    // of the country means the query shape is wrong rather than the weather
    // being quiet.
    expect(data.features.length).toBeGreaterThan(20);
    expect(data.features.length).toBeLessThanOrEqual(METAR_LIMIT);

    const withTemp = data.features.filter(
      (feature) => feature.properties.tempC !== null,
    );
    expect(withTemp.length).toBeGreaterThan(data.features.length / 2);
    for (const feature of data.features) {
      expect(feature.geometry.type).toBe("Point");
      expect(String(feature.properties.id)).toMatch(/^[A-Z0-9]{3,4}$/);
      // The times are epoch seconds, and a report older than a day means the
      // field changed meaning rather than the station being slow.
      const observed = Number(feature.properties.observed);
      expect(Date.now() / 1000 - observed).toBeLessThan(86_400);
    }
  }, 60_000);
});

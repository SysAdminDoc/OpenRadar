import { afterEach, describe, expect, it, vi } from "vitest";
import {
  METAR_MIN_ZOOM,
  METAR_SPACING,
  metarOverlay,
  parseMetars,
  thinStations,
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

afterEach(() => {
  setUnits("imperial");
  vi.unstubAllGlobals();
});

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
    expect(feature.properties.windVariable).toBe(true);
    // And the popup says so rather than reading the placeholder back out as a
    // due north wind the station explicitly did not report.
    const said = metarOverlay.describe(feature.properties).lines.join(" ");
    expect(said).toContain("variable");
    expect(said).not.toContain("from 0 degrees");
  });

  it("reads an empty field as missing rather than as zero", () => {
    // Number("") is 0, so an empty temperature would plot the station at
    // freezing instead of leaving the corner blank.
    const [feature] = parseMetars([station({ temp: "", dewp: "  " })]).features;
    expect(feature.properties.tempC).toBeNull();
    expect(feature.properties.dewpC).toBeNull();
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

    // A variable wind can gust too, and saying only that it is variable loses
    // the number a pilot or a spotter is reading this for.
    const varied = parseMetars([station({ wdir: "VRB", wspd: 9, wgst: 24 })])
      .features[0];
    const said = metarOverlay.describe(varied.properties).lines.join(" ");
    expect(said).toContain("variable");
    expect(said).toContain("24");
  });
});

describe("thinning the plots so they can be read", () => {
  const box = { west: -100, south: 34, east: -96, north: 38 };
  const grid = (step: number) => {
    const rows = [];
    for (let lon = -100; lon < -96; lon += step) {
      for (let lat = 34; lat < 38; lat += step) {
        rows.push(station({ icaoId: `K${rows.length}`, lon, lat }));
      }
    }
    return parseMetars(rows);
  };

  it("keeps every station when they are already far enough apart", () => {
    const spread = grid(1);
    expect(thinStations(spread, box).features).toHaveLength(
      spread.features.length,
    );
  });

  it("drops the ones that would sit on top of each other", () => {
    // A tenth of a degree apart over a four degree screen is a smear: the
    // spacing allows about one station per twenty-fifth of the width.
    const packed = grid(0.1);
    const kept = thinStations(packed, box).features;
    expect(kept.length).toBeLessThan(packed.features.length / 3);
    expect(kept.length).toBeGreaterThan(4);
  });

  it("never leaves two of the ones it kept too close together on screen", () => {
    // Screen distance, which is what must not overlap. Web Mercator makes a
    // degree of latitude taller than a degree of longitude is wide, by
    // 1/cos(lat), so the north-south threshold is the one that shrinks
    // towards the poles.
    const kept = thinStations(grid(0.1), box).features;
    const gap = Math.abs(box.east - box.west) * METAR_SPACING;
    const at = (feature: (typeof kept)[number]) =>
      (feature.geometry as { coordinates: number[] }).coordinates;
    for (const one of kept) {
      for (const other of kept) {
        if (one === other) continue;
        const [ax, ay] = at(one);
        const [bx, by] = at(other);
        const close =
          Math.abs(ax - bx) < gap &&
          Math.abs(ay - by) < gap * Math.cos((ay * Math.PI) / 180);
        expect(close, `${one.properties.id} and ${other.properties.id}`).toBe(
          false,
        );
      }
    }
  });

  it("keeps the plots the same distance apart wherever on Earth they are", () => {
    // The same grid at two latitudes. A ground-distance metric thins the
    // northern one harder, which is the wrong answer: what must not overlap
    // is the plots on the screen, and Mercator has already stretched them.
    const rows = (south: number) => {
      const made = [];
      for (let lon = -100; lon < -96; lon += 0.1) {
        for (let lat = south; lat < south + 4; lat += 0.1) {
          made.push(station({ icaoId: `K${made.length}`, lon, lat }));
        }
      }
      return parseMetars(made);
    };
    const held = (south: number) =>
      thinStations(rows(south), {
        west: -100,
        south,
        east: -96,
        north: south + 4,
      }).features.length;
    const miami = held(25);
    const seattle = held(46);
    expect(Math.abs(miami - seattle) / miami).toBeLessThan(0.2);
  });

  it("keeps the same stations whatever order the service answered in", () => {
    // Nearest the middle first, so a refresh does not swap the reader's
    // airports for a different set that happens to be listed earlier.
    const packed = grid(0.25);
    const shuffled = {
      ...packed,
      features: [...packed.features].reverse(),
    };
    expect(
      thinStations(shuffled, box).features.map((f) => f.properties.id),
    ).toEqual(thinStations(packed, box).features.map((f) => f.properties.id));
  });
});

describe("what the layer asks the service for", () => {
  it("asks for the screen and not a box around it", async () => {
    // Restating the constant would be the same tautology this file's own
    // history is about, so the box the adapter actually sends is read off the
    // request it makes. The service returns fewer stations the larger the box
    // it is given: 2.8 times the screen came back with 38 of the 185 on it,
    // and the screen exactly returns all of them.
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => [station()],
      } as unknown as Response;
    });
    await metarOverlay.fetchData({
      west: -100,
      south: 34,
      east: -96,
      north: 38,
    });
    const bbox = new URL(asked[0]).searchParams.get("bbox");
    expect(bbox).toBe("34.000,-100.000,38.000,-96.000");
    expect(metarOverlay.boundsPadding).toBe(0);
  });

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

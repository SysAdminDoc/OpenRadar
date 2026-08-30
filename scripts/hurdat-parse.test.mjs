import { describe, expect, it } from "vitest";
import {
  STATUSES,
  accumulatedEnergy,
  coordinate,
  parseBasin,
  pointTime,
} from "./hurdat-parse.mjs";

const TS = STATUSES.indexOf("TS");
const HU = STATUSES.indexOf("HU");
const TD = STATUSES.indexOf("TD");

function at(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

describe("coordinates", () => {
  it("signs south and west, and leaves north and east alone", () => {
    expect(coordinate("26.7N")).toBe(26.7);
    expect(coordinate("82.2W")).toBe(-82.2);
    expect(coordinate("13.5S")).toBe(-13.5);
    expect(coordinate("178.9E")).toBe(178.9);
  });

  it("says nothing for a field that is not a number", () => {
    expect(coordinate("")).toBeNull();
    expect(coordinate("-999")).toBe(-999);
    expect(coordinate("nonsense")).toBeNull();
  });
});

describe("point times", () => {
  it("reads the day and the time as UTC", () => {
    expect(pointTime("20220928", "1905")).toBe(at("2022-09-28T19:05:00Z"));
    expect(pointTime("18510625", "0000")).toBe(at("1851-06-25T00:00:00Z"));
  });
});

describe("accumulated cyclone energy", () => {
  it("counts the synoptic hours and nothing else", () => {
    // Two fixes five minutes apart, which is how HURDAT2 records a landfall or
    // a peak beside the regular observation. Only the synoptic one counts.
    const points = [
      [at("2022-09-30T18:00:00Z"), 32.0, -79.0, 70, HU, 0],
      [at("2022-09-30T18:05:00Z"), 32.1, -79.0, 70, HU, 1],
    ];
    expect(accumulatedEnergy(points)).toBe(0.49);
    // Which is what one fix on its own comes to.
    expect(accumulatedEnergy([points[0]])).toBe(0.49);
  });

  it("ignores an off-hour fix whose hour happens to divide by six", () => {
    const points = [
      [at("2023-10-25T12:00:00Z"), 16.9, -99.9, 145, HU],
      [at("2023-10-25T12:30:00Z"), 16.9, -99.9, 145, HU],
      [at("2023-10-25T06:45:00Z"), 16.0, -99.0, 110, HU],
    ];
    expect(accumulatedEnergy(points)).toBe(2.1);
  });

  it("skips anything below tropical storm strength or the wrong kind", () => {
    const points = [
      [at("2022-09-26T00:00:00Z"), 20.0, -80.0, 30, TD],
      [at("2022-09-26T06:00:00Z"), 20.5, -80.5, 45, TS],
      [at("2022-09-26T12:00:00Z"), 21.0, -81.0, 60, TD],
      [at("2022-09-26T18:00:00Z"), 21.5, -81.5, 55, STATUSES.indexOf("EX")],
    ];
    // Only the 45 kt tropical storm fix qualifies.
    expect(accumulatedEnergy(points)).toBe(0.2);
  });
});

describe("parsing a basin", () => {
  const file = [
    "AL092022,                IAN,     4,",
    "20220926, 0000,  , TS, 20.0N,  80.0W,  45, 1000,",
    "20220928, 1200,  , HU, 26.0N,  82.7W, 140,  937,",
    "20220928, 1905, L, HU, 26.7N,  82.2W, 130,  940,",
    "20220930, 1800,  , HU, 32.8N,  79.0W,  70,  977,",
    "EP052023,               DORA,     2,",
    "20230812, 0000,  , HU, 19.0N, 179.8W, 115,  957,",
    "20230812, 0600,  , HU, 19.2N, 178.9E, 115,  957,",
  ].join("\n");

  it("reads the header, the points, and the hemispheres", () => {
    const storms = parseBasin(file, "AL");
    expect(storms).toHaveLength(2);

    const ian = storms[0];
    expect(ian.i).toBe("AL092022");
    expect(ian.n).toBe("IAN");
    expect(ian.y).toBe(2022);
    expect(ian.p).toHaveLength(4);
    // Latitude north, longitude west, wind, status.
    expect(ian.p[2]).toEqual([
      at("2022-09-28T19:05:00Z"),
      26.7,
      -82.2,
      130,
      HU,
      1,
    ]);
    // Only the record HURDAT2 marked with an L is a landfall.
    expect(ian.p.map((point) => point[5])).toEqual([0, 0, 1, 0]);
    // The landfall fix at 1905 must not be counted towards the energy, so
    // this is 45, 140, and 70 knots squared and nothing else.
    expect(ian.a).toBe(2.65);
    expect((45 ** 2 + 140 ** 2 + 70 ** 2) / 10000).toBeCloseTo(2.65, 2);
  });

  it("keeps an eastern longitude positive", () => {
    const dora = parseBasin(file, "EP")[1];
    expect(dora.p[0][2]).toBe(-179.8);
    expect(dora.p[1][2]).toBe(178.9);
  });

  it("steps over the points of one storm to reach the next header", () => {
    const storms = parseBasin(file, "AL");
    expect(storms.map((storm) => storm.i)).toEqual(["AL092022", "EP052023"]);
  });

  it("names an unnamed storm as nothing rather than the word", () => {
    const unnamed = parseBasin(
      [
        "AL011851,            UNNAMED,     1,",
        "18510625, 0000,  , HU, 28.0N,  94.8W,  80, -999,",
      ].join("\n"),
      "AL",
    );
    expect(unnamed[0].n).toBe("");
  });
});

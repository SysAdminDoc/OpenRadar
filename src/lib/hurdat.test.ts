import { describe, expect, it } from "vitest";
import {
  archiveFrames,
  canReplay,
  peakPoint,
  searchStorms,
  stormTrack,
  trackColor,
  type Storm,
} from "./hurdat";

const statuses = ["TD", "TS", "HU"];

function storm(overrides: Partial<Storm> = {}): Storm {
  const track: Storm["track"] = [
    [Date.parse("2022-09-26T00:00:00Z") / 1000, 20.0, -80.0, 45, 1],
    [Date.parse("2022-09-27T00:00:00Z") / 1000, 22.5, -83.0, 125, 2],
    [Date.parse("2022-09-28T18:00:00Z") / 1000, 26.7, -82.2, 140, 2],
    [Date.parse("2022-09-30T00:00:00Z") / 1000, 32.8, -79.0, 70, 2],
  ];
  return {
    id: "AL092022",
    name: "IAN",
    year: 2022,
    basin: "AL",
    ace: 17.96,
    peakWindKt: 140,
    start: track[0][0],
    end: track[track.length - 1][0],
    track,
    statuses,
    ...overrides,
  };
}

describe("storm search", () => {
  const storms = [
    storm(),
    storm({ id: "AL092004", name: "IVAN", year: 2004 }),
    storm({ id: "AL122005", name: "KATRINA", year: 2005 }),
  ];

  it("finds a storm by name and year together", () => {
    expect(searchStorms(storms, "ian 2022").map((s) => s.id)).toEqual([
      "AL092022",
    ]);
    expect(searchStorms(storms, "IAN").map((s) => s.id)).toEqual(["AL092022"]);
    expect(searchStorms(storms, "2005").map((s) => s.name)).toEqual([
      "KATRINA",
    ]);
  });

  it("says nothing for a query too short to mean anything", () => {
    expect(searchStorms(storms, "i")).toEqual([]);
    expect(searchStorms(storms, " ")).toEqual([]);
  });
});

describe("storm track", () => {
  it("draws the line and one coloured point per fix", () => {
    const geojson = stormTrack(storm()) as {
      features: Array<{
        geometry: { type: string };
        properties: Record<string, unknown>;
      }>;
    };
    expect(geojson.features[0].geometry.type).toBe("LineString");
    expect(geojson.features).toHaveLength(5);
    // The peak fix is 140 kt, a category five, so it carries the deepest colour.
    expect(geojson.features[3].properties.color).toBe("#c026d3");
    // The one before it is 125 kt, a category four.
    expect(geojson.features[2].properties.color).toBe("#f43f5e");
    expect(geojson.features[1].properties.label).toBe("TS 45 kt");
  });

  it("colours by the Saffir-Simpson band", () => {
    expect(trackColor(30)).toBe("#94a3b8");
    expect(trackColor(64)).toBe("#facc15");
    expect(trackColor(140)).toBe("#c026d3");
  });

  it("finds the strongest fix", () => {
    expect(peakPoint(storm())[3]).toBe(140);
  });
});

describe("archive replay", () => {
  it("covers three hours either side of the peak in quarter hours", () => {
    const frames = archiveFrames(storm());
    expect(frames).toHaveLength(25);
    expect(frames[0].providerId).toBe("archive");
    expect(frames[12].tileUrl).toContain("USCOMP-N0Q-202209281800");
    expect(frames[1].time - frames[0].time).toBe(900);
    expect(frames.at(-1)!.time).toBeGreaterThan(peakPoint(storm())[0]);
  });

  it("offers nothing for a storm the archive does not reach", () => {
    const old = storm({ year: 1992, id: "AL021992", name: "ANDREW" });
    expect(canReplay(old)).toBe(false);
    expect(archiveFrames(old)).toEqual([]);
  });
});

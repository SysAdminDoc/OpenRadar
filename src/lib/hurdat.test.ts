import { describe, expect, it } from "vitest";
import {
  archiveFrames,
  canReplay,
  peakPoint,
  replayFocus,
  searchStorms,
  stormTrack,
  trackBounds,
  trackColor,
  trackSegments,
  type Storm,
  type TrackPoint,
} from "./hurdat";

const statuses = ["TD", "TS", "HU"];

function at(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/**
 * Ian's real track, abbreviated. The 12:00Z fix is the peak, six hours out in
 * the Gulf; the 19:05Z fix is the Cayo Costa landfall, weaker and later. Which
 * of the two a replay centres on is the whole question.
 */
const IAN_TRACK: TrackPoint[] = [
  [at("2022-09-26T00:00:00Z"), 20.0, -80.0, 45, 1, 0],
  [at("2022-09-27T08:00:00Z"), 22.4, -83.6, 110, 2, 1],
  [at("2022-09-28T12:00:00Z"), 26.0, -82.7, 140, 2, 0],
  [at("2022-09-28T19:05:00Z"), 26.7, -82.2, 130, 2, 1],
  [at("2022-09-30T00:00:00Z"), 32.8, -79.0, 70, 2, 0],
];

function storm(overrides: Partial<Storm> = {}): Storm {
  const track = overrides.track ?? IAN_TRACK;
  return {
    id: "AL092022",
    name: "IAN",
    year: 2022,
    basin: "AL",
    ace: 17.47,
    peakWindKt: Math.max(...track.map((point) => point[3])),
    start: track[0][0],
    end: track[track.length - 1][0],
    fixes: track.length,
    statuses,
    ...overrides,
    track,
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

  it("returns every storm that carried a reused name", () => {
    // Names are reused every six years and retired only after a bad one, so
    // most of them belong to several storms. Answering with the first is
    // answering a different question, and the year on each row is what tells
    // them apart.
    const bonnies = [
      storm({ id: "AL021998", name: "BONNIE", year: 1998 }),
      storm({ id: "AL022004", name: "BONNIE", year: 2004 }),
      storm({ id: "AL032016", name: "BONNIE", year: 2016 }),
    ];
    const found = searchStorms([...storms, ...bonnies], "bonnie");
    expect(found.map((one) => one.year)).toEqual([1998, 2004, 2016]);
    // And naming the year narrows it to the one somebody meant.
    expect(searchStorms([...storms, ...bonnies], "bonnie 2004")).toHaveLength(
      1,
    );
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
    expect(geojson.features[0].geometry.type).toBe("MultiLineString");
    expect(geojson.features).toHaveLength(6);
    // The peak fix is 140 kt, a category five, so it carries the deepest colour.
    expect(geojson.features[3].properties.color).toBe("#c026d3");
    // The landfall fix is 130 kt, a category four.
    expect(geojson.features[4].properties.color).toBe("#f43f5e");
    // This asserted "TS 45 kt", which is the archive's own two-letter code
    // put in front of a reader. The code is what the file holds, not what
    // the point on the map should say.
    expect(geojson.features[1].properties.label).toBe("Tropical storm 45 kt");
  });

  it("says the state of the storm in words, not the archive's code", () => {
    // The nine codes NOAA documents for HURDAT2, which are the nine the
    // shipped index actually uses.
    const codes = ["TD", "TS", "HU", "EX", "SD", "SS", "LO", "WV", "DB"];
    const labels = codes.map((_, at) => {
      const geojson = stormTrack(
        storm({ statuses: codes, track: [[0, 25, -80, 45, at, 0]] }),
      ) as {
        features: Array<{ properties: { label: string } }>;
      };
      return geojson.features[1].properties.label;
    });
    for (const [at, label] of labels.entries()) {
      expect(label, codes[at]).not.toContain(codes[at]);
      expect(label).toContain("45 kt");
    }
    // A code from a file this build has never seen is shown rather than
    // swallowed: somebody can still look it up.
    const strange = stormTrack(
      storm({ statuses: ["ZZ"], track: [[0, 25, -80, 45, 0, 0]] }),
    ) as { features: Array<{ properties: { label: string } }> };
    expect(strange.features[1].properties.label).toBe("ZZ 45 kt");
  });

  it("colours by the Saffir-Simpson band", () => {
    expect(trackColor(30)).toBe("#94a3b8");
    expect(trackColor(64)).toBe("#facc15");
    expect(trackColor(140)).toBe("#c026d3");
  });

  it("finds the strongest fix", () => {
    expect(peakPoint(storm())[3]).toBe(140);
  });

  it("cuts the line where it crosses the date line", () => {
    // Dora 2023 ran west past 180 and kept going.
    const crossing: TrackPoint[] = [
      [at("2023-08-12T00:00:00Z"), 19.0, -179.8, 115, 2, 0],
      [at("2023-08-12T06:00:00Z"), 19.2, 178.9, 115, 2, 0],
      [at("2023-08-12T12:00:00Z"), 19.4, 176.0, 110, 2, 0],
    ];
    const segments = trackSegments(crossing);
    // Cut at the crossing rather than drawn the long way round the world. The
    // piece before the cut is a single point, and a line needs two, so what is
    // left is the piece after it.
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual([
      [178.9, 19.2],
      [176.0, 19.4],
    ]);

    // A track that stays on one side is left whole.
    expect(trackSegments(IAN_TRACK)).toHaveLength(1);
    expect(trackSegments(IAN_TRACK)[0]).toHaveLength(IAN_TRACK.length);
  });
});

describe("framing a track", () => {
  it("measures a plain track the obvious way", () => {
    expect(trackBounds(IAN_TRACK)).toEqual({
      west: -83.6,
      east: -79.0,
      south: 20.0,
      north: 32.8,
    });
  });

  it("measures a date-line track the short way round", () => {
    const crossing: TrackPoint[] = [
      [0, 19.0, -179.8, 115, 2, 0],
      [0, 19.2, 178.9, 115, 2, 0],
      [0, 19.4, 176.0, 110, 2, 0],
    ];
    const bounds = trackBounds(crossing);
    // Four degrees wide across the date line, not three hundred and fifty six
    // degrees the other way. The east edge reads west of the west edge, which
    // is how a box that crosses the line is written.
    expect(bounds.west).toBeCloseTo(176.0, 5);
    expect(bounds.east).toBeCloseTo(-179.8, 5);
    expect(bounds.south).toBeCloseTo(19.0, 5);
    expect(bounds.north).toBeCloseTo(19.4, 5);
  });
});

describe("archive replay", () => {
  it("centres on landfall rather than on peak intensity", () => {
    const focus = replayFocus(storm());
    expect(focus?.landfall).toBe(true);
    // The Cayo Costa landfall, not the 140 kt peak seven hours earlier.
    expect(focus?.point[0]).toBe(at("2022-09-28T19:05:00Z"));
    expect(focus?.point[3]).toBe(130);
  });

  it("ignores a landfall the archive mosaic never saw", () => {
    // Ian's Cuba landfall is south of anything the CONUS mosaic covers.
    const cubaOnly = storm({
      track: [IAN_TRACK[0], IAN_TRACK[1]],
    });
    expect(replayFocus(cubaOnly)).toBeNull();
    expect(canReplay(cubaOnly)).toBe(false);
  });

  it("falls back to the closest approach when a storm never came ashore", () => {
    const offshore = storm({
      track: [
        [at("2022-09-28T00:00:00Z"), 30.0, -75.0, 90, 2, 0],
        [at("2022-09-28T06:00:00Z"), 32.0, -74.0, 100, 2, 0],
      ],
    });
    const focus = replayFocus(offshore);
    expect(focus?.landfall).toBe(false);
    expect(focus?.point[3]).toBe(100);
  });

  it("covers three hours either side of that moment, in quarter hours", () => {
    const frames = archiveFrames(storm());
    expect(frames).toHaveLength(25);
    expect(frames[0].providerId).toBe("archive");
    expect(frames[1].time - frames[0].time).toBe(900);
    // Centred on the 19:05Z landfall, so the middle frame is the quarter hour
    // the archive actually published nearest to it.
    expect(frames[12].tileUrl).toContain("USCOMP-N0Q-202209281900");
    expect(frames[0].tileUrl).toContain("USCOMP-N0Q-202209281600");
    expect(frames.at(-1)!.tileUrl).toContain("USCOMP-N0Q-202209282200");
  });

  it("offers nothing for a storm the archive does not reach", () => {
    const old = storm({ year: 1992, id: "AL021992", name: "ANDREW" });
    expect(canReplay(old)).toBe(false);
    expect(archiveFrames(old)).toEqual([]);
  });

  it("offers nothing for a storm that stayed out of radar range", () => {
    const pacific = storm({
      id: "EP152023",
      name: "HILARY",
      year: 2023,
      track: [
        [at("2023-08-18T18:00:00Z"), 19.4, -110.2, 125, 2, 0],
        [at("2023-08-19T18:00:00Z"), 22.0, -112.0, 110, 2, 0],
      ],
    });
    expect(canReplay(pacific)).toBe(false);
    expect(archiveFrames(pacific)).toEqual([]);
  });
});

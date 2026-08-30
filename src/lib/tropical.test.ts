import { describe, expect, it } from "vitest";
import { activeStorms } from "./tropical";
import { parseTropicalLayer, stormCategory } from "./overlays/tropical";
import type { OverlayData } from "./overlays";

function points(): OverlayData {
  return {
    type: "FeatureCollection",
    features: [
      ...parseTropicalLayer(
        {
          features: [
            {
              geometry: { type: "Point", coordinates: [-138, 13] },
              properties: {
                stormname: "Tropical Storm Lowell",
                stormtype: "TS",
                maxwind: 45,
                gust: 55,
                mslp: 1001,
                advisnum: "10",
                advdate: "500 PM HST Sat Aug 29 2026",
                tau: 0,
                binnumber: "EP2",
              },
            },
            {
              geometry: { type: "Point", coordinates: [-140, 14] },
              properties: { stormname: "Lowell", maxwind: 50, tau: 12 },
            },
            {
              geometry: { type: "Point", coordinates: [-120.2, 17] },
              properties: {
                stormname: "Hurricane Karina",
                maxwind: 85,
                tau: 0,
                binnumber: "EP1",
              },
            },
          ],
        },
        "point",
      ),
      ...parseTropicalLayer(
        {
          features: [
            {
              geometry: { type: "Polygon", coordinates: [] },
              properties: {
                basin: "Atlantic",
                prob2day: "0%",
                risk2day: "Low",
                prob7day: "10%",
                risk7day: "Low",
              },
            },
          ],
        },
        "outlook",
      ),
    ],
  };
}

describe("active storms", () => {
  it("lists the current position of each storm, strongest first", () => {
    const storms = activeStorms(points());
    expect(storms.map((storm) => storm.name)).toEqual([
      "Hurricane Karina",
      "Tropical Storm Lowell",
    ]);
    expect(storms[1].windKt).toBe(45);
    expect(storms[1].pressureMb).toBe(1001);
    expect(storms[1].lat).toBe(13);
    expect(storms[1].advisoryNumber).toBe("10");
  });

  it("links to the official page for the storm's bin", () => {
    expect(activeStorms(points())[0].advisoryUrl).toBe(
      "https://www.nhc.noaa.gov/graphics_ep1.shtml",
    );
  });

  it("ignores forecast positions, outlook areas, and a quiet season", () => {
    const storms = activeStorms(points());
    expect(storms).toHaveLength(2);
    expect(activeStorms({ type: "FeatureCollection", features: [] })).toEqual(
      [],
    );
  });
});

describe("tropical products", () => {
  it("names the Saffir-Simpson band a wind speed falls in", () => {
    expect(stormCategory(25)).toBe("Tropical depression");
    expect(stormCategory(60)).toBe("Tropical storm");
    expect(stormCategory(64)).toBe("Category 1");
    expect(stormCategory(115)).toBe("Category 4");
    expect(stormCategory(160)).toBe("Category 5");
  });

  it("tags each layer so one source can carry the whole package", () => {
    const cone = parseTropicalLayer(
      {
        features: [
          {
            geometry: { type: "Polygon", coordinates: [] },
            properties: { stormname: "Lowell", advisnum: "10", basin: "EP" },
          },
        ],
      },
      "cone",
    );
    expect(cone[0].properties.kind).toBe("cone");
    expect(cone[0].properties.name).toBe("Lowell");
  });

  it("drops a record with no geometry", () => {
    expect(
      parseTropicalLayer(
        { features: [{ properties: { stormname: "X" } }] },
        "track",
      ),
    ).toEqual([]);
  });
});

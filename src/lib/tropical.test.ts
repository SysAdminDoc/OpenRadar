import { describe, expect, it } from "vitest";
import { activeStorms, advisoryTime } from "./tropical";
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

describe("forecast hour", () => {
  it("does not read a record with no forecast hour as the current position", () => {
    const data = {
      type: "FeatureCollection" as const,
      features: parseTropicalLayer(
        {
          features: [
            {
              geometry: { type: "Point", coordinates: [-70, 20] },
              properties: { stormname: "Null Tau", maxwind: 50, tau: null },
            },
            {
              geometry: { type: "Point", coordinates: [-71, 21] },
              properties: { stormname: "Real", maxwind: 40, tau: 0 },
            },
          ],
        },
        "point",
      ),
    };
    expect(activeStorms(data).map((storm) => storm.name)).toEqual(["Real"]);
  });
});

describe("the advisory address", () => {
  /** One storm at forecast hour zero, with whatever bin the feed sent. */
  function withBin(binnumber: string): OverlayData {
    return {
      type: "FeatureCollection",
      features: parseTropicalLayer(
        {
          features: [
            {
              geometry: { type: "Point", coordinates: [-70, 25] },
              properties: {
                stormname: "Ida",
                stormtype: "HU",
                maxwind: 90,
                tau: 0,
                binnumber,
              },
            },
          ],
        },
        "point",
      ),
    } as OverlayData;
  }

  it("is https at the hurricane centre or nothing, whatever the feed sends", () => {
    // The panel renders this straight into an href. It is built here rather
    // than taken from the feed, and this is what says so: a bin carrying a
    // scheme, a host or a path cannot turn it into a link somewhere else.
    for (const bin of [
      "AT1",
      "",
      "//evil.example",
      "https://evil.example/x",
      "javascript:alert(1)",
      "../../../etc",
    ]) {
      const [storm] = activeStorms(withBin(bin));
      const url = storm?.advisoryUrl ?? "";
      if (!url) continue;
      expect(new URL(url).origin, bin).toBe("https://www.nhc.noaa.gov");
    }
  });
});

describe("when an advisory was issued", () => {
  // Every other clock in the app is the reader's own, and this one was the
  // forecast office's: "Advisory 47 · 1100 AM HST Mon Sep 07 2026" beside a
  // timeline and a tide table both showing local time. A reader in Florida
  // had to convert Hawaii time to know whether it was an hour old or six.
  it("reads the sentence the office stamps on it", () => {
    // 11:00 in Hawaii is 21:00 UTC.
    expect(advisoryTime("1100 AM HST Mon Sep 07 2026")).toBe(
      Date.UTC(2026, 8, 7, 21, 0),
    );
    // And an afternoon one with no leading zero on the hour.
    expect(advisoryTime("200 PM PDT Mon Sep 07 2026")).toBe(
      Date.UTC(2026, 8, 7, 21, 0),
    );
  });

  it("knows every zone the office writes", () => {
    // Each of these is a zone the Atlantic or one of the Pacific basins
    // stamps its advisories with. A browser's own date parser reads some of
    // them on some engines and "HST" on none, which is why the table is here.
    const offsets: Array<[string, number]> = [
      ["AST", -4],
      ["EDT", -4],
      ["EST", -5],
      ["CDT", -5],
      ["CST", -6],
      ["MDT", -6],
      ["MST", -7],
      ["PDT", -7],
      ["PST", -8],
      ["AKDT", -8],
      ["AKST", -9],
      ["HST", -10],
      ["SST", -11],
      ["ChST", 10],
      ["UTC", 0],
      ["GMT", 0],
    ];
    for (const [zone, offset] of offsets) {
      expect(
        advisoryTime(`900 AM ${zone} Tue Sep 08 2026`),
        `${zone} is a zone the office uses`,
      ).toBe(Date.UTC(2026, 8, 8, 9 - offset, 0));
    }
  });

  it("gets noon and midnight the right way round", () => {
    expect(advisoryTime("1200 AM UTC Mon Sep 07 2026")).toBe(
      Date.UTC(2026, 8, 7, 0, 0),
    );
    expect(advisoryTime("1200 PM UTC Mon Sep 07 2026")).toBe(
      Date.UTC(2026, 8, 7, 12, 0),
    );
  });

  it("says nothing rather than guessing", () => {
    // A sentence it cannot read leaves the office's own words on screen,
    // which is the honest answer and what a reader saw before any of this.
    for (const said of [
      "",
      "Advisory 47",
      "1100 AM XYZ Mon Sep 07 2026",
      "1100 AM HST Mon Zzz 07 2026",
      "1370 AM UTC Mon Sep 07 2026",
      "1100 HST Mon Sep 07 2026",
      "0000 AM UTC Mon Sep 07 2026",
    ]) {
      expect(
        advisoryTime(said),
        `${said || "an empty string"} is not a time`,
      ).toBeNull();
    }
  });

  it("reaches the storm the panel draws", () => {
    // Sorted by wind, so the one carrying an advisory is not the first.
    const storm = activeStorms(points()).find((one) =>
      one.name.includes("Lowell"),
    );
    expect(storm?.advisoryDate).toBe("500 PM HST Sat Aug 29 2026");
    // Five in the afternoon in Hawaii is three the next morning in UTC.
    expect(storm?.advisoryAt).toBe(Date.UTC(2026, 7, 30, 3, 0));
  });

  it("leaves a storm with no advisory sentence with nothing to show", () => {
    const storm = activeStorms(points()).find((one) =>
      one.name.includes("Karina"),
    );
    expect(storm?.advisoryDate).toBe("");
    expect(storm?.advisoryAt).toBeNull();
  });
});

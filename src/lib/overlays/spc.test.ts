import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  HATCH_IMAGE,
  outlookPage,
  archiveOutlookUrl,
  parseArchiveOutlooks,
  SPC_DAYS,
  SPC_HAZARDS,
  hatch,
  outlookLayers,
  outlookTime,
  parseDiscussions,
  parseOutlooks,
  spcDiscussionsOverlay,
  spcOutlooksOverlay,
} from "./spc";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** The shape the service answers with, taken from a real response. */
function outlookFeature(
  dn: number,
  label: string,
  risk: string,
  fill: string,
  stroke: string,
) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-100, 35],
          [-99, 35],
          [-99, 36],
          [-100, 36],
          [-100, 35],
        ],
      ],
    },
    properties: {
      dn,
      label,
      label2: risk,
      valid: "202608301630",
      expire: "202608311200",
      issue: "202608301629",
      fill,
      stroke,
    },
  };
}

describe("the Storm Prediction Center's outlook", () => {
  it("reads the service's own stamps as UTC", () => {
    // Twelve digits, no separators and no zone marker, so it cannot be parsed
    // as a date string: read as local time it would be off by the offset.
    expect(outlookTime("202608301630")).toBe(Date.UTC(2026, 7, 30, 16, 30));
    expect(outlookTime("")).toBeNull();
    expect(outlookTime("2026-08-30T16:30Z")).toBeNull();
    expect(outlookTime(20260830163_0)).toBeNull();
  });

  it("hands the strongest risk to the map last", () => {
    // A GeoJSON source draws its features in order, so the last one wins where
    // two overlap. The service returns them cut out of each other rather than
    // nested, so today this changes nothing that can be seen; it is here so
    // that a service which stops doing that, or a probabilistic layer where
    // the areas do overlap, cannot bury a High under a Marginal.
    const parsed = parseOutlooks({
      features: [
        outlookFeature(6, "HIGH", "High Risk", "#FF00FF", "#CC00CC"),
        outlookFeature(
          2,
          "TSTM",
          "General Thunderstorms Risk",
          "#C1E9C1",
          "#55BB55",
        ),
        outlookFeature(4, "SLGT", "Slight Risk", "#FFE066", "#DDAA00"),
      ],
    });

    expect(parsed.features.map((feature) => feature.properties.label)).toEqual([
      "TSTM",
      "SLGT",
      "HIGH",
    ]);
  });

  it("paints in the colours the outlook is published in", () => {
    const [feature] = parseOutlooks({
      features: [
        outlookFeature(4, "SLGT", "Slight Risk", "#FFE066", "#DDAA00"),
      ],
    }).features;

    expect(feature.properties.fill).toBe("#FFE066");
    expect(feature.properties.stroke).toBe("#DDAA00");
    expect(feature.properties.valid).toBe(Date.UTC(2026, 7, 30, 16, 30));
  });

  it("skips a record with no risk level rather than drawing a grey blob", () => {
    const parsed = parseOutlooks({
      features: [
        { type: "Feature", geometry: { type: "Polygon" }, properties: {} },
        { type: "Feature", properties: { dn: 4 } },
        outlookFeature(4, "SLGT", "Slight Risk", "#FFE066", "#DDAA00"),
      ],
    });
    expect(parsed.features).toHaveLength(1);
  });
});

describe("mesoscale discussions", () => {
  it("drops the placeholder the service answers with when nothing is active", () => {
    // With no discussions out, the service still returns one feature called
    // NoArea: a polygon a thousandth of a degree across. Drawn, it is a speck
    // in the Gulf that means nothing at all.
    const parsed = parseDiscussions({
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { name: "NoArea", idp_filedate: 1788095861000 },
        },
      ],
    });
    expect(parsed.features).toEqual([]);
  });

  it("keeps a real discussion with what it says", () => {
    const parsed = parseDiscussions({
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            name: "MD 1783",
            popupinfo: "Severe thunderstorms are expected to develop.",
            idp_filedate: 1788095861000,
          },
        },
      ],
    });
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].properties.name).toBe("MD 1783");
    expect(parsed.features[0].properties.issued).toBe(1788095861000);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  const bounds = { west: -104, south: 30, east: -90, north: 42 };

  it("reads today's outlook", async () => {
    const data = await spcOutlooksOverlay.fetchData(
      bounds,
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // There is a Day 1 outlook every day, even if it is only a thunderstorm
    // area somewhere, so an empty answer over the middle of the country means
    // the query shape is wrong rather than the weather being quiet.
    expect(data.features.length).toBeGreaterThan(0);
    for (const feature of data.features) {
      expect(String(feature.properties.fill)).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(feature.properties.valid).toBeTypeOf("number");
      expect(feature.geometry.type).toMatch(/Polygon/);
    }
  }, 30_000);

  it("reads the discussions without the placeholder", async () => {
    const data = await spcDiscussionsOverlay.fetchData(
      bounds,
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    // The shape, because the weather decides the rest: there is no mesoscale
    // discussion at all on a quiet afternoon, and a contract that demanded
    // one would fail on the days when nothing is happening. What the service
    // moving would break is the collection itself.
    expect(data.type).toBe("FeatureCollection");
    expect(Array.isArray(data.features)).toBe(true);
    for (const feature of data.features) {
      expect(String(feature.properties.name).toLowerCase()).not.toBe("noarea");
      expect(feature.geometry.type).toMatch(/Polygon/);
    }
  }, 30_000);
});

describe("which layer a day and a hazard read from", () => {
  it("names the numbers the service actually publishes", () => {
    // Read 2026-09-04 off `SPC_wx_outlks/MapServer?f=pjson`. There is no
    // pattern to derive: Day 1 and Day 2 carry a categorical and three
    // hazards, Day 3 a categorical and one combined probability, and Days 4
    // to 8 a probability and nothing else.
    expect(outlookLayers(1, "categorical")).toEqual({
      probability: 1,
      significant: null,
    });
    expect(outlookLayers(1, "tornado")).toEqual({
      probability: 3,
      significant: 2,
    });
    expect(outlookLayers(1, "hail")).toEqual({
      probability: 5,
      significant: 4,
    });
    expect(outlookLayers(1, "wind")).toEqual({
      probability: 7,
      significant: 6,
    });

    expect(outlookLayers(2, "categorical")).toEqual({
      probability: 9,
      significant: null,
    });
    expect(outlookLayers(2, "tornado")).toEqual({
      probability: 11,
      significant: 10,
    });
    expect(outlookLayers(2, "wind")).toEqual({
      probability: 15,
      significant: 14,
    });

    expect(outlookLayers(3, "categorical")).toEqual({
      probability: 17,
      significant: null,
    });
    // Day 3 has one probability whatever hazard is asked for.
    for (const hazard of ["tornado", "hail", "wind"] as const) {
      expect(outlookLayers(3, hazard)).toEqual({
        probability: 19,
        significant: 18,
      });
    }

    // Day 4 is 21 and one per day after it, to Day 8 at 25.
    expect(outlookLayers(4, "categorical")?.probability).toBe(21);
    expect(outlookLayers(8, "tornado")?.probability).toBe(25);
    expect(outlookLayers(8, "tornado")?.significant).toBeNull();
  });

  it("answers for nothing past the last day it publishes", () => {
    expect(outlookLayers(9, "categorical")).toBeNull();
  });

  it("gives every choice its own variant, so a switch is not a stale frame", () => {
    const seen = new Set<string | undefined>();
    for (const day of SPC_DAYS) {
      for (const hazard of SPC_HAZARDS) {
        seen.add(
          spcOutlooksOverlay.variant?.({
            ...DEFAULT_OVERLAY_CHOICES,
            spcDay: day,
            spcHazard: hazard,
          }),
        );
      }
    }
    expect(seen.size).toBe(SPC_DAYS.length * SPC_HAZARDS.length);
    // And it does not move when a choice that is not its own does.
    expect(
      spcOutlooksOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        spcDay: 2,
        wpcDay: 4,
      }),
    ).toBe(
      spcOutlooksOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        spcDay: 2,
        wpcDay: 1,
      }),
    );
  });
});

describe("the hatched area", () => {
  it("is kept, in the shape the conditional intensity layers really send", () => {
    // Read live from `SPC_wx_outlks/MapServer/2?f=pjson` on 2026-09-04:
    // `dn` is an integer on every layer of this service, and the `CIG1` name
    // a reader sees is in `label`, which is the field the renderer draws by.
    // This used to plant `dn: "CIG1"`, a shape the API cannot produce, so it
    // proved nothing about the hatched area against the real service.
    const read = parseOutlooks(
      {
        features: [
          {
            geometry: { type: "Polygon", coordinates: [] },
            properties: {
              dn: 1,
              label: "CIG1",
              label2: "Significant",
              fill: "#000000",
              stroke: "#000000",
            },
          },
        ],
      },
      true,
    );
    expect(read.features).toHaveLength(1);
    expect(read.features[0].properties.significant).toBe(true);
    expect(read.features[0].properties.rank).toBe(1);
  });

  it("is not marked on the bands underneath it", () => {
    const read = parseOutlooks({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: { dn: 15, label: "15%", fill: "#ff8080" },
        },
      ],
    });
    expect(read.features[0].properties.significant).toBe(false);
    expect(read.features[0].properties.rank).toBe(15);
  });

  it("is the only thing the hatch layer draws, and never the bands", () => {
    // The end-to-end test can only see that the layer is on the map, which
    // it is whatever the filter says. Getting these two backwards paints the
    // hatch over every probability band and leaves the significant area
    // solid black, which is a different outlook entirely.
    const drawn = spcOutlooksOverlay.layers("spc");
    const filterOf = (suffix: string) =>
      (
        drawn.find((layer) => layer.id.endsWith(suffix)) as
          { filter?: unknown } | undefined
      )?.filter;
    expect(filterOf("-hatch")).toEqual(["==", ["get", "significant"], true]);
    expect(filterOf("-fill")).toEqual(["!=", ["get", "significant"], true]);
  });

  it("has a pattern to draw with, tiling on both axes", () => {
    // MapLibre has no hatch of its own, so the fill names an image and the
    // adapter has to register it or the area draws as nothing at all.
    const tile = hatch(8);
    expect(tile.width).toBe(8);
    expect(tile.height).toBe(8);
    expect(tile.data.length).toBe(8 * 8 * 4);
    // Something is drawn on every row, which is what makes it a hatch rather
    // than a single line.
    for (let row = 0; row < 8; row += 1) {
      const opaque = Array.from({ length: 8 }, (_, across) => {
        return tile.data[(row * 8 + across) * 4 + 3];
      }).filter((alpha) => alpha > 0);
      expect(opaque.length).toBeGreaterThan(0);
    }
    expect(spcOutlooksOverlay.images?.()[0].id).toBe(HATCH_IMAGE);
  });
});

describe("the outlook that stood over a replayed day", () => {
  it("asks the archive for that day, once, with a named issuance", () => {
    // One request per replay rather than one per frame: an outlook is issued
    // a few times a day and does not change as a loop steps through an
    // afternoon. `cycle=-1` is asked for so this does not have to guess at
    // the hours the Center issues on.
    const url = archiveOutlookUrl(Date.UTC(2011, 3, 27, 20, 30));
    expect(url).toContain("valid=2011-04-27");
    expect(url).toContain("cycle=-1");
    expect(url).toContain("day=1");
    expect(url).toContain("outlook_type=C");
  });

  it("takes the outlook day, which runs from noon and not from midnight", () => {
    // A reader in Iowa replaying the evening of the 27th is on the 28th in
    // UTC for part of it, and a Day 1 outlook covers 12Z to 12Z. Keying on
    // the calendar date instead asked for the outlook issued at noon the
    // following day, which was made after the last replayed frame and covers
    // the afternoon after the one on screen. The 00:00Z case below was
    // asserting exactly that mistake.
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 28, 0, 5))).toContain(
      "valid=2011-04-27",
    );
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 27, 23, 59))).toContain(
      "valid=2011-04-27",
    );
    // Noon is where it turns over, so either side of it is a different day.
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 27, 11, 59))).toContain(
      "valid=2011-04-26",
    );
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 27, 12, 0))).toContain(
      "valid=2011-04-27",
    );
  });

  it("paints the archive in the colours the live service publishes", () => {
    // The archive carries a threshold code and no colours at all, so they
    // come from the live service's own renderer rather than being invented.
    const read = parseArchiveOutlooks({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            threshold: "HIGH",
            category: "CATEGORICAL",
            issue: "2011-04-27T16:30:00Z",
            product_issue: "2011-04-27T16:29:00Z",
            expire: "2011-04-28T12:00:00Z",
          },
        },
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: { threshold: "TSTM", issue: "2011-04-27T16:30:00Z" },
        },
      ],
    });
    // Weakest first, so the strongest ends up drawn on top.
    expect(read.features.map((one) => one.properties.label)).toEqual([
      "TSTM",
      "HIGH",
    ]);
    const high = read.features[1].properties;
    expect(high.fill).toBe("#ee99ee");
    expect(high.stroke).toBe("#cc00cc");
    expect(high.archived).toBe(true);
    expect(high.valid).toBe(Date.parse("2011-04-27T16:30:00Z"));
    expect(high.expire).toBe(Date.parse("2011-04-28T12:00:00Z"));
  });

  it("drops a threshold it has no colour for rather than drawing it grey", () => {
    // A category this does not know is one the service has added, and
    // guessing a colour for it would put an unlabelled band on the map.
    const read = parseArchiveOutlooks({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: { threshold: "SOMETHING NEW" },
        },
      ],
    });
    expect(read.features).toEqual([]);
  });

  it("asks again for a different replay and not for the same one", () => {
    const window = { from: 1, to: 2 };
    const same = spcOutlooksOverlay.variant?.({
      ...DEFAULT_OVERLAY_CHOICES,
      replay: window,
    });
    expect(
      spcOutlooksOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        replay: { from: 1, to: 2 },
      }),
    ).toBe(same);
    expect(
      spcOutlooksOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        replay: { from: 9, to: 10 },
      }),
    ).not.toBe(same);
    // And a replay is never the same question as the live layer, whatever
    // day and hazard are chosen.
    expect(
      spcOutlooksOverlay.variant?.({ ...DEFAULT_OVERLAY_CHOICES }),
    ).not.toBe(same);
  });
});

describe("the outlook day a reader landed on", () => {
  it("sends the popup to that day's page, not always to Day 1", () => {
    // The Center publishes a page per day and one shared page for the
    // extended range. Every popup pointed at Day 1, so following the link off
    // a Day 5 outlook landed on this afternoon's.
    expect(outlookPage(1)).toContain("day1otlk.html");
    expect(outlookPage(3)).toContain("day3otlk.html");
    expect(outlookPage(4)).toContain("day4-8");
    expect(outlookPage(8)).toContain("day4-8");
  });

  it("asks the archive for the day the reader chose", () => {
    // The day picker stayed on screen during a replay and did nothing,
    // because the archive URL was written with Day 1 in it.
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 27, 20), 2)).toContain("day=2");
    expect(archiveOutlookUrl(Date.UTC(2011, 3, 27, 20))).toContain("day=1");
    // And the day is part of the question, so switching it asks again.
    const first = spcOutlooksOverlay.variant?.({
      ...DEFAULT_OVERLAY_CHOICES,
      replay: { from: 1, to: 2 },
      spcDay: 1,
    });
    expect(
      spcOutlooksOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        replay: { from: 1, to: 2 },
        spcDay: 2,
      }),
    ).not.toBe(first);
  });

  it("drops the placeholder a day with no outlook yet publishes", () => {
    // Every field null and a three-point triangle in the Atlantic.
    // `Number(null)` is zero, which is finite, so it passed the rank check,
    // drew in the fallback grey and rendered its popup time as 01-01 00:00.
    // Unreachable until Days 4 to 8 could be chosen.
    const read = parseOutlooks({
      features: [
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            dn: 0,
            label: null,
            label2: null,
            valid: null,
            expire: null,
            issue: null,
          },
        },
        {
          geometry: { type: "Polygon", coordinates: [] },
          properties: { dn: 15, label: "0.15", label2: "15%" },
        },
      ],
    });
    expect(read.features).toHaveLength(1);
    expect(read.features[0].properties.label).toBe("0.15");
  });
});

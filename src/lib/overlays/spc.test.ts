import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  HATCH_IMAGE,
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
  it("is kept rather than dropped for having a name instead of a number", () => {
    // The conditional intensity layers rank by `CIG1` and up. Dropping what
    // will not parse as a number threw the whole hatched area away.
    const read = parseOutlooks(
      {
        features: [
          {
            geometry: { type: "Polygon", coordinates: [] },
            properties: {
              dn: "CIG1",
              label: "SIGN",
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
    expect(read.features[0].properties.rank).toBe(0);
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

import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
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

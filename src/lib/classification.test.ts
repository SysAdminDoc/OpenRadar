import { describe, expect, it } from "vitest";
import {
  classificationFeatures,
  classificationPaint,
  isClassificationProduct,
  type Classification,
} from "./classification";

const REPORT: Classification = {
  station: "KTLX",
  observed: "2026-09-01T17:55:29Z",
  product: "HHC",
  features: [
    {
      class: "rain",
      fromDegrees: 10,
      toDegrees: 11,
      nearKm: 5,
      farKm: 12,
      ring: [
        [-97.3, 35.4],
        [-97.2, 35.4],
        [-97.2, 35.5],
        [-97.3, 35.4],
      ],
    },
    {
      class: "hail",
      fromDegrees: 200,
      toDegrees: 201,
      nearKm: 40,
      farKm: 41,
      ring: [
        [-97.5, 35.1],
        [-97.4, 35.1],
        [-97.4, 35.2],
        [-97.5, 35.1],
      ],
    },
  ],
  legend: [
    { class: "rain", id: "rain", color: "#61d186" },
    { class: "hail", id: "hail", color: "#e27250" },
  ],
};

describe("the classification as the map takes it", () => {
  it("draws one polygon per run, carrying its class and its range", () => {
    const drawn = classificationFeatures(REPORT);
    expect(drawn.type).toBe("FeatureCollection");
    const features = drawn.features as Array<{
      geometry: unknown;
      properties: Record<string, unknown>;
    }>;
    expect(features).toHaveLength(2);
    expect(features[0].geometry).toEqual({
      type: "Polygon",
      coordinates: [REPORT.features[0].ring],
    });
    expect(features[0].properties).toEqual({
      class: "rain",
      nearKm: 5,
      farKm: 12,
    });
    expect(features[1].properties.class).toBe("hail");
  });

  it("paints each class the colour the legend says, and nothing else a colour of its own", () => {
    // Built from the legend that arrived with the data, so the map cannot say
    // one thing while the legend says another. A class this build has never
    // seen falls through to the grey the algorithm's own "unknown" wears.
    expect(classificationPaint(REPORT.legend)).toEqual([
      "match",
      ["get", "class"],
      "rain",
      "#61d186",
      "hail",
      "#e27250",
      "#8f97a3",
    ]);
  });

  it("knows the two products and refuses anything else", () => {
    expect(isClassificationProduct("N0H")).toBe(true);
    expect(isClassificationProduct("HHC")).toBe(true);
    expect(isClassificationProduct("N0Q")).toBe(false);
    expect(isClassificationProduct(undefined)).toBe(false);
  });
});

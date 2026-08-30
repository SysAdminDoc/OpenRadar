import { describe, expect, it } from "vitest";
import { MAP_STYLE_OPTIONS, mapStyleDefinition } from "./mapStyles";

describe("map styles", () => {
  it("never reaches an Esri service that needs an account", () => {
    for (const option of MAP_STYLE_OPTIONS) {
      const definition = mapStyleDefinition(option.id);
      const text =
        typeof definition === "string"
          ? definition
          : JSON.stringify(definition);
      expect(text).not.toContain("arcgisonline.com");
    }
  });

  it("credits USGS for the aerial imagery", () => {
    const definition = mapStyleDefinition("aerial");
    expect(typeof definition).not.toBe("string");
    expect(JSON.stringify(definition)).toContain(
      "USDA, USGS The National Map: Orthoimagery",
    );
    expect(JSON.stringify(definition)).toContain("basemap.nationalmap.gov");
  });

  it("uses the credit line OpenTopoMap asks for", () => {
    expect(JSON.stringify(mapStyleDefinition("topography"))).toContain(
      "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)",
    );
  });

  it("keeps the old style ids pointing at a real style", () => {
    expect(mapStyleDefinition("pro-dark")).toContain("openfreemap.org");
    expect(mapStyleDefinition("pro-light")).toContain("openfreemap.org");
  });
});

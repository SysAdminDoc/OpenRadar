import { afterEach, describe, expect, it } from "vitest";
import { MAP_STYLE_OPTIONS, mapStyleDefinition } from "./mapStyles";

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
});

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

  it("routes a selected incident pack only through its local PMTiles protocol", () => {
    (
      window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, scheme: string) =>
        `http://${scheme}.localhost/${path}`,
    };
    const definition = mapStyleDefinition("pro-dark", {
      id: "0123456789abcdef01234567",
      name: "Storm response",
      bounds: { west: -94, south: 40, east: -93, north: 41 },
      minZoom: 5,
      maxZoom: 10,
      bytes: 1234,
      sha256: "a".repeat(64),
      attribution: "USGS The National Map",
    });
    const text = JSON.stringify(definition);
    expect(text).toContain(
      "http://incident.localhost/0123456789abcdef01234567/{z}/{x}/{y}.png",
    );
    expect(text).toContain("USGS The National Map");
    expect(text).not.toContain("openfreemap.org");
    expect(text).not.toContain("nationalmap.gov");
  });
});

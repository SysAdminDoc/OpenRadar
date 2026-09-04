import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAP_STYLE_OPTIONS,
  isLightBasemap,
  mapStyleDefinition,
  resolvedMapStyle,
} from "./mapStyles";

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

describe("asking whether the drawn basemap is a light one", () => {
  it("needs the resolved style, because auto is not a style", () => {
    // The default is "auto" and `isLightBasemap` has no case for it, so
    // asking about the setting rather than about what is drawn answered no
    // for every reader who had not gone and picked a style by hand: the
    // ambient clock kept its pale text over a near-white map.
    expect(isLightBasemap("auto")).toBe(false);
    expect(isLightBasemap(resolvedMapStyle("auto", "light"))).toBe(true);
    expect(isLightBasemap(resolvedMapStyle("auto", "dark"))).toBe(false);
  });

  it("is asked that way by the readout that draws over the map", () => {
    // A test that calls the helper directly leaves the call site free to go
    // back to the setting, which is exactly what was wrong. Read the caller.
    const app = readFileSync(
      join(import.meta.dirname, "..", "App.tsx"),
      "utf8",
    );
    const at = app.indexOf("overLight={");
    expect(at).toBeGreaterThan(-1);
    const said = app.slice(at, at + 160);
    expect(said).toContain("resolvedMapStyle(");
    expect(said).not.toMatch(/isLightBasemap\(\s*settings\.mapStyle\s*\)/);
  });
});

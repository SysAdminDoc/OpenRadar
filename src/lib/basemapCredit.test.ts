import { describe, expect, it } from "vitest";
import {
  MAP_STYLE_OPTIONS,
  OPENSTREETMAP_CREDIT,
  OPENTOPOMAP_CREDIT,
  USGS_IMAGERY_CREDIT,
  basemapCredit,
  mapStyleDefinition,
  resolvedMapStyle,
} from "./mapStyles";
import type { IncidentPackReference, MapStyleId } from "./settings";

const PACK: IncidentPackReference = {
  id: "ian-2022",
  label: "Ian landfall",
  attribution: "USGS The National Map, prepared offline",
  bounds: { west: -84, south: 25, east: -80, north: 28 },
  minZoom: 5,
  maxZoom: 10,
  bytes: 40_000_000,
  sha256: "ab".repeat(32),
} as unknown as IncidentPackReference;

/** The credit a style's own definition carries, for the styles that raster. */
function styleAttribution(id: MapStyleId): string | null {
  const definition = mapStyleDefinition(id);
  if (typeof definition === "string") return null;
  const source = definition.sources.basemap;
  return source && "attribution" in source
    ? (source.attribution ?? null)
    : null;
}

describe("the credit for the map under the weather", () => {
  it("names the service that actually drew each style", () => {
    // Five of these are OpenStreetMap by way of OpenFreeMap and two are not.
    // A picture exported over imagery used to credit OpenStreetMap, which had
    // nothing to do with it.
    expect(basemapCredit("aerial", "dark")).toBe(USGS_IMAGERY_CREDIT);
    expect(basemapCredit("topography", "dark")).toBe(OPENTOPOMAP_CREDIT);
    expect(basemapCredit("roads", "dark")).toBe(OPENSTREETMAP_CREDIT);
    expect(basemapCredit("grayscale", "dark")).toBe(OPENSTREETMAP_CREDIT);
    expect(basemapCredit("daylight", "dark")).toBe(OPENSTREETMAP_CREDIT);
    expect(basemapCredit("pro-dark", "dark")).toBe(OPENSTREETMAP_CREDIT);
    expect(basemapCredit("pro-light", "light")).toBe(OPENSTREETMAP_CREDIT);
  });

  it("resolves Auto the way the map does", () => {
    // Auto is not a basemap, it is whichever the workspace is, and the credit
    // has to follow the same resolution the map draws with.
    for (const theme of ["dark", "light"] as const) {
      expect(basemapCredit("auto", theme)).toBe(
        basemapCredit(resolvedMapStyle("auto", theme), theme),
      );
    }
  });

  it("credits an incident pack, because the tiles came out of it", () => {
    // A prepared pack draws from the disk. Whatever style is chosen behind it,
    // nothing on screen came from that service.
    expect(basemapCredit("aerial", "dark", PACK)).toBe(PACK.attribution);
    expect(basemapCredit("pro-dark", "dark", PACK)).toBe(PACK.attribution);
  });

  it("says the same thing the map's own attribution bar says", () => {
    // The corner of an exported picture and the corner of the window read
    // from one place, so they cannot drift apart.
    for (const id of ["aerial", "topography"] as const) {
      expect(styleAttribution(id)).toBe(basemapCredit(id, "dark"));
    }
    // OpenTopoMap asks for its line word for word.
    expect(OPENTOPOMAP_CREDIT).toContain("OpenTopoMap (CC-BY-SA)");
    expect(OPENTOPOMAP_CREDIT).toContain("Kartendaten");
  });

  it("has an answer for every style the panel offers", () => {
    for (const option of MAP_STYLE_OPTIONS) {
      const credit = basemapCredit(option.id, "dark");
      expect(credit.length).toBeGreaterThan(0);
    }
  });
});

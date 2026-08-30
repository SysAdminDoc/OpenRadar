import { describe, expect, it } from "vitest";
import { looksLikePlacefile, parsePlacefile } from "./placefile";

const SAMPLE = `; a comment
Title: Storm Reports
Refresh: 5
Threshold: 999
Color: 255 200 0
Line: 3, 0, "Warned area"
 35.0, -97.0
 36.0, -98.0
 36.5, -97.2
End:
Color: 0 128 255
Polygon:
 30.0, -90.0
 31.0, -90.0
 31.0, -89.0
End:
Place: 35.5, -97.5, "Hail 2.0 in"
Text: 34.0, -96.0, 1, "Wind 70 mph"
IconFile: 1, 15, 25, 8, 25, "https://example.test/icons.png"
Icon: 35.0, -97.0, 0, 1, 1, "report"
`;

describe("placefile parsing", () => {
  const placefile = parsePlacefile(SAMPLE);

  it("reads the title and the refresh interval", () => {
    expect(placefile.title).toBe("Storm Reports");
    expect(placefile.refreshMinutes).toBe(5);
  });

  it("draws lines, polygons, and points with the colour in force", () => {
    const kinds = placefile.data.features.map(
      (feature) => feature.properties.kind,
    );
    expect(kinds).toEqual(["line", "polygon", "place", "place"]);

    const [line, polygon, place] = placefile.data.features;
    expect(line.properties.color).toBe("#ffc800");
    expect(line.properties.width).toBe(3);
    expect(line.properties.label).toBe("Warned area");
    expect(line.geometry.coordinates).toEqual([
      [-97, 35],
      [-98, 36],
      [-97.2, 36.5],
    ]);

    expect(polygon.properties.color).toBe("#0080ff");
    // A polygon ring has to come back to where it started.
    const ring = (polygon.geometry.coordinates as number[][][])[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);

    expect(place.properties.label).toBe("Hail 2.0 in");
    expect(place.geometry.coordinates).toEqual([-97.5, 35.5]);
  });

  it("says which directives it could not draw instead of dropping them", () => {
    expect(placefile.skipped.sort()).toEqual(["Icon", "IconFile"]);
  });

  it("recognises a placefile without being handed a file name", () => {
    expect(looksLikePlacefile(SAMPLE)).toBe(true);
    expect(looksLikePlacefile('{"type":"FeatureCollection"}')).toBe(false);
  });

  it("ignores a shape with too few points to draw", () => {
    const parsed = parsePlacefile("Line: 2\n 35.0, -97.0\nEnd:\n");
    expect(parsed.data.features).toEqual([]);
  });
});

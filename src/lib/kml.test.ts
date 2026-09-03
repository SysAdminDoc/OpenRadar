import { describe, expect, it } from "vitest";
import {
  MAX_KML_FEATURES,
  coordinates,
  kmlColor,
  looksLikeKml,
  parseKml,
} from "./kml";

/** A KML document around whatever placemarks a test needs. */
function document(body: string, styles = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>Tornado tracks</name>${styles}${body}
</Document></kml>`;
}

describe("the colour a KML style carries", () => {
  it("reads it in the byte order KML actually uses", () => {
    // `aabbggrr`: alpha first and the channels reversed. Read as `rrggbb` a
    // red polygon comes out blue, which looks like a working import of the
    // wrong file rather than a parsing mistake.
    expect(kmlColor("ff0000ff")).toBe("#ff0000");
    expect(kmlColor("ffff0000")).toBe("#0000ff");
    expect(kmlColor("ff00ff00")).toBe("#00ff00");
    // Partly transparent keeps its alpha, because a fill somebody chose to be
    // see-through is a fill they meant to be see-through.
    expect(kmlColor("7f0000ff")).toBe("rgba(255, 0, 0, 0.498)");
    expect(kmlColor("nonsense")).toBeNull();
    expect(kmlColor(null)).toBeNull();
    expect(kmlColor("f00")).toBeNull();
  });
});

describe("the coordinates", () => {
  it("reads lon,lat and drops the altitude", () => {
    expect(coordinates("-94.5,41.6,0 -93.5,41.7,120")).toEqual([
      [-94.5, 41.6],
      [-93.5, 41.7],
    ]);
  });

  it("drops a position that is not on the planet", () => {
    // A file with one bad triple in it is otherwise fine, so the position is
    // dropped rather than the file. Painted, a latitude of 910 is a shape
    // stretched off the top of the world.
    expect(coordinates("-94.5,41.6 -94.5,910 200,41.6 -93,41")).toEqual([
      [-94.5, 41.6],
      [-93, 41],
    ]);
  });

  it("answers for nothing at all", () => {
    expect(coordinates(null)).toEqual([]);
    expect(coordinates("   ")).toEqual([]);
  });
});

describe("reading a placemark", () => {
  it("takes a point, a line and an area from one document", () => {
    const read = parseKml(
      document(`
      <Placemark><name>Station</name>
        <Point><coordinates>-93.6,41.6,0</coordinates></Point>
      </Placemark>
      <Placemark><name>Route</name>
        <LineString><coordinates>-94,41 -93,42</coordinates></LineString>
      </Placemark>
      <Placemark><name>Area</name>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>
          -94,41 -93,41 -93,42 -94,41
        </coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>`),
    );
    expect(read.name).toBe("Tornado tracks");
    expect(read.features.map((one) => one.geometry.type)).toEqual([
      "Point",
      "LineString",
      "Polygon",
    ]);
    expect(read.features[0].properties.name).toBe("Station");
  });

  it("keeps the holes in a polygon", () => {
    // A burn scar with an unburnt island in it is drawn solid without them,
    // which is the map saying something the file did not.
    const read = parseKml(
      document(`
      <Placemark><Polygon>
        <outerBoundaryIs><LinearRing><coordinates>
          -95,40 -92,40 -92,43 -95,43 -95,40
        </coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>
          -94,41 -93,41 -93,42 -94,42 -94,41
        </coordinates></LinearRing></innerBoundaryIs>
      </Polygon></Placemark>`),
    );
    const rings = read.features[0].geometry.coordinates as unknown[][];
    expect(rings).toHaveLength(2);
    expect(rings[1]).toHaveLength(5);
  });

  it("closes a ring the file left open", () => {
    // KML allows an implicit close and GeoJSON does not.
    const read = parseKml(
      document(`
      <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
        -94,41 -93,41 -93,42
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`),
    );
    const ring = (read.features[0].geometry.coordinates as number[][][])[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(4);
  });

  it("drops a ring that is not an area", () => {
    // Three positions where two are the same corner is a line written as a
    // polygon, and drawing it is a shape with no inside.
    const read = parseKml(
      document(`
      <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
        -94,41 -93,41 -94,41
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`),
    );
    expect(read.features).toHaveLength(0);
  });

  it("flattens a MultiGeometry into its parts", () => {
    const read = parseKml(
      document(`
      <Placemark><name>Both</name><MultiGeometry>
        <Point><coordinates>-93.6,41.6</coordinates></Point>
        <Point><coordinates>-93.7,41.7</coordinates></Point>
      </MultiGeometry></Placemark>`),
    );
    expect(read.features).toHaveLength(2);
    for (const feature of read.features) {
      expect(feature.properties.name).toBe("Both");
    }
  });

  it("takes the colours the file declared for itself", () => {
    const read = parseKml(
      document(
        `<Placemark><styleUrl>#warn</styleUrl><Polygon><outerBoundaryIs>
        <LinearRing><coordinates>-94,41 -93,41 -93,42 -94,41</coordinates>
        </LinearRing></outerBoundaryIs></Polygon></Placemark>`,
        `<Style id="warn">
          <LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
          <PolyStyle><color>7f00ffff</color></PolyStyle>
        </Style>`,
      ),
    );
    expect(read.features[0].properties.stroke).toBe("#ff0000");
    expect(read.features[0].properties.fill).toBe("rgba(255, 255, 0, 0.498)");
    expect(read.features[0].properties.strokeWidth).toBe(3);
  });

  it("follows a StyleMap to the style a map actually draws", () => {
    const read = parseKml(
      document(
        `<Placemark><styleUrl>#pair</styleUrl><Point>
          <coordinates>-93.6,41.6</coordinates></Point></Placemark>`,
        `<Style id="plain"><LineStyle><color>ff00ff00</color></LineStyle></Style>
         <Style id="lit"><LineStyle><color>ff0000ff</color></LineStyle></Style>
         <StyleMap id="pair">
           <Pair><key>normal</key><styleUrl>#plain</styleUrl></Pair>
           <Pair><key>highlight</key><styleUrl>#lit</styleUrl></Pair>
         </StyleMap>`,
      ),
    );
    // The normal one. The highlighted one is for a cursor this app has not
    // got, and taking it would draw every shape in its rollover colour.
    expect(read.features[0].properties.stroke).toBe("#00ff00");
  });

  it("carries the extended data a published file puts its fields in", () => {
    const read = parseKml(
      document(`
      <Placemark><name>EF3</name>
        <ExtendedData>
          <Data name="width"><value>400 yd</value></Data>
          <Data name="date"><value>2026-04-27</value></Data>
        </ExtendedData>
        <Point><coordinates>-93.6,41.6</coordinates></Point>
      </Placemark>`),
    );
    expect(read.features[0].properties.width).toBe("400 yd");
    expect(read.features[0].properties.date).toBe("2026-04-27");
    // And the placemark's own name wins over a field that happens to share
    // the key, because that is the one the map labels it with.
    expect(read.features[0].properties.name).toBe("EF3");
  });

  it("refuses something that is not KML rather than drawing nothing", () => {
    // A file a reader chose that silently adds nothing is worse than one that
    // says what was wrong with it.
    expect(() => parseKml("<html><body>not this</body></html>")).toThrow(
      /not a KML/,
    );
    expect(() => parseKml('{"type":"FeatureCollection"}')).toThrow();
  });

  it("accepts a KML with nothing in it, because plenty are", () => {
    expect(parseKml(document("")).features).toEqual([]);
  });

  it("stops at a bounded number of features", () => {
    const many = Array.from(
      { length: MAX_KML_FEATURES + 50 },
      (_, at) =>
        `<Placemark><Point><coordinates>-93.${at % 100},41.6</coordinates></Point></Placemark>`,
    ).join("");
    expect(parseKml(document(many)).features).toHaveLength(MAX_KML_FEATURES);
  });
});

describe("whether a file is KML at all", () => {
  it("goes on the name, and on the content when the name is unhelpful", () => {
    expect(looksLikeKml("tracks.kml", "")).toBe(true);
    expect(looksLikeKml("TRACKS.KML", "")).toBe(true);
    // Somebody's export named it .txt and it is still a KML.
    expect(looksLikeKml("tracks.txt", '<?xml version="1.0"?><kml >')).toBe(
      true,
    );
    expect(looksLikeKml("shapes.geojson", '{"type":"FeatureCollection"}')).toBe(
      false,
    );
    // Not on the word appearing in prose: a placefile mentioning KML is a
    // placefile.
    expect(looksLikeKml("place.txt", "Title: converted from kml")).toBe(false);
  });
});

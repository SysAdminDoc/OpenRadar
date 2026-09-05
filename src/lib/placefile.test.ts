import { describe, expect, it } from "vitest";
import {
  iconId,
  imageCorners,
  looksLikePlacefile,
  parseIconId,
  parsePlacefile,
  thresholdZoom,
  timeWindow,
} from "./placefile";

/** A host the app is allowed to fetch, so the icon path can be exercised. */
const ALLOWED = "https://mesonet.agron.iastate.edu/pf/icons.png";

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
    // The last is the sample's `Icon`, drawn as a point because its sheet is
    // on a host the app may not fetch.
    expect(kinds).toEqual(["line", "polygon", "place", "place", "place"]);

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

  it("names the host it was not allowed to ask for the icon sheet", () => {
    // "Nothing appeared" and "we may not ask that server" are different
    // problems, and only one of them is the reader's file.
    expect(placefile.skipped).toEqual(["Icon images from example.test"]);
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

describe("blocks that are not plain coordinates", () => {
  it("does not read a colour inside a block as a vertex", () => {
    const parsed = parsePlacefile(
      [
        'Line: 2, 0, "front"',
        " 35.0, -97.0",
        "Color: 80, 40, 20",
        " 36.0, -96.0",
        "End:",
      ].join("\n"),
    );
    expect(parsed.data.features[0].geometry.coordinates).toEqual([
      [-97, 35],
      [-96, 36],
    ]);
    // The colour still takes effect from where it appears.
    expect(parsed.data.features[0].properties.color).toBe("#502814");
  });

  it("steps over a shape inside an object instead of drawing its offsets", () => {
    const parsed = parsePlacefile(
      [
        "Object: 35.0,-97.0",
        "Threshold: 999",
        "Line: 2, 0",
        " -10, -10",
        " 10, -10",
        " 10, 10",
        "End:",
        "End:",
        'Place: 30.0, -90.0, "after"',
      ].join("\n"),
    );
    expect(parsed.skipped).toEqual(["Object shapes"]);
    // Only the place after the block, never the block's own offsets.
    expect(parsed.data.features).toHaveLength(1);
    expect(parsed.data.features[0].properties.label).toBe("after");
  });

  it("keeps what a truncated file managed to say and says it was cut off", () => {
    const parsed = parsePlacefile(
      ['Line: 2, 0, "front"', " 35.0, -97.0", " 36.0, -96.0"].join("\n"),
    );
    expect(parsed.truncated).toBe(true);
    expect(parsed.data.features).toHaveLength(1);
  });
});

describe("a view threshold", () => {
  it("becomes the zoom the shape first appears at", () => {
    // The format states visibility as the range the view is within; a map
    // states it as a zoom, and the format's own "always" has to stay always.
    expect(thresholdZoom(999)).toBe(0);
    expect(thresholdZoom(0)).toBe(0);
    expect(thresholdZoom(500)).toBeCloseTo(5.44, 1);
    expect(thresholdZoom(50)).toBeCloseTo(8.76, 1);
    // Closer ranges have to sort above wider ones or the whole thing is
    // backwards and every shape appears when it should be hidden.
    expect(thresholdZoom(10)).toBeGreaterThan(thresholdZoom(100));
  });

  it("rides on the shapes written after it and not the ones before", () => {
    const parsed = parsePlacefile(
      [
        'Place: 35.0, -97.0, "wide"',
        "Threshold: 50",
        'Place: 36.0, -97.0, "close"',
        "Threshold: 999",
        'Place: 37.0, -97.0, "wide again"',
      ].join("\n"),
    );
    const zooms = parsed.data.features.map(
      (feature) => feature.properties.minZoom,
    );
    expect(zooms[0]).toBeUndefined();
    expect(zooms[1]).toBeCloseTo(8.76, 1);
    expect(zooms[2]).toBeUndefined();
  });
});

describe("a time range", () => {
  it("is read as the UTC the format means", () => {
    // Written with no zone. A browser calls that local time, which would hide
    // a file five hours early in Iowa.
    const window = timeWindow("2026-04-27T20:00:00 2026-04-27T21:00:00");
    expect(window?.from).toBe(Date.UTC(2026, 3, 27, 20));
    expect(window?.to).toBe(Date.UTC(2026, 3, 27, 21));
  });

  it("refuses a pair that is not two times in order", () => {
    expect(timeWindow("2026-04-27T21:00:00 2026-04-27T20:00:00")).toBeNull();
    expect(timeWindow("2026-04-27T20:00:00")).toBeNull();
    expect(timeWindow("whenever forever")).toBeNull();
  });

  it("applies to every shape after it until it is changed", () => {
    const parsed = parsePlacefile(
      [
        "TimeRange: 2026-04-27T20:00:00 2026-04-27T21:00:00",
        'Place: 35.0, -97.0, "during"',
        'Place: 36.0, -97.0, "also during"',
      ].join("\n"),
    );
    for (const feature of parsed.data.features) {
      expect(feature.properties.from).toBe(Date.UTC(2026, 3, 27, 20));
      expect(feature.properties.to).toBe(Date.UTC(2026, 3, 27, 21));
    }
  });
});

describe("icons", () => {
  it("draws one from a sheet the app is allowed to fetch", () => {
    const parsed = parsePlacefile(
      [
        `IconFile: 1, 15, 25, 7, 24, "${ALLOWED}"`,
        'Icon: 35.0, -97.0, 90, 1, 3, "Chaser"',
      ].join("\n"),
    );
    expect(parsed.skipped).toEqual([]);
    const [icon] = parsed.data.features;
    expect(icon.properties.kind).toBe("icon");
    expect(icon.properties.angle).toBe(90);
    expect(icon.properties.label).toBe("Chaser");
    expect(icon.geometry.coordinates).toEqual([-97, 35]);
    // The whole description travels on the feature, because the feature is
    // the only part that survives being stored and merged with other files.
    expect(parseIconId(icon.properties.icon as string)).toEqual({
      url: ALLOWED,
      iconWidth: 15,
      iconHeight: 25,
      hotX: 7,
      hotY: 24,
      index: 3,
    });
  });

  it("round-trips an address a URL is allowed to hold", () => {
    // `new URL("https://example.test/a|b.png").href` keeps the pipe, so a
    // sheet at such an address wrote an id with eight parts that read back
    // as nothing: the icon was neither fetched nor drawn as a point.
    for (const url of [
      "https://mesonet.agron.iastate.edu/a|b.png",
      "https://mesonet.agron.iastate.edu/icons.png?set=a|b#2",
      "https://mesonet.agron.iastate.edu/plain.png",
    ]) {
      const sheet = {
        url,
        iconWidth: 15,
        iconHeight: 25,
        hotX: 7,
        hotY: 24,
      };
      expect(parseIconId(iconId(sheet, 3))).toEqual({ ...sheet, index: 3 });
    }
  });

  it("refuses to read back anything it did not write", () => {
    expect(parseIconId("icon2|https%3A%2F%2Fx.test|15|25|7|24")).toBeNull();
    expect(parseIconId("icon2|https%3A%2F%2Fx.test|0|25|7|24|1")).toBeNull();
    expect(parseIconId("icon2|https%3A%2F%2Fx.test|15|25|7|24|0")).toBeNull();
    // A stray percent sign is not an address, in the shape that is escaped.
    expect(parseIconId("icon2|%E0%A4%A|15|25|7|24|1")).toBeNull();
    expect(parseIconId("icon2||15|25|7|24|1")).toBeNull();
    expect(parseIconId("something else")).toBeNull();
    expect(parseIconId("icon3|https%3A%2F%2Fx.test|15|25|7|24|1")).toBeNull();
  });

  it("reads the escaped shape that shipped under the old prefix too", () => {
    // The escaping landed on 2026-09-04 and kept the old prefix; the prefix
    // changed a day later. So the bare prefix covers two shapes, and a
    // workspace saved in between holds an escaped address under it. Reading
    // that one raw hands back "https%3A%2F%2F..." , which is not an address:
    // the fetch resolves against the app origin and 404s.
    const between = parseIconId(
      "icon|https%3A%2F%2Fspotters.example%2Fa.png|15|25|7|24|2",
    );
    expect(between?.url).toBe("https://spotters.example/a.png");
    expect(between?.index).toBe(2);
    // Which shape it is comes from looking at it: an escaped address has no
    // separators left in it.
    expect(
      parseIconId("icon|https://spotters.example/a.png|15|25|7|24|2")?.url,
    ).toBe("https://spotters.example/a.png");
  });

  it("still reads an id written before the address was escaped", () => {
    // A feature is stored in the workspace and a workspace outlives the build
    // that wrote it. Before 2026-09-05 the address went in as it stood, so
    // reading one of those through the unescaping is wrong twice over: a
    // `%2B` the site itself wrote becomes a plus, which is a different object
    // and a 404, and a bare `%` throws and leaves the icon drawing nothing.
    const old = parseIconId(
      "icon|https://spotters.example/a%2Bb.png|15|25|7|24|3",
    );
    expect(old?.url).toBe("https://spotters.example/a%2Bb.png");
    expect(old?.index).toBe(3);
    expect(old?.iconWidth).toBe(15);

    // The one that used to throw, and then drew neither the sheet nor a dot.
    expect(parseIconId("icon|https://x.test/50%.png|15|25|7|24|1")?.url).toBe(
      "https://x.test/50%.png",
    );

    // The numbers are read the same way in both shapes.
    expect(parseIconId("icon|https://x.test/a.png|0|25|7|24|1")).toBeNull();
    expect(parseIconId("icon|https://x.test/a.png|15|25|7|24|0")).toBeNull();
    expect(parseIconId("icon||15|25|7|24|1")).toBeNull();
  });

  it("takes the position of one it cannot fetch rather than losing it", () => {
    // A spotter network file is two hundred people and their reports. Losing
    // all of them because an image server is not on the allowlist would be
    // the wrong trade.
    const parsed = parsePlacefile(
      [
        'IconFile: 1, 15, 25, 7, 24, "https://spotters.example/icons.png"',
        "Object: 35.0,-97.0",
        'Icon: 0, 0, 0, 1, 3, "Chaser"',
        "End:",
      ].join("\n"),
    );
    expect(parsed.skipped).toEqual(["Icon images from spotters.example"]);
    const [icon] = parsed.data.features;
    expect(icon.properties.kind).toBe("place");
    expect(icon.properties.label).toBe("Chaser");
    // The offsets inside an object are screen pixels from its anchor, so the
    // anchor is where this belongs.
    expect(icon.geometry.coordinates).toEqual([-97, 35]);
  });

  it("says so when the sheet is a file that came with the placefile", () => {
    const parsed = parsePlacefile('IconFile: 1, 15, 25, 7, 24, "spotter.png"');
    expect(parsed.skipped).toEqual(["Icon images beside the file"]);
  });
});

describe("a georeferenced picture", () => {
  const block = (url: string) =>
    [
      `Image: "${url}"`,
      " 41.0, -95.0, 0.0, 0.0",
      " 41.0, -93.0, 1.0, 0.0",
      " 40.0, -93.0, 1.0, 1.0",
      " 41.0, -95.0, 0.0, 0.0",
      " 40.0, -93.0, 1.0, 1.0",
      " 40.0, -95.0, 0.0, 1.0",
      "End:",
    ].join("\n");

  it("takes its four corners out of the triangle mesh", () => {
    const parsed = parsePlacefile(block(ALLOWED));
    expect(parsed.skipped).toEqual([]);
    const [picture] = parsed.data.features;
    expect(picture.properties.kind).toBe("image");
    expect(picture.properties.image).toBe(ALLOWED);
    // Top left, top right, bottom right, bottom left, and back again.
    expect(picture.geometry.coordinates).toEqual([
      [
        [-95, 41],
        [-93, 41],
        [-93, 40],
        [-95, 40],
        [-95, 41],
      ],
    ]);
  });

  it("refuses a mesh that is not a rectangle rather than drawing one", () => {
    const parsed = parsePlacefile(
      [
        `Image: "${ALLOWED}"`,
        " 41.0, -95.0, 0.0, 0.0",
        " 41.0, -93.0, 1.0, 0.0",
        " 40.0, -94.0, 0.5, 1.0",
        "End:",
      ].join("\n"),
    );
    expect(parsed.skipped).toEqual(["Image"]);
    expect(parsed.data.features).toEqual([]);
  });

  it("names a host it may not ask and steps over the block", () => {
    const parsed = parsePlacefile(
      `${block("https://pictures.example/radar.png")}\nPlace: 30,-90,"after"`,
    );
    expect(parsed.skipped).toEqual(["Pictures from pictures.example"]);
    expect(parsed.data.features).toHaveLength(1);
    expect(parsed.data.features[0].properties.label).toBe("after");
  });

  it("finds the corners regardless of the order they were listed in", () => {
    const corners = imageCorners([
      [-93, 40, 1, 1],
      [-95, 41, 0, 0],
      [-95, 40, 0, 1],
      [-93, 41, 1, 0],
    ]);
    expect(corners).toEqual([
      [-95, 41],
      [-93, 41],
      [-93, 40],
      [-95, 40],
    ]);
  });
});

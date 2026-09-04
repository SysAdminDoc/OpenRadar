import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analysisDate,
  fetchSmoke,
  parseSmoke,
  previousDay,
  smokeUrl,
  type SmokeDensity,
} from "./smoke";
import { setClockZone } from "../units";

const LIVE = process.env.OPENRADAR_LIVE === "1";

function placemark(
  density: SmokeDensity,
  coordinates: string,
  options: { styled?: boolean } = {},
): string {
  const styled = options.styled ?? true;
  const name = density[0].toUpperCase() + density.slice(1);
  return [
    "<Placemark>",
    `<description><![CDATA[<div>Start Time: 2026196 1200UTC<br>End Time: 2026196 1500UTC<br>Density: ${name}<br>Satellite: GOES-EAST</div>]]></description>`,
    styled ? `<styleUrl>#Smoke_${name}_style</styleUrl>` : "",
    "<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>",
    coordinates,
    "</coordinates></LinearRing></outerBoundaryIs></Polygon>",
    "</Placemark>",
  ].join("\n");
}

function document(body: string, day = "20260715"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">',
    "<Document>",
    `<name>HMS Smoke Mapping-${day}</name>`,
    "<Folder><name>Overlay</name>",
    // The real files open with several ScreenOverlays for the logo, the dates
    // and the legend. None of them is a polygon and none may become one.
    "<ScreenOverlay><name>NOAA logo</name></ScreenOverlay>",
    body,
    "</Folder>",
    "</Document>",
    "</kml>",
  ].join("\n");
}

/** A square, in the format's own `lon,lat,alt` layout. */
const SQUARE = [
  "-106.5,23.0,0",
  "-106.0,23.0,0",
  "-106.0,23.5,0",
  "-106.5,23.5,0",
  "-106.5,23.0,0",
].join("\n        ");

afterEach(() => {
  vi.unstubAllGlobals();
  setClockZone("local");
});

describe("the day's file", () => {
  it("is addressed by year, month and the whole date", () => {
    expect(smokeUrl(new Date(Date.UTC(2026, 6, 15)))).toBe(
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/07/hms_smoke20260715.kml",
    );
    // Single digits are padded on both, which is where a hand-built path goes
    // wrong first.
    expect(smokeUrl(new Date(Date.UTC(2026, 0, 5)))).toContain(
      "/2026/01/hms_smoke20260105.kml",
    );
  });

  it("steps back a day across a month boundary", () => {
    const back = previousDay(new Date(Date.UTC(2026, 8, 1)));
    expect(smokeUrl(back)).toContain("/2026/08/hms_smoke20260831.kml");
  });
});

describe("reading an analysis", () => {
  it("draws each density and puts the worst on top", () => {
    const data = parseSmoke(
      document(
        [
          placemark("heavy", SQUARE),
          placemark("light", SQUARE),
          placemark("medium", SQUARE),
        ].join("\n"),
      ),
    );
    expect(data.features).toHaveLength(3);
    // Last drawn is on top, so heavy has to be last rather than first.
    expect(data.features.map((one) => one.properties.density)).toEqual([
      "light",
      "medium",
      "heavy",
    ]);
  });

  it("reads the density off the description when the style is missing", () => {
    const data = parseSmoke(
      document(placemark("heavy", SQUARE, { styled: false })),
    );
    expect(data.features[0].properties.density).toBe("heavy");
  });

  it("carries the analysis date the document stamps on itself", () => {
    const data = parseSmoke(document(placemark("light", SQUARE), "20260812"));
    expect(data.features[0].properties.analysed).toBe(Date.UTC(2026, 7, 12));
  });

  it("names the day the analyst worked, not the day it is where you are", () => {
    // The stamp is a calendar day carried as midnight UTC, so formatting it in
    // the reader's own zone dated every analysis a day early for everybody
    // west of Greenwich, which is everybody this layer is for. The date is
    // read back in the zone it was written in.
    const at = Date.UTC(2026, 7, 31);
    expect(analysisDate(at)).toBe("Aug 31");
    // And it is the same day whichever clock the reader has chosen, because
    // the day is a property of the file rather than of the reader.
    setClockZone("utc");
    expect(analysisDate(at)).toBe("Aug 31");
  });

  it("closes a ring the file left open", () => {
    const open = ["-100,40,0", "-99,40,0", "-99,41,0"].join(" ");
    const data = parseSmoke(document(placemark("light", open)));
    const ring = (
      data.features[0].geometry as {
        coordinates: Array<Array<[number, number]>>;
      }
    ).coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("drops a ring that closes itself over only two corners", () => {
    // Three positions where the first and last are the same corner is a line
    // written as a polygon. Counting positions rather than corners would let
    // it through as a three-position ring, which GeoJSON does not allow.
    const data = parseSmoke(
      document(placemark("light", "-100,40,0 -99,40,0 -100,40,0")),
    );
    expect(data.features).toEqual([]);
  });

  it("drops a degenerate ring and keeps the rest of the day", () => {
    // Two points is a line, and a file with one in it is otherwise fine.
    const data = parseSmoke(
      document(
        [
          placemark("light", "-100,40,0 -99,40,0"),
          placemark("heavy", SQUARE),
        ].join("\n"),
      ),
    );
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.density).toBe("heavy");
  });

  it("ignores a coordinate that is not a number", () => {
    const data = parseSmoke(
      document(
        placemark(
          "light",
          "-100,40,0 nonsense,40,0 -99,40,0 -99,41,0 -100,40,0",
        ),
      ),
    );
    const ring = (
      data.features[0].geometry as {
        coordinates: Array<Array<[number, number]>>;
      }
    ).coordinates[0];
    expect(ring).toHaveLength(4);
  });

  it("answers a day with no smoke as a day with no smoke", () => {
    // The real files on a clear day carry the overlays and no placemarks.
    // Reading that as a failure would send the layer back to yesterday's
    // smoke, which is a claim nobody made.
    const data = parseSmoke(document(""));
    expect(data.features).toEqual([]);
  });

  it("refuses a document that is not this document", () => {
    expect(() => parseSmoke("<html><body>404</body></html>")).toThrow();
    expect(() => parseSmoke("not xml at all <<<")).toThrow();
  });
});

describe("falling back to the day before", () => {
  const stub = (answers: Record<string, string | number>) => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(String(url));
      const found = Object.entries(answers).find(([part]) =>
        String(url).includes(part),
      );
      const answer = found?.[1];
      if (typeof answer === "number" || answer === undefined) {
        return { ok: false, status: answer ?? 404 } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => answer,
      } as unknown as Response;
    });
    return asked;
  };

  it("reads yesterday when today has not been published", async () => {
    const asked = stub({
      hms_smoke20260901: 404,
      hms_smoke20260831: document(placemark("heavy", SQUARE), "20260831"),
    });
    const data = await fetchSmoke(new Date(Date.UTC(2026, 8, 1, 6)));
    expect(data.features).toHaveLength(1);
    expect(asked[0]).toContain("hms_smoke20260901");
    expect(asked[1]).toContain("hms_smoke20260831");
  });

  it("does not step back when today is published and empty", async () => {
    const asked = stub({
      hms_smoke20260901: document("", "20260901"),
      hms_smoke20260831: document(placemark("heavy", SQUARE), "20260831"),
    });
    const data = await fetchSmoke(new Date(Date.UTC(2026, 8, 1, 6)));
    expect(data.features).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("fails rather than walking backwards for a week", async () => {
    stub({ hms_smoke: 503 });
    await expect(fetchSmoke(new Date(Date.UTC(2026, 8, 1, 6)))).rejects.toThrow(
      /is busy/,
    );
  });

  it("refuses a file it cannot read rather than showing yesterday's smoke", async () => {
    // A file that will not parse changed shape or arrived truncated. Falling
    // back would put yesterday's plume on the map as today's, which nothing
    // has confirmed is still there; the reader gets a note instead.
    const asked = stub({
      hms_smoke20260901: "<html><body>maintenance</body></html>",
      hms_smoke20260831: document(placemark("heavy", SQUARE), "20260831"),
    });
    await expect(
      fetchSmoke(new Date(Date.UTC(2026, 8, 1, 6))),
    ).rejects.toThrow();
    expect(asked).toHaveLength(1);
  });
});

describe.runIf(LIVE)("against the live analysis", () => {
  it("still publishes the day's file where the path says", async () => {
    // Today's may not be up yet in the small hours, so the check is that one
    // of the two days answers with something this parser can read.
    const now = new Date();
    const text = await (async () => {
      for (const at of [now, previousDay(now)]) {
        const response = await fetch(smokeUrl(at));
        if (response.ok) return response.text();
      }
      throw new Error("neither today nor yesterday answered");
    })();
    const data = parseSmoke(text);
    // Not an assertion about how smoky it is: a clear day is a real answer.
    // What is being held is that the document still parses as this document
    // and that anything in it still carries a density this app knows.
    for (const feature of data.features) {
      expect(["light", "medium", "heavy"]).toContain(
        feature.properties.density,
      );
      expect(feature.geometry.type).toBe("Polygon");
    }
    expect(text).toContain("HMS Smoke Mapping-");
  }, 60_000);
});

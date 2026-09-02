import { describe, expect, it } from "vitest";
import {
  dwdHazard,
  dwdSeverity,
  dwdUrl,
  parseDwdWarnings,
  reachesGermany,
} from "./dwdWarnings";

/** The live contract runs only when it is asked for. */
const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * Shaped from what the service answered on 2026-09-02, capitals and all: the
 * event names are shouted, the severity is the CAP word, and the text is
 * German because the office publishes in German.
 */
const feed = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: {
        IDENTIFIER: "2.49.0.0.276.0.DWD.PVW.1",
        EVENT: "WINDBÖEN",
        EC_GROUP: "WIND",
        SEVERITY: "Minor",
        EC_AREA_COLOR: "255 235 59",
        NAME: "Gemeinde Neufeld",
        AREADESC: "Neufeld",
        SENDERNAME: "Deutscher Wetterdienst",
        WEB: "https://dwd.de/warnungen",
        ONSET: "2026-09-02T18:00:00Z",
        EXPIRES: "2026-09-02T23:00:00Z",
        DESCRIPTION: "Es treten Windböen mit Geschwindigkeiten um 60 km/h auf.",
        INSTRUCTION: "Hinweis auf: umherfliegende leichte Gegenstände.",
      },
    },
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: {
        IDENTIFIER: "2.49.0.0.276.0.DWD.PVW.2",
        EVENT: "STARKES GEWITTER",
        EC_GROUP: "GEWITTER",
        SEVERITY: "Severe",
        EXPIRES: "2026-09-02T21:00:00Z",
      },
    },
    { type: "Feature", geometry: { type: "MultiPolygon" }, properties: {} },
  ],
};

describe("German warnings", () => {
  it("asks nobody about a view that does not reach Germany", () => {
    expect(
      reachesGermany({ west: -100, south: 30, east: -95, north: 35 }),
    ).toBe(false);
    expect(reachesGermany({ west: 8, south: 49, east: 11, north: 51 })).toBe(
      true,
    );
  });

  it("asks in the order the coordinate system declares", () => {
    // WFS 2.0 reads a box in the CRS's own axis order, and EPSG:4326 is
    // latitude first. Longitude first would have asked about the sea off
    // Somalia and answered with nothing, which reads as quiet weather.
    const bbox = new URL(
      dwdUrl({ west: 8, south: 49, east: 11, north: 51 }),
    ).searchParams.get("bbox");
    expect(bbox).toBe("49,8,51,11,EPSG:4326");
  });

  it("keeps the office's own severity words", () => {
    expect(dwdSeverity("Extreme")).toBe("extreme");
    expect(dwdSeverity("Severe")).toBe("severe");
    expect(dwdSeverity("Moderate")).toBe("moderate");
    expect(dwdSeverity("Minor")).toBe("minor");
    // Something the office has not published before is drawn as the least
    // severe, never the most: a warning drawn louder than it was issued is
    // the one direction that costs a reader's trust.
    expect(dwdSeverity("Katastrophal")).toBe("minor");
    expect(dwdSeverity("")).toBe("minor");
  });

  it("puts a hazard under the switch its American twin is under", () => {
    expect(dwdHazard("WIND", "WINDBÖEN")).toBe("thunderstorm");
    expect(dwdHazard("GEWITTER", "STARKES GEWITTER")).toBe("thunderstorm");
    expect(dwdHazard("SCHNEE", "SCHNEEFALL")).toBe("winter");
    expect(dwdHazard("GLATTEIS", "GLATTEIS")).toBe("winter");
    expect(dwdHazard("REGEN", "STARKREGEN")).toBe("flood");
    expect(dwdHazard("HITZE", "HITZEWARNUNG")).toBe("heat");
    // Anything the table has not met appears under a switch nobody has
    // turned off rather than vanishing.
    expect(dwdHazard("UV", "UV-INDEX")).toBe("other");
    expect(dwdHazard("", "")).toBe("other");
  });

  it("hands the map a warning shaped like every other one", () => {
    const [wind, storm] = parseDwdWarnings(feed);
    // Title case, because the office shouts its event names and every other
    // headline in the list is in title case: block capitals read as more
    // severe than the office said.
    expect(wind.properties.headline).toBe("Windböen");
    expect(storm.properties.headline).toBe("Starkes Gewitter");
    expect(wind.properties.severity).toBe("minor");
    expect(storm.properties.severity).toBe("severe");
    expect(wind.properties.kind).toBe("thunderstorm");
    expect(wind.properties.area).toBe("Gemeinde Neufeld");
    expect(wind.properties.office).toBe("Deutscher Wetterdienst");
    // The office's own text, in German, unaltered.
    expect(wind.properties.description).toContain("Windböen mit");
    expect(wind.properties.instruction).toContain("umherfliegende");
    expect(wind.properties.expires).toBe(Date.parse("2026-09-02T23:00:00Z"));
  });

  it("drops a feature with no event and no geometry", () => {
    expect(parseDwdWarnings(feed)).toHaveLength(2);
    expect(parseDwdWarnings(null)).toEqual([]);
    expect(parseDwdWarnings({ features: "not a list" })).toEqual([]);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still publishes the fields a warning is drawn from", async () => {
    // Germany is often quiet, and an empty answer on a calm day is the right
    // answer. What this holds is the shape.
    const answer = await fetch(
      dwdUrl({ west: 5.5, south: 47, east: 15.5, north: 55.5 }),
      { headers: { Accept: "application/json" } },
    );
    expect(answer.ok).toBe(true);
    const payload = (await answer.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(Array.isArray(payload.features)).toBe(true);
    if (!payload.features.length) return;

    for (const feature of payload.features.slice(0, 20)) {
      const said = feature.properties;
      expect(typeof said.EVENT).toBe("string");
      expect(["Minor", "Moderate", "Severe", "Extreme"]).toContain(
        String(said.SEVERITY),
      );
      expect(typeof said.EXPIRES).toBe("string");
    }

    const drawn = parseDwdWarnings(payload);
    expect(drawn.length).toBeGreaterThan(0);
    for (const feature of drawn) {
      expect(String(feature.properties.headline)).not.toBe("");
    }
  });
});

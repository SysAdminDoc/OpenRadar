import { describe, expect, it } from "vitest";
import {
  ecccSeverity,
  ecccUrl,
  parseEcccAlerts,
  reachesCanada,
} from "./ecccAlerts";

/** The live contract runs only when it is asked for. */
const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * Shaped from what the service actually answered on 2026-09-02, fields and
 * spellings included: lower-case product names, a colour beside the type, and
 * a bilingual pair for every piece of text.
 */
const feed = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: {
        alert_code: "TRW",
        alert_type: "warning",
        alert_name_en: "tornado warning",
        alert_name_fr: "alerte de tornade",
        risk_colour_en: "red",
        feature_id: "TRW-SK-11",
        feature_name_en: "Regina",
        feature_name_fr: "Regina",
        province: "SK",
        publication_datetime: "2026-09-02T21:00:00Z",
        expiration_datetime: "2026-09-02T23:00:00Z",
        alert_text_en: "A tornado has been spotted. Take cover immediately.",
        alert_text_fr:
          "Une tornade a été aperçue. Mettez-vous à l'abri immédiatement.",
      },
    },
    {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: {
        alert_code: "STV",
        alert_type: "watch",
        alert_name_en: "severe thunderstorm watch",
        alert_name_fr: "veille d'orages violents",
        risk_colour_en: "yellow",
        feature_id: "STV-ON-3",
        feature_name_en: "Kenora",
        feature_name_fr: "Kenora",
        publication_datetime: "2026-09-02T20:00:00Z",
        event_end_datetime: "2026-09-03T02:00:00Z",
        alert_text_en: "Conditions are favourable for severe thunderstorms.",
        alert_text_fr: "Les conditions sont favorables aux orages violents.",
      },
    },
    {
      // No name at all: nothing to draw, nothing to announce.
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { alert_type: "statement" },
    },
  ],
};

describe("Canadian warnings", () => {
  it("asks nobody about a view that does not reach Canada", () => {
    // Most of the time the map is over the United States, and a request to a
    // second country's service on every pan would be somebody else's
    // bandwidth for nothing.
    expect(reachesCanada({ west: -100, south: 30, east: -95, north: 35 })).toBe(
      false,
    );
    expect(
      reachesCanada({ west: -106, south: 49, east: -103, north: 51 }),
    ).toBe(true);
    // A view straddling the border reaches it, which is the case that
    // matters: somebody watching a storm cross into Manitoba.
    expect(reachesCanada({ west: -100, south: 45, east: -95, north: 50 })).toBe(
      true,
    );
  });

  it("asks only about the part of the view that is in Canada", () => {
    const url = ecccUrl({ west: -160, south: 20, east: -40, north: 90 });
    const bbox = new URL(url).searchParams.get("bbox");
    // Clamped to the country rather than sent as the whole hemisphere.
    expect(bbox).toBe("-141.100,41.600,-52.500,83.200");
  });

  it("reads the office's stage and its colour together", () => {
    // Two fields saying different things: the stage the hazard is at, and how
    // bad the office expects it to be. A red warning is the top of the scale;
    // a yellow watch is not.
    expect(ecccSeverity("warning", "red")).toBe("extreme");
    expect(ecccSeverity("warning", "yellow")).toBe("severe");
    expect(ecccSeverity("watch", "yellow")).toBe("moderate");
    expect(ecccSeverity("advisory", "yellow")).toBe("minor");
    expect(ecccSeverity("statement", "")).toBe("minor");
    // A colour the service has not published before must not silently become
    // the worst thing on the map.
    expect(ecccSeverity("warning", "chartreuse")).toBe("severe");
  });

  it("hands the map a warning shaped like every other one", () => {
    const [tornado, storm] = parseEcccAlerts(feed);
    expect(tornado.properties.headline).toBe("Tornado Warning");
    expect(tornado.properties.severity).toBe("extreme");
    // The hazard grouping is what the watch and the layer switches read, and
    // it must land in the same bucket a Kansas tornado warning does.
    expect(tornado.properties.kind).toBe("tornado");
    expect(tornado.properties.office).toContain("Environment and Climate");
    expect(tornado.properties.area).toBe("Regina");
    expect(tornado.properties.description).toContain("Take cover immediately");
    expect(tornado.properties.expires).toBe(Date.parse("2026-09-02T23:00:00Z"));

    expect(storm.properties.headline).toBe("Severe Thunderstorm Watch");
    expect(storm.properties.kind).toBe("thunderstorm");
    // No expiry of its own: the end of the event is when it stops.
    expect(storm.properties.expires).toBe(Date.parse("2026-09-03T02:00:00Z"));
  });

  it("says it in the reader's own language", () => {
    const [tornado, storm] = parseEcccAlerts(feed, true);
    // Sentence case, not title case: "Veille D'orages Violents" is not how
    // French is written and is not what the office published.
    expect(storm.properties.headline).toBe("Veille d'orages violents");
    expect(tornado.properties.headline).toBe("Alerte de tornade");
    expect(String(tornado.properties.description)).toContain("à l'abri");
    // The grouping still reads the English name, because it is written in
    // English words: a French reader must not lose the tornado switch.
    expect(tornado.properties.kind).toBe("tornado");
  });

  it("drops a feature with nothing to say", () => {
    expect(parseEcccAlerts(feed)).toHaveLength(2);
    expect(parseEcccAlerts(null)).toEqual([]);
    expect(parseEcccAlerts({ features: "not a list" })).toEqual([]);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still publishes the fields a warning is drawn from", async () => {
    // Not that Canada has weather today: an empty answer on a clear day is
    // the right answer. What this holds is the shape, which is what moves
    // without telling anybody. A renamed field would leave every Canadian
    // warning drawn as a nameless minor one, and nothing offline would catch
    // it.
    const answer = await fetch(
      ecccUrl({ west: -141, south: 41, east: -52, north: 84 }),
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
      expect(typeof said.alert_name_en).toBe("string");
      expect(typeof said.alert_name_fr).toBe("string");
      expect(typeof said.alert_type).toBe("string");
      // The four the severity is read from, and the two the popup shows.
      expect(["warning", "watch", "advisory", "statement"]).toContain(
        String(said.alert_type),
      );
      expect(typeof said.risk_colour_en).toBe("string");
      expect(typeof said.alert_text_en).toBe("string");
    }

    // And the whole way through, so a change in the geometry or the naming
    // shows up as nothing drawn rather than as a field that reads oddly.
    const drawn = parseEcccAlerts(payload);
    expect(drawn.length).toBeGreaterThan(0);
    for (const feature of drawn) {
      expect(String(feature.properties.headline)).not.toBe("");
      expect(feature.properties.severityRank).toBeGreaterThanOrEqual(0);
    }
  });
});

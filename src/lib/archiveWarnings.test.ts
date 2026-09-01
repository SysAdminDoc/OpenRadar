import { describe, expect, it } from "vitest";
import {
  archiveCoverage,
  archiveWarningsAt,
  archiveWarningsUrl,
  parseArchiveWarnings,
} from "./archiveWarnings";

const LIVE = process.env.OPENRADAR_LIVE === "1";

const AT = (iso: string) => Date.parse(iso);

/**
 * The archive's own shape, taken from a live answer for 2011-04-27T22:00:00Z
 * rather than invented, so a field renamed upstream shows up here.
 */
function polygon(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-97, 35],
          [-96, 35],
          [-96, 36],
          [-97, 36],
          [-97, 35],
        ],
      ],
    },
    properties: {
      status: "NEW",
      phenomena: "TO",
      significance: "W",
      ps: "Tornado Warning",
      wfo: "OUN",
      eventid: 42,
      polygon_begin: "2011-04-27T22:00:00Z",
      polygon_end: "2011-04-27T22:30:00Z",
      product_id: "201104272200-KOUN-WFUS53-TORNAD",
      href: "https://mesonet.agron.iastate.edu/vtec/",
      windtag: null,
      hailtag: null,
      tornadotag: "OBSERVED",
      damagetag: null,
      is_emergency: false,
      is_pds: false,
      floodtag_damage: null,
      ...overrides,
    },
  };
}

describe("what the archive can say about a moment", () => {
  it("knows where polygons stop existing and where they became official", () => {
    expect(archiveCoverage(AT("2001-06-01T00:00:00Z"))).toBe("none");
    expect(archiveCoverage(AT("2002-01-01T00:00:00Z"))).toBe("partial");
    expect(archiveCoverage(AT("2005-08-29T10:00:00Z"))).toBe("partial");
    // Storm-based warnings became the official product on this date.
    expect(archiveCoverage(AT("2007-10-01T00:00:00Z"))).toBe("full");
    expect(archiveCoverage(AT("2011-04-27T22:00:00Z"))).toBe("full");
  });

  it("asks for the whole replay window in one request", () => {
    const url = archiveWarningsUrl(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    expect(url).toContain("sts=2011-04-27T19:00:00Z");
    expect(url).toContain("ets=2011-04-28T01:00:00Z");
    // Seconds, no milliseconds: the archive rejects the fractional form.
    expect(url).not.toContain(".000Z");
  });
});

describe("reading the archive", () => {
  it("gives a polygon the shape the live warnings layer already draws", () => {
    const [feature] = parseArchiveWarnings({
      features: [polygon()],
    }).features;

    expect(feature.properties.headline).toBe("Tornado Warning");
    expect(feature.properties.severity).toBe("extreme");
    expect(feature.properties.kind).toBe("tornado");
    expect(feature.properties.office).toBe("OUN");
    // And the two fields this layer adds, which are what make scrubbing work
    // and what stops a 2011 warning reading as live.
    expect(feature.properties.polygonBegin).toBe(AT("2011-04-27T22:00:00Z"));
    expect(feature.properties.polygonEnd).toBe(AT("2011-04-27T22:30:00Z"));
    expect(feature.properties.historical).toBe(true);
  });

  it("reads a damage threat however the archive spelled it", () => {
    const tagged = parseArchiveWarnings({
      features: [polygon({ damagetag: "CONSIDERABLE" })],
    }).features[0];
    expect(tagged.properties.impact).toBe("considerable");

    // An emergency is its own flag in the archive rather than a tag, and it
    // is the most serious thing an office can say.
    const emergency = parseArchiveWarnings({
      features: [polygon({ is_emergency: true })],
    }).features[0];
    expect(emergency.properties.impact).toBe("catastrophic");

    const flood = parseArchiveWarnings({
      features: [
        polygon({ ps: "Flash Flood Warning", floodtag_damage: "CATASTROPHIC" }),
      ],
    }).features[0];
    expect(flood.properties.impact).toBe("catastrophic");
  });

  it("draws the worst first, the way the live layer does", () => {
    const parsed = parseArchiveWarnings({
      features: [
        polygon({ ps: "Flood Advisory", significance: "Y" }),
        polygon({ ps: "Tornado Warning", is_emergency: true }),
        polygon({ ps: "Severe Thunderstorm Warning" }),
      ],
    });
    expect(parsed.features.map((f) => f.properties.headline)).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Flood Advisory",
    ]);
  });

  it("drops an entry it cannot place in time or name", () => {
    const parsed = parseArchiveWarnings({
      features: [
        polygon({ polygon_begin: null }),
        polygon({ ps: "" }),
        { type: "Feature", properties: {} },
        polygon(),
      ],
    });
    expect(parsed.features).toHaveLength(1);
  });

  it("survives an answer that is not one", () => {
    expect(parseArchiveWarnings(null).features).toEqual([]);
    expect(parseArchiveWarnings({}).features).toEqual([]);
    expect(parseArchiveWarnings({ features: "no" }).features).toEqual([]);
  });
});

describe("scrubbing through a warning that changed shape", () => {
  // The case the whole time filter exists for. An office shrinks a warning as
  // the storm passes, and the archive keeps each version with the window it
  // stood for, so the same warning is in the answer three times and only one
  // of them belongs on any given frame.
  const shrinking = parseArchiveWarnings({
    features: [
      polygon({
        eventid: 7,
        polygon_begin: "2011-04-27T22:00:00Z",
        polygon_end: "2011-04-27T22:15:00Z",
        hailtag: "1.00",
      }),
      polygon({
        eventid: 7,
        polygon_begin: "2011-04-27T22:15:00Z",
        polygon_end: "2011-04-27T22:30:00Z",
        hailtag: "2.00",
      }),
      polygon({
        eventid: 7,
        polygon_begin: "2011-04-27T22:30:00Z",
        polygon_end: "2011-04-27T22:45:00Z",
        hailtag: "3.00",
      }),
    ],
  });

  function at(iso: string) {
    const shown = archiveWarningsAt(shrinking, AT(iso));
    return (shown?.features ?? []).map((f) => f.properties.hailSize);
  }

  it("shows exactly one version of it on every frame", () => {
    expect(at("2011-04-27T22:05:00Z")).toEqual(["1.00"]);
    expect(at("2011-04-27T22:20:00Z")).toEqual(["2.00"]);
    expect(at("2011-04-27T22:40:00Z")).toEqual(["3.00"]);
  });

  it("hands the frame over on the boundary rather than drawing both", () => {
    // A version replaced at 22:15 and its replacement beginning at 22:15 would
    // otherwise both land on that frame, one over the other, which is the
    // shrink rendered as a smear.
    expect(at("2011-04-27T22:15:00Z")).toEqual(["2.00"]);
    expect(at("2011-04-27T22:30:00Z")).toEqual(["3.00"]);
  });

  it("shows nothing before it was issued or after it ended", () => {
    expect(at("2011-04-27T21:59:00Z")).toEqual([]);
    expect(at("2011-04-27T22:45:00Z")).toEqual([]);
  });

  it("keeps a polygon the archive never closed", () => {
    const open = parseArchiveWarnings({
      features: [polygon({ polygon_end: null })],
    });
    const shown = archiveWarningsAt(open, AT("2011-04-28T06:00:00Z"));
    expect(shown?.features).toHaveLength(1);
  });

  it("has nothing to show when there was no replay", () => {
    expect(archiveWarningsAt(null, AT("2011-04-27T22:00:00Z"))).toBeNull();
  });
});

describe.runIf(LIVE)("against the live archive", () => {
  // 27 April 2011, the largest tornado outbreak on record, which is the day
  // this layer exists for. The shape of the answer is what is checked; the
  // weather that day is not going to change.
  it("answers with the polygons that stood at a moment in 2011", async () => {
    const response = await fetch(
      archiveWarningsUrl(
        AT("2011-04-27T21:00:00Z"),
        AT("2011-04-27T23:00:00Z"),
      ),
    );
    expect(response.ok).toBe(true);
    const parsed = parseArchiveWarnings(await response.json());

    expect(parsed.features.length).toBeGreaterThan(50);
    // The outbreak's own signature: tornado warnings, and offices tagging
    // them, which is what the hazard tags in the popup come from.
    const tornado = parsed.features.filter(
      (feature) => feature.properties.kind === "tornado",
    );
    expect(tornado.length).toBeGreaterThan(5);

    for (const feature of parsed.features) {
      expect(typeof feature.properties.polygonBegin).toBe("number");
      expect(feature.properties.historical).toBe(true);
      expect(String(feature.properties.headline).length).toBeGreaterThan(3);
    }

    // And the whole point: one instant in that window holds fewer polygons
    // than the window does, because they came and went inside it.
    const instant = archiveWarningsAt(parsed, AT("2011-04-27T22:00:00Z"));
    expect(instant?.features.length).toBeGreaterThan(0);
    expect(instant!.features.length).toBeLessThan(parsed.features.length);
  }, 60_000);
});

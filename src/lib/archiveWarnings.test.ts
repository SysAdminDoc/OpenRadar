import { describe, expect, it } from "vitest";
import {
  archiveCoverage,
  archiveTagsUrl,
  archiveWarningsAt,
  archiveWarningsUrl,
  parseArchiveTags,
  parseArchiveWarnings,
} from "./archiveWarnings";

const LIVE = process.env.OPENRADAR_LIVE === "1";

const AT = (iso: string) => Date.parse(iso);

/**
 * A row of the interval service, taken from a live answer for the 2011-04-27
 * outbreak rather than invented, so a field renamed upstream shows up here.
 *
 * This is the service that carries polygon revisions. `geojson/sbw.py`, asked
 * for a window, answers only the issuance rows, which is why it is no longer
 * where the polygons come from.
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
      ph_sig: "TO.W",
      event_label: "Tornado Warning",
      wfo: "OUN",
      year: 2011,
      eventid: 42,
      utc_issue: "2011-04-27T22:00:00Z",
      utc_expire: "2011-04-27T22:45:00Z",
      utc_polygon_begin: "2011-04-27T22:00:00Z",
      utc_polygon_end: "2011-04-27T22:30:00Z",
      product_id: "201104272200-KOUN-WFUS53-TORNAD",
      ...overrides,
    },
  };
}

/** A row of the tag feed, which is a different service with different names. */
function tagRow(overrides: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-96.5, 35.5] },
    properties: {
      wfo: "OUN",
      year: 2011,
      phenomena: "TO",
      significance: "W",
      eventid: 42,
      hailtag: null,
      damagetag: null,
      is_emergency: false,
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

  it("asks the service that knows about polygon revisions", () => {
    const url = archiveWarningsUrl(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    // The interval service, and explicitly not the issuance-only default:
    // without this a warning disappears from the map the moment its office
    // first revised the polygon, which on 2011-04-27 was two thirds of the
    // tornado warnings.
    expect(url).toContain("/vtec/sbw_interval.geojson");
    expect(url).toContain("only_new=false");
    // Issuance is what the window filters on, so it opens two hours early to
    // catch a warning already in force when the replay starts.
    expect(url).toContain("begints=2011-04-27T17:00:00Z");
    expect(url).toContain("endts=2011-04-28T01:00:00Z");
    // Seconds, no milliseconds: the archive rejects the fractional form.
    expect(url).not.toContain(".000Z");
  });

  it("asks the tag feed for the same window", () => {
    const url = archiveTagsUrl(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    expect(url).toContain("/geojson/sbw.py");
    expect(url).toContain("sts=2011-04-27T17:00:00Z");
    expect(url).toContain("ets=2011-04-28T01:00:00Z");
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

  it("joins the tags on the event they belong to", () => {
    // Two services: one knows every polygon, the other knows what the office
    // tagged. They agree on the office, the year, the hazard, the
    // significance and the number, and on nothing else.
    const tags = parseArchiveTags({
      features: [tagRow({ damagetag: "CONSIDERABLE", hailtag: "2.75" })],
    });
    const tagged = parseArchiveWarnings({ features: [polygon()] }, tags)
      .features[0];
    expect(tagged.properties.impact).toBe("considerable");
    expect(tagged.properties.hailSize).toBe("2.75");

    // A tag row for a different event does not reach this one.
    const elsewhere = parseArchiveTags({
      features: [tagRow({ eventid: 43, damagetag: "DESTRUCTIVE" })],
    });
    expect(
      parseArchiveWarnings({ features: [polygon()] }, elsewhere).features[0]
        .properties.impact,
    ).toBe("");
  });

  it("reads a damage threat however the tag feed spelled it", () => {
    const impactOf = (row: Record<string, unknown>) =>
      parseArchiveWarnings(
        { features: [polygon()] },
        parseArchiveTags({ features: [tagRow(row)] }),
      ).features[0].properties.impact;

    // An emergency is its own flag rather than a tag, and it is the most
    // serious thing an office can say.
    expect(impactOf({ is_emergency: true })).toBe("catastrophic");
    expect(impactOf({ damagetag: "DESTRUCTIVE" })).toBe("destructive");
    expect(impactOf({ floodtag_damage: "CATASTROPHIC" })).toBe("catastrophic");
    expect(impactOf({})).toBe("");
  });

  it("does not draw the area a cancellation released", () => {
    // A cancel's polygon is the area being let go, so drawing it would say
    // the opposite of what happened.
    const parsed = parseArchiveWarnings({
      features: [polygon({ status: "CAN" }), polygon({ status: "CON" })],
    });
    expect(parsed.features).toHaveLength(1);
  });

  it("draws the worst first, the way the live layer does", () => {
    const parsed = parseArchiveWarnings({
      features: [
        polygon({ event_label: "Flood Advisory", significance: "Y" }),
        polygon({ event_label: "Tornado Warning", is_emergency: true }),
        polygon({ event_label: "Severe Thunderstorm Warning" }),
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
        polygon({ utc_polygon_begin: null }),
        polygon({ event_label: "" }),
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
  const version = (
    begin: string,
    end: string | null,
    status: string,
    id: string,
  ) =>
    polygon({
      eventid: 7,
      status,
      utc_polygon_begin: begin,
      utc_polygon_end: end,
      product_id: id,
    });

  const shrinking = parseArchiveWarnings({
    features: [
      version("2011-04-27T22:00:00Z", "2011-04-27T22:15:00Z", "NEW", "first"),
      version("2011-04-27T22:15:00Z", "2011-04-27T22:30:00Z", "CON", "second"),
      version("2011-04-27T22:30:00Z", "2011-04-27T22:45:00Z", "CON", "third"),
    ],
  });

  // Which revision is on screen, by the product that carried it. The service
  // gives one row per revision and they differ by their own product id.
  function at(iso: string) {
    const shown = archiveWarningsAt(shrinking, AT(iso));
    return (shown?.features ?? []).map((f) => f.properties.capId);
  }

  it("shows exactly one version of it on every frame", () => {
    expect(at("2011-04-27T22:05:00Z")).toEqual(["first"]);
    expect(at("2011-04-27T22:20:00Z")).toEqual(["second"]);
    expect(at("2011-04-27T22:40:00Z")).toEqual(["third"]);
  });

  it("hands the frame over on the boundary rather than drawing both", () => {
    // A version replaced at 22:15 and its replacement beginning at 22:15 would
    // otherwise both land on that frame, one over the other, which is the
    // shrink rendered as a smear.
    expect(at("2011-04-27T22:15:00Z")).toEqual(["second"]);
    expect(at("2011-04-27T22:30:00Z")).toEqual(["third"]);
  });

  it("shows nothing before it was issued or after it ended", () => {
    expect(at("2011-04-27T21:59:00Z")).toEqual([]);
    expect(at("2011-04-27T22:45:00Z")).toEqual([]);
  });

  it("keeps a polygon the archive never closed", () => {
    const open = parseArchiveWarnings({
      features: [polygon({ utc_polygon_end: null })],
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
  const WINDOW = [
    AT("2011-04-27T21:00:00Z"),
    AT("2011-04-27T23:00:00Z"),
  ] as const;

  async function fetched(url: string) {
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    return response.json();
  }

  it("answers with every polygon a warning held, not only its first", async () => {
    const parsed = parseArchiveWarnings(
      await fetched(archiveWarningsUrl(...WINDOW)),
      parseArchiveTags(await fetched(archiveTagsUrl(...WINDOW))),
    );
    expect(parsed.features.length).toBeGreaterThan(50);

    // The check that would have caught the first version of this layer. It
    // asked a service that answers with issuance polygons only, so every
    // warning was on the map for its opening shape and gone for the rest of
    // its life. A revision is a second polygon for the same event, and on
    // this day there are hundreds.
    const events = new Set(
      parsed.features.map((feature) => String(feature.properties.event)),
    );
    const revisions = parsed.features.length - events.size;
    // Hundreds of them on this day. The first version of this layer asked a
    // service that answers with issuance polygons only, so this was zero and
    // every revised warning fell off the map partway through its life.
    expect(revisions).toBeGreaterThan(100);

    for (const feature of parsed.features) {
      expect(typeof feature.properties.polygonBegin).toBe("number");
      expect(feature.properties.historical).toBe(true);
      expect(String(feature.properties.headline).length).toBeGreaterThan(3);
    }
  }, 120_000);

  it("keeps a warning on the map for as long as it was in force", async () => {
    const parsed = parseArchiveWarnings(
      await fetched(archiveWarningsUrl(...WINDOW)),
    );
    // Walk the window the way a reader scrubs it. A layer that only had the
    // issuance polygons thinned out badly towards the end of the window,
    // because every revised warning had already fallen off it.
    const counts = [0, 30, 60, 90].map((minutes) => {
      const shown = archiveWarningsAt(
        parsed,
        AT("2011-04-27T21:00:00Z") + minutes * 60_000,
      );
      return shown?.features.length ?? 0;
    });
    for (const count of counts) expect(count).toBeGreaterThan(20);
    // And an instant holds fewer than the whole window, which is the filter
    // doing its job rather than passing everything through.
    expect(Math.max(...counts)).toBeLessThan(parsed.features.length);
  }, 120_000);
});

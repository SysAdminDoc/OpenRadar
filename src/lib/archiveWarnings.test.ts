import { describe, expect, it } from "vitest";
import {
  archiveCoverage,
  archiveTagsUrl,
  archiveWarningsAt,
  archiveWarningsUrls,
  parseArchiveTags,
  parseArchiveWarnings,
  type ArchiveTags,
} from "./archiveWarnings";

const LIVE = process.env.OPENRADAR_LIVE === "1";

const AT = (iso: string) => Date.parse(iso);

/**
 * One answer, as the hook now hands over a list of them. The tests below are
 * about what the parser makes of a row, not about how many requests it took
 * to collect them; the merging has tests of its own.
 */
const parseOne = (payload: unknown, tags?: Map<string, ArchiveTags>) =>
  parseArchiveWarnings([payload], tags);

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
    const [short, long] = archiveWarningsUrls(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    // The interval service, and explicitly not the issuance-only default:
    // without this a warning disappears from the map the moment its office
    // first revised the polygon, which on 2011-04-27 was two thirds of the
    // tornado warnings.
    for (const url of [short, long]) {
      expect(url).toContain("/vtec/sbw_interval.geojson");
      expect(url).toContain("only_new=false");
      expect(url).toContain("endts=2011-04-28T01:00:00Z");
      // Seconds, no milliseconds: the archive rejects the fractional form.
      expect(url).not.toContain(".000Z");
    }
    // Issuance is what the window filters on, so it opens early enough to
    // catch a warning already in force when the replay starts. Two hours is
    // right for the products that fit in it.
    expect(short).toContain("begints=2011-04-27T17:00:00Z");
    expect(short).not.toContain("ph=");
  });

  it("looks ten days back for the products that hold a polygon that long", () => {
    // Not one tornado or severe thunderstorm polygon in the week of the 2011
    // outbreak lasted past 1.2 hours, and 389 of 518 areal flood polygons ran
    // past two. Asking two hours back for those loses a third of what was in
    // force at the first frame, all of it flooding.
    const [, long] = archiveWarningsUrls(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    expect(long).toContain("begints=2011-04-17T19:00:00Z");
    expect(long).toContain("ph=FA");
    expect(long).toContain("ph=FF");
  });

  it("links to the event rather than to a page that shows another one", () => {
    const [feature] = parseOne({ features: [polygon()] }).features;
    // The VTEC browser's router reads the query form first and needs all five
    // parts. `/vtec/event/<product_id>` parses as nothing, and the page then
    // falls through to its own defaults and shows an unrelated warning rather
    // than failing, which is worse than a broken link.
    const url = new URL(String(feature.properties.url));
    expect(url.pathname).toBe("/vtec/");
    expect(url.searchParams.get("year")).toBe("2011");
    expect(url.searchParams.get("wfo")).toBe("OUN");
    expect(url.searchParams.get("phenomena")).toBe("TO");
    expect(url.searchParams.get("significance")).toBe("W");
    expect(url.searchParams.get("eventid")).toBe("42");
  });

  it("merges the two answers without drawing the overlap twice", () => {
    // A flood warning issued inside the short window is in both answers.
    const flood = polygon({
      phenomena: "FF",
      event_label: "Flash Flood Warning",
      eventid: 46,
    });
    const merged = parseArchiveWarnings([
      { features: [flood] },
      { features: [flood] },
    ]);
    expect(merged.features).toHaveLength(1);
  });

  it("asks the tag feed for the same window", () => {
    const url = archiveTagsUrl(
      AT("2011-04-27T19:00:00Z"),
      AT("2011-04-28T01:00:00Z"),
    );
    expect(url).toContain("/geojson/sbw.py");
    // The short window only. This feed takes no phenomena filter, so the
    // flood products' ten days would be megabytes of issuance rows.
    expect(url).toContain("sts=2011-04-27T17:00:00Z");
    expect(url).toContain("ets=2011-04-28T01:00:00Z");
  });
});

describe("reading the archive", () => {
  it("gives a polygon the shape the live warnings layer already draws", () => {
    const [feature] = parseOne({
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
    // hailtag is a JSON number on this service, not a string. Reading it as a
    // string dropped every hail size the archive had and, because a row with
    // no damage tag carries nothing else, dropped the row with it.
    const tags = parseArchiveTags({
      features: [tagRow({ damagetag: "CONSIDERABLE", hailtag: 2.75 })],
    });
    const tagged = parseOne({ features: [polygon()] }, tags).features[0];
    expect(tagged.properties.impact).toBe("considerable");
    expect(tagged.properties.hailSize).toBe("2.75");

    // And a row whose only tag is the hail size still reaches the map.
    const hailOnly = parseArchiveTags({
      features: [tagRow({ hailtag: 1 })],
    });
    expect(
      parseOne({ features: [polygon()] }, hailOnly).features[0].properties
        .hailSize,
    ).toBe("1");

    // A tag row for a different event does not reach this one.
    const elsewhere = parseArchiveTags({
      features: [tagRow({ eventid: 43, damagetag: "DESTRUCTIVE" })],
    });
    expect(
      parseOne({ features: [polygon()] }, elsewhere).features[0].properties
        .impact,
    ).toBe("");
  });

  it("reads a damage threat however the tag feed spelled it", () => {
    const impactOf = (row: Record<string, unknown>) =>
      parseOne(
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
    const parsed = parseOne({
      features: [polygon({ status: "CAN" }), polygon({ status: "CON" })],
    });
    expect(parsed.features).toHaveLength(1);
  });

  it("draws the worst first, the way the live layer does", () => {
    const parsed = parseOne({
      // Three different warnings, so three different event numbers. Sharing
      // one would make them three polygons of a single event, which the
      // merge quite rightly reduces to one.
      features: [
        polygon({
          event_label: "Flood Advisory",
          significance: "Y",
          eventid: 11,
        }),
        polygon({ event_label: "Tornado Warning", eventid: 12 }),
        polygon({
          event_label: "Severe Thunderstorm Warning",
          phenomena: "SV",
          eventid: 13,
        }),
      ],
    });
    expect(parsed.features.map((f) => f.properties.headline)).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Flood Advisory",
    ]);
  });

  it("drops an entry it cannot place in time or name", () => {
    const parsed = parseOne({
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
    expect(parseOne(null).features).toEqual([]);
    expect(parseOne({}).features).toEqual([]);
    expect(parseOne({ features: "no" }).features).toEqual([]);
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

  const shrinking = parseOne({
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
    const open = parseOne({
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

  /** Seconds, no milliseconds, which is the only form the archive accepts. */
  const stampUtc = (at: number) =>
    `${new Date(at).toISOString().slice(0, 19)}Z`;

  async function fetched(url: string) {
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    return response.json();
  }

  const polygons = async (window: readonly [number, number] = WINDOW) =>
    Promise.all(archiveWarningsUrls(...window).map((url) => fetched(url)));

  /**
   * A frame of Hurricane Helene, where the flooding is the weather.
   *
   * The outbreak window above is the right one for revisions and for the
   * short-fuse products, and it is exactly the wrong one for the flood
   * products: that week holds not a single river flood polygon. At 12Z on
   * this day, 161 warnings were in force and 100 of them were river flood
   * warnings.
   */
  const TROPICAL = [
    AT("2024-09-27T12:00:00Z"),
    AT("2024-09-27T18:00:00Z"),
  ] as const;

  it("answers with every polygon a warning held, not only its first", async () => {
    const parsed = parseArchiveWarnings(
      await polygons(),
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
    const parsed = parseArchiveWarnings(await polygons());
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

  it("holds the flood warnings that were in force before the window opened", async () => {
    // The check the first version of this contract could not make. At the
    // first frame of this window the short request alone finds 52 warnings in
    // force and the pair finds 82; the thirty it missed were all flooding,
    // because the service filters on issuance and an areal flood polygon can
    // stand for days.
    const parsed = parseArchiveWarnings(await polygons());
    const at = WINDOW[0];
    const shown = archiveWarningsAt(parsed, at);
    expect(shown?.features.length).toBeGreaterThan(70);

    // Most of the difference was issued before the short window even opens,
    // which is the whole reason for the wide requests.
    const early = (shown?.features ?? []).filter(
      (feature) => Number(feature.properties.polygonBegin) < at - 2 * 3_600_000,
    );
    expect(early.length).toBeGreaterThan(20);
  }, 120_000);

  it("misses nothing an unfiltered search of the same frame would find", async () => {
    // The check the first version of this could not make. Asserting that the
    // early rows are all flood products is a tautology: the only requests
    // that can produce one ask for flood products, so it passes however many
    // other long-lived products are missing. This asks the service for every
    // phenomenon over a month and requires the app's own requests to find the
    // same warnings in force at the frame.
    //
    // It is the check that would have caught river flood warnings being left
    // out of the list. On a tropical frame they are most of the map, and the
    // tornado outbreak the split was measured on holds not one.
    const at = TROPICAL[0];
    const wide = await fetched(
      "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson" +
        `?begints=${stampUtc(at - 30 * 86_400_000)}` +
        `&endts=${stampUtc(TROPICAL[1])}&only_new=false`,
    );
    const truth = archiveWarningsAt(parseArchiveWarnings([wide]), at);
    const mine = archiveWarningsAt(
      parseArchiveWarnings(await polygons(TROPICAL)),
      at,
    );
    // A frame that is mostly flooding, so the comparison has something to
    // catch. Without this the whole check passes on an outbreak window with
    // the flood products removed from the list entirely.
    expect(truth?.features.length).toBeGreaterThan(120);

    const named = (data: ReturnType<typeof archiveWarningsAt>) =>
      new Set(
        (data?.features ?? []).map((one) => String(one.properties.event)),
      );
    const held = named(mine);
    expect([...named(truth)].filter((event) => !held.has(event))).toEqual([]);
  }, 180_000);
});

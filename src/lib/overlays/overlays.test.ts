import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertSeverity,
  alertWidths,
  alertsOverlay,
  parseAlertTags,
  parseAlerts,
  resetAlertTags,
} from "./alerts";
import { earthquakesOverlay, parseEarthquakes } from "./earthquakes";
import { parseWildfires, wildfiresOverlay } from "./wildfires";
import {
  boundsContain,
  boundsOverlap,
  featureBounds,
  padBounds,
  relativeTime,
} from "./registry";

afterEach(() => {
  // The tag feed is shared and cached, so one case must not carry its
  // answer into the next.
  resetAlertTags();
  vi.unstubAllGlobals();
});

describe("alert severity", () => {
  it("lifts life-threatening warnings above the CAP code", () => {
    expect(alertSeverity("Tornado Warning", "W")).toBe("extreme");
    expect(alertSeverity("Flash Flood Emergency", " ")).toBe("extreme");
    expect(alertSeverity("Severe Thunderstorm Warning", "W")).toBe("severe");
    expect(alertSeverity("Tornado Watch", "A")).toBe("moderate");
    expect(alertSeverity("Heat Advisory", "Y")).toBe("minor");
  });

  it("falls back to the product name when the code is blank", () => {
    expect(alertSeverity("Flood Warning", " ")).toBe("severe");
    expect(alertSeverity("Fire Weather Watch", "")).toBe("moderate");
    expect(alertSeverity("Special Weather Statement", " ")).toBe("minor");
  });
});

describe("alert parsing", () => {
  const payload = {
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-99, 41],
              [-98, 41],
              [-98, 42],
              [-99, 41],
            ],
          ],
        },
        properties: {
          prod_type: "Heat Advisory",
          sig: "Y",
          wfo: "OAX",
          url: "https://api.weather.gov/alerts/a",
          issuance: "2026-08-30T01:03:00-05:00",
          expiration: "2026-08-30T21:00:00-05:00",
        },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-97, 35],
              [-96, 35],
              [-96, 36],
              [-97, 35],
            ],
          ],
        },
        properties: { prod_type: "Tornado Warning", sig: "W" },
      },
      { type: "Feature", properties: { prod_type: "Broken" } },
    ],
  };

  it("sorts the worst first and drops features with no geometry", () => {
    const parsed = parseAlerts(payload);
    expect(parsed.features).toHaveLength(2);
    expect(parsed.features[0].properties.headline).toBe("Tornado Warning");
    expect(parsed.features[0].properties.severity).toBe("extreme");
    expect(parsed.features[1].properties.office).toBe("OAX");
    expect(typeof parsed.features[1].properties.issued).toBe("number");
  });

  it("asks the service only for the requested envelope", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await alertsOverlay.fetchData({
      west: -100,
      south: 30,
      east: -90,
      north: 40,
    });

    // Two requests go out: the polygons for this view, and the national tag
    // feed which has no geometry of its own. The one that carries the
    // envelope is the one being checked.
    const asked = fetchMock.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    const polygons = asked.find((url) => url.includes("MapServer"));
    expect(polygons).toBeDefined();
    expect(polygons).toContain(
      "geometry=-100.0000%2C30.0000%2C-90.0000%2C40.0000",
    );
    expect(polygons).toContain("spatialRel=esriSpatialRelIntersects");

    // And the tag feed is national, so asking it for an envelope would be
    // asking for something it does not have.
    const tags = asked.find((url) => url.includes("api.weather.gov"));
    expect(tags).toBeDefined();
    expect(tags).not.toContain("geometry=");
  });

  it("has the damage threat on the very first draw of a session", async () => {
    // The tag feed and the polygon service are two requests, and the tags used
    // to be taken from whatever the build already held rather than waited for.
    // At the start of a session that is nothing, so every warning in force was
    // drawn without its threat and announced without it, and then a minute
    // later ranked higher and announced a second time as though the office had
    // said it got worse. The map was wrong in silence too: a catastrophic
    // tornado warning wore the ordinary outline for its first minute.
    const tagFeed = {
      features: [
        {
          properties: {
            id: "urn:oid:2.49.0.1.840.0.tornado.1",
            event: "Tornado Warning",
            parameters: { tornadoDamageThreat: ["CATASTROPHIC"] },
          },
        },
      ],
    };
    const polygons = {
      features: [
        {
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
            prod_type: "Tornado Warning",
            sig: "W",
            cap_id: "urn:oid:2.49.0.1.840.0.tornado.1",
            wfo: "OUN",
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("api.weather.gov")
          ? new Response(JSON.stringify(tagFeed), { status: 200 })
          : new Response(JSON.stringify(polygons), { status: 200 }),
      ),
    );

    const first = await alertsOverlay.fetchData({
      west: -100,
      south: 30,
      east: -90,
      north: 40,
    });
    expect(first.features).toHaveLength(1);
    expect(first.features[0].properties.impact).toBe("catastrophic");
  });

  it("keeps a shared tag read alive when one caller moves away", async () => {
    const tagFeed = {
      features: [
        {
          properties: {
            id: "shared-warning",
            event: "Tornado Warning",
            parameters: { tornadoDamageThreat: ["DESTRUCTIVE"] },
          },
        },
      ],
    };
    const polygons = {
      features: [
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
          properties: {
            cap_id: "shared-warning",
            prod_type: "Tornado Warning",
            sig: "W",
          },
        },
      ],
    };
    let finishTags: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn((url: unknown) => {
      if (String(url).includes("api.weather.gov")) {
        return new Promise<Response>((resolve) => {
          finishTags = resolve;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify(polygons), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const bounds = { west: -2, south: -2, east: 2, north: 2 };
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = alertsOverlay.fetchData(bounds, firstController.signal);
    const second = alertsOverlay.fetchData(bounds, secondController.signal);
    await Promise.resolve();
    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    expect(finishTags).not.toBeNull();
    finishTags!(new Response(JSON.stringify(tagFeed), { status: 200 }));
    const result = await second;
    expect(secondController.signal.aborted).toBe(false);
    expect(result.features[0].properties.impact).toBe("destructive");
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("api.weather.gov"),
      ),
    ).toHaveLength(1);
  });

  it("does not announce a standing warning twice while its tag catches up", async () => {
    // The same thing measured where it was heard: the watch says a warning is
    // worse than it was told, and re-announcing is how it says so. A tag that
    // simply had not been read yet is not the office changing its mind.
    const { alertsToAnnounce } = await import("../watch");
    const tagFeed = {
      features: [
        {
          properties: {
            id: "urn:oid:2.49.0.1.840.0.tornado.2",
            event: "Tornado Warning",
            parameters: { tornadoDamageThreat: ["CATASTROPHIC"] },
          },
        },
      ],
    };
    const polygons = {
      features: [
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-97.6, 35.4],
                [-97.4, 35.4],
                [-97.4, 35.6],
                [-97.6, 35.6],
                [-97.6, 35.4],
              ],
            ],
          },
          properties: {
            prod_type: "Tornado Warning",
            sig: "W",
            cap_id: "urn:oid:2.49.0.1.840.0.tornado.2",
            wfo: "OUN",
            expire: Date.now() + 3_600_000,
          },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("api.weather.gov")
          ? new Response(JSON.stringify(tagFeed), { status: 200 })
          : new Response(JSON.stringify(polygons), { status: 200 }),
      ),
    );

    const watch = {
      enabled: true,
      center: [-97.5, 35.5] as [number, number],
      radiusMiles: 50,
      minSeverity: "severe" as const,
      sound: false,
      label: "home",
    };
    const bounds = { west: -100, south: 30, east: -90, north: 40 };
    const announced = new Map<string, number>();
    const heard: string[] = [];
    const now = Date.now();

    for (let pass = 0; pass < 2; pass += 1) {
      const data = await alertsOverlay.fetchData(bounds);
      for (const alert of alertsToAnnounce(data, watch, announced, now)) {
        heard.push(alert.impact);
        announced.set(alert.id, alert.rank);
      }
    }

    expect(heard).toEqual(["catastrophic"]);
  });

  it("never waits for the tags again once it has them", async () => {
    // The wait is a cold start only. The feed is a megabyte and a half of
    // every alert in the country and it goes stale every minute, so waiting on
    // the refresh would put it in front of the polygons on the first pan after
    // each minute, which is the thing the shared cache exists to avoid.
    const polygons = { features: [] };
    const tagFeed = { features: [] };
    let tagReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (!String(url).includes("api.weather.gov")) {
          return new Response(JSON.stringify(polygons), { status: 200 });
        }
        tagReads += 1;
        // The first read answers. The refresh never does, which is what a
        // feed having a bad minute looks like.
        if (tagReads === 1) {
          return new Response(JSON.stringify(tagFeed), { status: 200 });
        }
        return new Promise<Response>(() => {});
      }),
    );

    const bounds = { west: -100, south: 30, east: -90, north: 40 };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await alertsOverlay.fetchData(bounds);
      expect(tagReads).toBe(1);

      // Past the minute the tags are held for, so the next read starts one.
      await vi.advanceTimersByTimeAsync(61_000);

      let settled = false;
      const second = alertsOverlay.fetchData(bounds).then((data) => {
        settled = true;
        return data;
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(
        settled,
        "the polygons waited on a tag feed that never answered",
      ).toBe(true);
      await second;
      expect(tagReads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the tag feed once for a run of views", async () => {
    // It is a megabyte and a half of every active alert in the country,
    // unpaginated, and it is asked for beside every bounds-limited polygon
    // query: on the overlay's own minute, on the watch's forty-five seconds,
    // and on every pan past the padded bounds.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const west of [-100, -99, -98, -97]) {
      await alertsOverlay.fetchData({ west, south: 30, east: -90, north: 40 });
    }

    const asked = fetchMock.mock.calls.map((call) =>
      String((call as unknown[])[0]),
    );
    expect(asked.filter((url) => url.includes("MapServer"))).toHaveLength(4);
    expect(asked.filter((url) => url.includes("api.weather.gov"))).toHaveLength(
      1,
    );
  });

  it("reports the status when the service fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(
      alertsOverlay.fetchData({ west: -1, south: -1, east: 1, north: 1 }),
    ).rejects.toThrow(/500/);
  });
});

describe("earthquake parsing", () => {
  it("keeps magnitude ordering and drops entries with no magnitude", () => {
    const parsed = parseEarthquakes({
      features: [
        {
          geometry: { type: "Point", coordinates: [-66.4, 18.9, 12] },
          properties: { mag: 4.2, place: "Puerto Rico", time: 1788068822828 },
        },
        {
          geometry: { type: "Point", coordinates: [-120, 36, 5] },
          properties: { mag: 5.8, place: "California", time: 1788068822828 },
        },
        {
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { place: "Nowhere" },
        },
      ],
    });

    expect(
      parsed.features.map((feature) => feature.properties.magnitude),
    ).toEqual([5.8, 4.2]);
    expect(parsed.features[1].properties.depthKm).toBe(12);
  });

  it("describes an event with its age and depth", () => {
    const description = earthquakesOverlay.describe({
      magnitude: 4.2,
      place: "Puerto Rico",
      depthKm: 12,
      time: Date.now() - 90 * 60_000,
      url: "https://earthquake.usgs.gov/x",
    });
    expect(description.title).toBe("M 4.2 Puerto Rico");
    // The abbreviation went with the split: an age is said one way
    // everywhere now, because the same age used to read "2 h ago" here
    // and "4908 min old" under the map.
    expect(description.lines[0]).toContain("2 hours ago");
    expect(description.url).toBe("https://earthquake.usgs.gov/x");
  });
});

describe("wildfire parsing", () => {
  it("orders by acreage and reports containment", () => {
    const parsed = parseWildfires({
      features: [
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-120, 40],
                [-119, 40],
                [-119, 41],
                [-120, 40],
              ],
            ],
          },
          properties: {
            poly_IncidentName: "Small",
            poly_GISAcres: 220,
            attr_PercentContained: 40,
            poly_DateCurrent: 1788000000000,
          },
        },
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-121, 40],
                [-120, 40],
                [-120, 41],
                [-121, 40],
              ],
            ],
          },
          properties: { poly_IncidentName: "Large", poly_GISAcres: 9000 },
        },
      ],
    });

    expect(parsed.features[0].properties.name).toBe("Large");
    const description = wildfiresOverlay.describe(
      parsed.features[1].properties,
    );
    expect(description.lines[0]).toBe("220 acres, 40% contained");
  });
});

describe("bounds helpers", () => {
  it("measures a polygon and tests overlap and containment", () => {
    const bounds = featureBounds({
      type: "Polygon",
      coordinates: [
        [
          [-99, 41],
          [-98, 41],
          [-98, 42],
          [-99, 41],
        ],
      ],
    });
    expect(bounds).toEqual({ west: -99, south: 41, east: -98, north: 42 });
    expect(
      boundsOverlap(bounds!, {
        west: -98.5,
        south: 41.5,
        east: -90,
        north: 45,
      }),
    ).toBe(true);
    expect(
      boundsOverlap(bounds!, { west: -80, south: 30, east: -70, north: 35 }),
    ).toBe(false);
    expect(featureBounds({ type: "Polygon" })).toBeNull();
  });

  it("pads a viewport and reports what the padded box covers", () => {
    const padded = padBounds(
      { west: -100, south: 30, east: -90, north: 40 },
      0.5,
    );
    expect(padded).toEqual({ west: -105, south: 25, east: -85, north: 45 });
    expect(
      boundsContain(padded, { west: -100, south: 30, east: -90, north: 40 }),
    ).toBe(true);
    expect(
      boundsContain(padded, { west: -140, south: 30, east: -90, north: 40 }),
    ).toBe(false);
  });

  it("keeps clamped padding inside the world", () => {
    expect(
      padBounds({ west: -179, south: -84, east: 179, north: 84 }, 0.5),
    ).toEqual({
      west: -180,
      south: -85,
      east: 180,
      north: 85,
    });
  });

  it("says how long ago a snapshot was taken", () => {
    const now = Date.UTC(2026, 7, 30, 12, 0, 0);
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 20 * 60_000, now)).toBe("20 min ago");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 hours ago");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4 days ago");
  });
});

describe("the damage threat an office attaches to a warning", () => {
  // The shape the alert feed actually publishes: every parameter is a list,
  // because one alert can carry several of the same kind. Taken from a live
  // response on 2026-08-30, which had one tagged warning in three hundred.
  const feed = {
    type: "FeatureCollection",
    features: [
      {
        properties: {
          id: "urn:oid:2.49.0.1.840.0.aaa.001.1",
          event: "Severe Thunderstorm Warning",
          parameters: {
            AWIPSidentifier: ["SVRFWD"],
            thunderstormDamageThreat: ["CONSIDERABLE"],
            maxHailSize: ["2.00"],
            eventMotionDescription: [
              "2026-08-30T19:53:00-00:00...storm...260DEG",
            ],
          },
        },
      },
      {
        properties: {
          id: "urn:oid:2.49.0.1.840.0.bbb.001.1",
          event: "Tornado Warning",
          parameters: { tornadoDamageThreat: ["DESTRUCTIVE"] },
        },
      },
      {
        properties: {
          id: "urn:oid:2.49.0.1.840.0.ccc.001.1",
          event: "Flood Warning",
          parameters: { AWIPSidentifier: ["FLWFWD"] },
        },
      },
    ],
  };

  it("reads both kinds of threat, and nothing where there is none", () => {
    const tags = parseAlertTags(feed);
    expect(tags.get("urn:oid:2.49.0.1.840.0.aaa.001.1")?.impact).toBe(
      "considerable",
    );
    expect(tags.get("urn:oid:2.49.0.1.840.0.aaa.001.1")?.hailSize).toBe("2.00");
    expect(tags.get("urn:oid:2.49.0.1.840.0.bbb.001.1")?.impact).toBe(
      "destructive",
    );
    // Most warnings carry no threat at all and must read exactly as before.
    expect(tags.get("urn:oid:2.49.0.1.840.0.ccc.001.1")?.impact).toBeNull();
    expect(parseAlertTags(null).size).toBe(0);
    expect(parseAlertTags({ features: "not a list" }).size).toBe(0);
  });

  it("keeps the stronger of two threats on one warning", () => {
    const both = parseAlertTags({
      features: [
        {
          properties: {
            id: "x",
            parameters: {
              tornadoDamageThreat: ["CONSIDERABLE"],
              thunderstormDamageThreat: ["DESTRUCTIVE"],
            },
          },
        },
      ],
    });
    expect(both.get("x")?.impact).toBe("destructive");
  });

  it("joins the tag to the polygon by the identifier both carry", () => {
    // The polygons come from one service and the tags from another. The
    // service the polygons come from has no threat field at all: its columns
    // are the product type, the office and the times.
    const polygons = {
      features: [
        {
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            cap_id: "urn:oid:2.49.0.1.840.0.bbb.001.1",
            prod_type: "Tornado Warning",
            sig: "W",
          },
        },
        {
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            cap_id: "urn:oid:2.49.0.1.840.0.ccc.001.1",
            prod_type: "Flood Warning",
            sig: "W",
          },
        },
      ],
    };
    const drawn = parseAlerts(polygons, parseAlertTags(feed));
    const tornado = drawn.features.find(
      (feature) => feature.properties.headline === "Tornado Warning",
    );
    const flood = drawn.features.find(
      (feature) => feature.properties.headline === "Flood Warning",
    );
    expect(tornado?.properties.impact).toBe("destructive");
    expect(tornado?.properties.impactRank).toBe(2);
    expect(flood?.properties.impact).toBe("");
    expect(flood?.properties.impactRank).toBe(0);
  });

  it("draws the alerts even when the tag feed does not answer", () => {
    // The map is the thing people act on. A warning with no tag is an
    // ordinary warning; a warning that never appeared is a warning nobody saw.
    const polygons = {
      features: [
        {
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: { cap_id: "x", prod_type: "Tornado Warning", sig: "W" },
        },
      ],
    };
    const drawn = parseAlerts(polygons, parseAlertTags(null));
    expect(drawn.features).toHaveLength(1);
    expect(drawn.features[0].properties.impact).toBe("");
  });

  it("puts a tagged warning over an untagged one of the same kind", () => {
    const polygons = {
      features: [
        {
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            cap_id: "ccc-none",
            prod_type: "Tornado Warning",
            sig: "W",
          },
        },
        {
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            cap_id: "urn:oid:2.49.0.1.840.0.bbb.001.1",
            prod_type: "Tornado Warning",
            sig: "W",
          },
        },
      ],
    };
    const drawn = parseAlerts(polygons, parseAlertTags(feed));
    expect(drawn.features[0].properties.impact).toBe("destructive");
  });
});

describe("how heavily a warning is outlined", () => {
  /** The widths out of the expression, in the order the cases are written. */
  const widths = (highContrast: boolean) =>
    (alertWidths(highContrast) as unknown[]).filter(
      (part): part is number => typeof part === "number",
    );

  it("draws every outline heavier under more contrast", () => {
    const ordinary = widths(false);
    const contrast = widths(true);
    expect(ordinary).toEqual([4, 3, 2.2, 1.2]);
    expect(contrast).toHaveLength(ordinary.length);
    for (const [index, width] of contrast.entries()) {
      expect(width).toBeGreaterThan(ordinary[index]);
    }
  });

  it("keeps the four apart, so the tag still reads off the map", () => {
    // The colours are the alert severities and are not ours to change, so the
    // ordering between a destructive warning and an ordinary one has to
    // survive the whole set moving.
    const contrast = widths(true);
    expect(contrast).toEqual([...contrast].sort((a, b) => b - a));
    expect(new Set(contrast).size).toBe(contrast.length);
  });
});

const LIVE = process.env.OPENRADAR_LIVE === "1";

/**
 * Warnings are the highest-consequence layer in the app and the only one a
 * reader might act on, so the contract with the service that publishes them is
 * the one most worth checking against the service itself.
 */
describe.runIf(LIVE)("against the live warnings service", () => {
  // The whole country. Somewhere in it there is always something in force,
  // even on a quiet day: a marine statement, a heat advisory, a flood watch.
  const bounds = { west: -125, south: 24, east: -66, north: 50 };

  it("answers with alerts shaped the way the map reads them", async () => {
    const data = await alertsOverlay.fetchData(bounds);
    expect(data.type).toBe("FeatureCollection");
    // An empty answer over the whole United States means the query shape is
    // wrong rather than the weather being quiet.
    expect(data.features.length).toBeGreaterThan(0);

    for (const feature of data.features.slice(0, 40)) {
      const properties = feature.properties;
      // Every field the drawing and the watch depend on.
      expect(String(properties.headline).length).toBeGreaterThan(0);
      expect(["extreme", "severe", "moderate", "minor"]).toContain(
        String(properties.severity),
      );
      expect(properties.severityRank).toBeTypeOf("number");
      expect(String(properties.kind).length).toBeGreaterThan(0);
      expect(feature.geometry.type).toMatch(/Polygon/);
      // The identity the watch keys on, so the same warning is not announced
      // twice. Without it the fallback id embeds the polygon, and a warning
      // whose polygon is redrawn looks new.
      expect(String(properties.url).length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("gives every alert a time that can be compared", async () => {
    const data = await alertsOverlay.fetchData(bounds);
    for (const feature of data.features.slice(0, 40)) {
      const expires = feature.properties.expires;
      // Null is allowed; a string is not, because the watch compares it as a
      // number and a string would silently never expire.
      if (expires !== null) expect(expires).toBeTypeOf("number");
    }
  }, 30_000);
});

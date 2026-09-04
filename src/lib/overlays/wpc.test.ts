import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  ERO_DAYS,
  WSSI_DAYS,
  eroLayer,
  wpcExcessiveRainOverlay,
  wpcTime,
  wpcWinterSeverityOverlay,
  wssiLayer,
} from "./wpc";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** The shape the service answers with, taken from a real response. */
function feature(field: string, value: string) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-100, 35],
          [-99, 35],
          [-99, 36],
          [-100, 36],
          [-100, 35],
        ],
      ],
    },
    properties: {
      [field]: value,
      valid_time: "16Z 09/03/26 - 12Z 09/04/26",
      issue_time: "2026-09-03 15:57:00",
    },
  };
}

function collection(features: unknown[]) {
  return { type: "FeatureCollection", features };
}

/** Where the last stubbed fetch was pointed, so the address can be checked. */
let lastUrl = "";

async function drawn(
  overlay: typeof wpcExcessiveRainOverlay,
  payload: unknown,
  choices = DEFAULT_OVERLAY_CHOICES,
) {
  const original = globalThis.fetch;
  lastUrl = "";
  globalThis.fetch = ((input: RequestInfo | URL) => {
    lastUrl = String(input);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
  }) as unknown as typeof fetch;
  try {
    return await overlay.fetchData(
      { west: -104, south: 30, east: -90, north: 42 },
      undefined,
      choices,
    );
  } finally {
    globalThis.fetch = original;
  }
}

describe("which layer a day means", () => {
  it("is one behind for the rainfall outlook and level for the index", () => {
    // The two services number their layers differently and the mistake is
    // silent: an off-by-one draws Day 2's outlook under a Day 1 heading, which
    // is a forecast for the wrong day rather than a missing layer.
    expect(eroLayer(1)).toContain("/MapServer/0/query");
    expect(eroLayer(5)).toContain("/MapServer/4/query");
    expect(wssiLayer(1)).toContain("/MapServer/1/query");
    expect(wssiLayer(3)).toContain("/MapServer/3/query");
  });

  it("gives every day its own layer and no other", () => {
    const ero = new Set(ERO_DAYS.map(eroLayer));
    expect(ero.size).toBe(ERO_DAYS.length);
    const wssi = new Set(WSSI_DAYS.map(wssiLayer));
    expect(wssi.size).toBe(WSSI_DAYS.length);
    // And the two services never name the same layer, because the day-1
    // group layer on the index side is layer 0 and is not one of these.
    for (const url of wssi) expect(ero.has(url)).toBe(false);
  });

  it("stays inside the days each service publishes", () => {
    // A hand-edited settings file is the only way to get here, and asking for
    // a layer the service does not have would fail every request rather than
    // fall back to a day it does have.
    expect(eroLayer(0)).toBe(eroLayer(1));
    expect(eroLayer(99)).toBe(eroLayer(5));
    expect(wssiLayer(-4)).toBe(wssiLayer(1));
    expect(wssiLayer(9)).toBe(wssiLayer(3));
  });
});

describe("the times the services stamp", () => {
  it("reads them as UTC rather than as local", () => {
    // The service writes "2026-09-03 15:57:00" with no zone marker, and a
    // browser reads a string in that shape as local time. Passed to `Date`
    // directly, every issue time moved by the reader's own offset, which in
    // Denver is six hours of a forecast that is reissued every four.
    expect(wpcTime("2026-09-03 15:57:00")).toBe(Date.UTC(2026, 8, 3, 15, 57));
    expect(wpcTime("2026-09-03 1615Z")).toBe(Date.UTC(2026, 8, 3, 16, 15));
    expect(wpcTime("")).toBeNull();
    expect(wpcTime(null)).toBeNull();
    expect(wpcTime("tomorrow afternoon")).toBeNull();
  });
});

describe("the bands the two services publish", () => {
  it("reads a category that carries its own probability", async () => {
    // The excessive rainfall outlook writes the probability into the category:
    // "Marginal (At Least 5%)". Matched whole, every feature was dropped and
    // the layer drew nothing at all.
    const data = await drawn(
      wpcExcessiveRainOverlay,
      collection([
        feature("outlook", "Marginal (At Least 5%)"),
        feature("outlook", "Moderate (At Least 40%)"),
        feature("outlook", "Slight (At Least 15%)"),
      ]),
    );
    expect(data.features).toHaveLength(3);
    // Worst last, which is on top.
    expect(data.features.map((one) => one.properties.risk)).toEqual([
      "Marginal (At Least 5%)",
      "Slight (At Least 15%)",
      "Moderate (At Least 40%)",
    ]);
    for (const one of data.features) {
      expect(String(one.properties.fill)).toMatch(/^#[0-9a-f]{6}$/);
      expect(String(one.properties.stroke)).toMatch(/^#[0-9a-f]{6}$/);
      expect(one.properties.issue).toBe(Date.UTC(2026, 8, 3, 15, 57));
    }
  });

  it("orders the severity index by impact rather than by arrival", async () => {
    const data = await drawn(
      wpcWinterSeverityOverlay,
      collection([
        feature("impact", "EXTREME"),
        feature("impact", "MINOR"),
        feature("impact", "WINTER WEATHER AREA"),
        feature("impact", "MAJOR"),
      ]),
    );
    expect(data.features.map((one) => one.properties.risk)).toEqual([
      "WINTER WEATHER AREA",
      "MINOR",
      "MAJOR",
      "EXTREME",
    ]);
  });

  it("leaves out a category it does not know rather than guessing a colour", async () => {
    // A band renamed upstream is a band nobody has a colour for. Painted a
    // fallback it would look like a real one; left out, the map is short of
    // an area and the rest is still true.
    const data = await drawn(
      wpcExcessiveRainOverlay,
      collection([
        feature("outlook", "Marginal (At Least 5%)"),
        feature("outlook", "Catastrophic (At Least 90%)"),
      ]),
    );
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.risk).toContain("Marginal");
  });
});

describe("what the popup says", () => {
  it("says it is an outlook, not a warning", () => {
    // The whole risk of drawing a forecast under a warnings layer: a reader
    // who takes a Moderate risk area for a flood warning acts on something
    // that has not happened.
    for (const overlay of [wpcExcessiveRainOverlay, wpcWinterSeverityOverlay]) {
      const described = overlay.describe({
        risk: "Moderate (At Least 40%)",
        window: "16Z 09/03/26 - 12Z 09/04/26",
        issue: Date.UTC(2026, 8, 3, 15, 57),
      });
      expect(described.lines.join(" ")).toContain("outlook, not a warning");
      expect(described.lines.join(" ")).toContain("16Z 09/03/26");
    }
  });

  it("says what the severity index measures", () => {
    const described = wpcWinterSeverityOverlay.describe({ risk: "MAJOR" });
    expect(described.lines.join(" ")).toContain("Impact rather than amount");
  });
});

describe("the day a change of choice asks for", () => {
  it("is named in the variant, so a change is a different picture", () => {
    // The hook compares this against the snapshot on the map. Two days that
    // named the same variant would leave Day 1 on screen with Day 3 selected
    // until the refresh came round.
    const seen = new Set(
      ERO_DAYS.map((wpcDay) =>
        wpcExcessiveRainOverlay.variant?.({
          ...DEFAULT_OVERLAY_CHOICES,
          wpcDay,
          wssiDay: 1,
        }),
      ),
    );
    expect(seen.size).toBe(ERO_DAYS.length);
    const winter = new Set(
      WSSI_DAYS.map((wssiDay) =>
        wpcWinterSeverityOverlay.variant?.({
          ...DEFAULT_OVERLAY_CHOICES,
          wpcDay: 1,
          wssiDay,
        }),
      ),
    );
    expect(winter.size).toBe(WSSI_DAYS.length);
    // And neither moves when the other one does.
    expect(
      wpcExcessiveRainOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        wpcDay: 2,
        wssiDay: 1,
      }),
    ).toBe(
      wpcExcessiveRainOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        wpcDay: 2,
        wssiDay: 3,
      }),
    );
    expect(
      wpcWinterSeverityOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        wpcDay: 1,
        wssiDay: 2,
      }),
    ).toBe(
      wpcWinterSeverityOverlay.variant?.({
        ...DEFAULT_OVERLAY_CHOICES,
        wpcDay: 5,
        wssiDay: 2,
      }),
    );
  });
});

describe.runIf(LIVE)("against the live services", () => {
  const bounds = { west: -125, south: 24, east: -66, north: 50 };

  it("reads the excessive rainfall outlook for every day it publishes", async () => {
    let drawn = 0;
    for (const wpcDay of ERO_DAYS) {
      const data = await wpcExcessiveRainOverlay.fetchData(bounds, undefined, {
        ...DEFAULT_OVERLAY_CHOICES,
        wpcDay,
      });
      drawn += data.features.length;
      for (const one of data.features) {
        expect(String(one.properties.fill)).toMatch(/^#[0-9a-f]{6}$/);
        expect(String(one.properties.risk)).not.toBe("");
        expect(one.geometry.type).toMatch(/Polygon/);
      }
    }
    // Across all five days, not on any one of them. WPC marks at least a
    // marginal area somewhere in the country on all but the quietest weeks,
    // so nothing at all over five days says the query shape is wrong far more
    // often than it says the country is dry. Per-day it would be a claim about
    // the weather; this is a claim about the service answering.
    expect(drawn).toBeGreaterThan(0);
  }, 60_000);

  it("reads the severity index for every day it publishes", async () => {
    for (const wssiDay of WSSI_DAYS) {
      const data = await wpcWinterSeverityOverlay.fetchData(bounds, undefined, {
        ...DEFAULT_OVERLAY_CHOICES,
        wssiDay,
      });
      // The collection itself, asserted before the loop over it. In July the
      // index is empty across the country and a loop body is the only thing
      // this test had: it passed having executed no assertion at all, which
      // is the same as not running.
      expect(Array.isArray(data.features)).toBe(true);
      for (const one of data.features) {
        expect(String(one.properties.fill)).toMatch(/^#[0-9a-f]{6}$/);
        expect(one.geometry.type).toMatch(/Polygon/);
      }
    }
    // And the service answered rather than 404ing, which is what a wrong layer
    // number would do: the query helper throws on anything but a 200, so
    // reaching this line for all three days is that claim.
    expect(WSSI_DAYS.length).toBe(3);
  }, 60_000);
});

describe("the address a day actually goes to", () => {
  it("is the service's own layer for that day, not a restatement", () => {
    // The unit tests above compare `eroLayer` against itself, which cannot
    // catch the two services numbering their days differently. This reads the
    // address the adapter handed to `fetch`, which is the thing that goes out.
    return (async () => {
      for (const [wpcDay, layer] of [
        [1, 0],
        [3, 2],
        [5, 4],
      ] as const) {
        await drawn(wpcExcessiveRainOverlay, collection([]), {
          ...DEFAULT_OVERLAY_CHOICES,
          wpcDay,
        });
        expect(lastUrl).toContain(
          `/hazards/wpc_precip_hazards/MapServer/${layer}/query`,
        );
        expect(lastUrl).toContain("outFields=outlook");
      }
      for (const [wssiDay, layer] of [
        [1, 1],
        [3, 3],
      ] as const) {
        await drawn(wpcWinterSeverityOverlay, collection([]), {
          ...DEFAULT_OVERLAY_CHOICES,
          wssiDay,
        });
        expect(lastUrl).toContain(
          `/outlooks/wpc_wssi/MapServer/${layer}/query`,
        );
        expect(lastUrl).toContain("outFields=impact");
      }
    })();
  });

  it("never asks the severity index for the group of every day", () => {
    // Layer 0 there is "Overall Impact" across all three days at once, which
    // would draw three days of areas under a heading naming one.
    return (async () => {
      for (const wssiDay of WSSI_DAYS) {
        await drawn(wpcWinterSeverityOverlay, collection([]), {
          ...DEFAULT_OVERLAY_CHOICES,
          wssiDay,
        });
        expect(lastUrl).not.toContain("wpc_wssi/MapServer/0/query");
      }
    })();
  });
});

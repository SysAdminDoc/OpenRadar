import { describe, expect, it } from "vitest";
import { REPORT_HOURS, parseReports, stormReportsOverlay } from "./reports";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** One report, in the shape the feed answers with. */
function report(over: Record<string, unknown> = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-99.8, 45.37] },
    properties: {
      wfo: "ABR",
      type: "H",
      magf: 1.5,
      typetext: "HAIL",
      city: "9 SW Bowdle",
      state: "SD",
      st: "SD",
      source: "Public",
      unit: "Inch",
      remark: "Hail was a variety of sizes.",
      valid: "2026-08-29T22:50:00Z",
      ...over,
    },
  };
}

describe("what people on the ground saw", () => {
  it("keeps the measurement and the unit it was made in", () => {
    // An inch of hail and sixty miles an hour of wind are both a magnitude,
    // and only the unit says which. Guessing it from the report type would put
    // inches on a gust.
    const [feature] = parseReports({ features: [report()] }).features;
    expect(feature.properties.magnitude).toBe(1.5);
    expect(feature.properties.unit).toBe("Inch");
    expect(feature.properties.kind).toBe("hail");
    expect(feature.properties.label).toBe("HAIL");
  });

  it("colours a report by what it is about", () => {
    const kinds = parseReports({
      features: [
        report({ type: "H" }),
        report({ type: "G" }),
        report({ type: "W" }),
        report({ type: "F" }),
        // A type the feed has and this does not name is still a report.
        report({ type: "S", typetext: "SNOW" }),
      ],
    }).features.map((feature) => feature.properties.kind);

    expect(kinds).toEqual(["hail", "wind", "tornado", "flood", "other"]);
  });

  it("draws the newest report on top where two land together", () => {
    const times = parseReports({
      features: [
        report({ valid: "2026-08-30T02:00:00Z" }),
        report({ valid: "2026-08-29T22:50:00Z" }),
        report({ valid: "2026-08-30T00:15:00Z" }),
      ],
    }).features.map((feature) => feature.properties.at);

    // A GeoJSON source draws its features in order, so last is on top.
    expect(times).toEqual([...(times as number[])].sort((a, b) => a - b));
  });

  it("drops a record with no time or no place on the map", () => {
    const parsed = parseReports({
      features: [
        report({ valid: "not a time" }),
        { type: "Feature", geometry: { type: "Polygon" }, properties: {} },
        { type: "Feature", properties: report().properties },
        report(),
      ],
    });
    expect(parsed.features).toHaveLength(1);
  });

  it("survives a report with nothing measured", () => {
    // Wind damage is reported without a number, which is not the same as zero.
    const [feature] = parseReports({
      features: [
        report({ type: "D", typetext: "TSTM WND DMG", magf: null, unit: null }),
      ],
    }).features;
    expect(feature.properties.magnitude).toBeNull();
    expect(feature.properties.unit).toBe("");
  });
});

describe.runIf(LIVE)("against the live feed", () => {
  it("reads the last day of reports", async () => {
    const data = await stormReportsOverlay.fetchData({
      west: -125,
      south: 24,
      east: -66,
      north: 50,
    });
    // The country sees reports every day; an empty answer means the query
    // shape is wrong rather than the weather being quiet.
    expect(data.features.length).toBeGreaterThan(0);
    const oldest = Math.min(
      ...data.features.map((feature) => Number(feature.properties.at)),
    );
    // Nothing older than the window that was asked for, with an hour of slack
    // for reports filed late.
    expect(Date.now() - oldest).toBeLessThan((REPORT_HOURS + 1) * 3_600_000);
    for (const feature of data.features) {
      expect(String(feature.properties.color)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(feature.geometry.type).toBe("Point");
    }
  }, 30_000);
});

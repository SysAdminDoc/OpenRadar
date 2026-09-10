import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  FIRMS_MIN_ZOOM,
  FIRMS_REFRESH_MS,
  FIRMS_SATELLITES,
  acquiredAt,
  firmsOverlay,
  parseFirms,
} from "./firms";

const LIVE = process.env.OPENRADAR_LIVE === "1";

/** Rows off the live NOAA-20 file for 2026-09-09, verbatim. */
const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
19.67409,-70.34541,309.42,0.4,0.37,2026-09-09,0620,N20,nominal,2.0NRT,293.34,1.66,N
19.67725,-71.70413,308.84,0.43,0.38,2026-09-09,0620,N20,low,2.0NRT,292.81,0.82,N
18.57804,-72.12615,325.08,0.44,0.38,2026-09-09,1815,N20,high,2.0NRT,293.94,4.2,D
`;

describe("what a satellite saw burning", () => {
  it("reads a detection, its confidence and when the pass was", () => {
    const drawn = parseFirms(CSV, "NOAA-20");
    expect(drawn).toHaveLength(3);
    const [first] = drawn;
    expect(first.geometry.coordinates).toEqual([-70.34541, 19.67409]);
    expect(first.properties.satellite).toBe("NOAA-20");
    // The algorithm's own word, kept as it wrote it: it is a term of art in
    // the product's documentation and renaming it is not translating it.
    expect(first.properties.confidence).toBe("nominal");
    expect(first.properties.frpMw).toBe(1.66);
    expect(first.properties.brightnessK).toBe(309.42);
    expect(first.properties.day).toBe(false);
    expect(first.properties.acquiredAt).toBe(
      Date.parse("2026-09-09T06:20:00Z"),
    );
    expect(drawn[2].properties.day).toBe(true);
    expect(drawn[2].properties.confidence).toBe("high");
  });

  it("refuses a file whose columns have moved", () => {
    // Everything this reads is read by position, so a reordered file would
    // put a longitude where a brightness goes and draw every fire in the
    // wrong place with nothing said. The header is the one thing that says
    // the positions still mean what they meant.
    const moved = CSV.replace("latitude,longitude", "longitude,latitude");
    expect(parseFirms(moved, "NOAA-20")).toEqual([]);
    expect(parseFirms("", "NOAA-20")).toEqual([]);
    expect(parseFirms("nothing like a csv", "NOAA-20")).toEqual([]);
  });

  it("reads the pass time as the UTC it is", () => {
    // Four digits of clock with no separator and no zone. Unlike the ground
    // networks on this map there is no local time to preserve: an orbit is a
    // UTC event, and the file's own documentation says so.
    expect(acquiredAt("2026-09-09", "0620")).toBe(
      Date.parse("2026-09-09T06:20:00Z"),
    );
    // Before ten in the morning the file writes three digits.
    expect(acquiredAt("2026-09-09", "620")).toBe(
      Date.parse("2026-09-09T06:20:00Z"),
    );
    expect(acquiredAt("2026-09-09", "0000")).toBe(
      Date.parse("2026-09-09T00:00:00Z"),
    );
    expect(acquiredAt("", "0620")).toBeNull();
    expect(acquiredAt("2026-09-09", "")).toBeNull();
    expect(acquiredAt("09/09/2026", "0620")).toBeNull();
  });

  it("says on every popup that a hot pixel is not a fire", () => {
    // The layer sits beside one that draws real fire perimeters somebody
    // walked. A pixel four hundred metres across that was hot when the
    // satellite went over is a different claim, and gas flares, furnaces and
    // sun glint all light one up.
    const [first] = parseFirms(CSV, "NOAA-20");
    const said = firmsOverlay.describe(first.properties);
    expect(said.title).toContain("NOAA-20");
    expect(said.lines.join(" ")).toContain("nominal");
    expect(said.lines.join(" ")).toContain("1.7 MW");
    expect(said.lines.at(-1)).toMatch(/not a confirmed fire/i);
  });

  it("says which spacecraft went missing rather than drawing half as all", async () => {
    const held = globalThis.fetch;
    let at = 0;
    globalThis.fetch = (async () => {
      const failing = at === 1;
      at += 1;
      return {
        ok: !failing,
        status: failing ? 503 : 200,
        text: async () => CSV,
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const data = await firmsOverlay.fetchData(
        { west: -180, south: -90, east: 180, north: 90 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      // Losing one spacecraft halves the looks. Drawn without a word it reads
      // as half the fires having gone out.
      expect(data.partial).toContain(FIRMS_SATELLITES[1].id);
      expect(data.features).toHaveLength(3);
    } finally {
      globalThis.fetch = held;
    }
  });

  it("asks once an hour for the whole country, per spacecraft", () => {
    expect(firmsOverlay.global).toBe(true);
    expect(firmsOverlay.refreshMs).toBe(FIRMS_REFRESH_MS);
    // The item's own ceiling is at most hourly.
    expect(FIRMS_REFRESH_MS).toBe(60 * 60_000);
    expect(firmsOverlay.minZoom).toBe(FIRMS_MIN_ZOOM);
    // Both platforms, because they are the same instrument crossing at
    // different times of day and one of them alone halves the looks.
    expect(FIRMS_SATELLITES).toHaveLength(2);
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("still publishes both files, in the columns this reads", async () => {
    const data = await firmsOverlay.fetchData(
      { west: -180, south: -90, east: 180, north: 90 },
      undefined,
      DEFAULT_OVERLAY_CHOICES,
    );
    expect(data.partial).toBeUndefined();
    // Something is burning somewhere in the country on any day of the year.
    // If the header ever moves, `parseFirms` answers with nothing and this
    // is what says so.
    expect(data.features.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const feature of data.features) {
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      const where = `${String(feature.properties.satellite)} at ${lat}, ${lon}`;
      expect(lat, where).toBeGreaterThanOrEqual(-90);
      expect(lat, where).toBeLessThanOrEqual(90);
      expect(lon, where).toBeGreaterThanOrEqual(-180);
      expect(lon, where).toBeLessThanOrEqual(180);
      // The file holds the last day, so nothing in it may be older than that
      // or in the future: a date column read off by one would land here.
      const at = feature.properties.acquiredAt;
      expect(typeof at, where).toBe("number");
      const age = Date.now() - (at as number);
      expect(age, where).toBeGreaterThan(-2 * 3_600_000);
      expect(age, where).toBeLessThan(48 * 3_600_000);
      if (typeof feature.properties.confidence === "string") {
        seen.add(feature.properties.confidence);
      }
    }
    // The three words the algorithm uses, which the popup shows unchanged.
    for (const confidence of seen) {
      expect(
        ["low", "nominal", "high"].includes(confidence),
        `${confidence} is not a confidence`,
      ).toBe(true);
    }
    // Both spacecraft answered, which is what `partial` being absent means
    // and what says neither file has been renamed.
    const platforms = new Set(
      data.features.map((one) => String(one.properties.satellite)),
    );
    expect(platforms.size).toBe(2);
  }, 120_000);
});

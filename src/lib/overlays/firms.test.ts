import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CHOICES } from "./registry";
import {
  FIRMS_AREAS,
  FIRMS_MIN_ZOOM,
  FIRMS_REFRESH_MS,
  FIRMS_SATELLITES,
  acquiredAt,
  firmsOverlay,
  parseFirms,
  readable,
  url,
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

  it("tells an empty file apart from one it cannot read", () => {
    // Both parse to nothing, and they mean opposite things: an empty file is
    // a quiet day, and a moved header is a layer that cannot see.
    const header = CSV.split("\n")[0];
    expect(readable(`${header}\n`)).toBe(true);
    expect(parseFirms(`${header}\n`, "NOAA-20")).toEqual([]);
    expect(
      readable(CSV.replace("latitude,longitude", "longitude,latitude")),
    ).toBe(false);
    // Windows line endings on the header do not make it unreadable.
    expect(readable(`${header}\r\n`)).toBe(true);
    expect(readable("")).toBe(false);
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
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Both of NOAA-20's areas refuse, which is one spacecraft down.
      const failing = String(input).includes("J1_VIIRS");
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
      // Losing one spacecraft takes a third of the looks. Drawn without a
      // word it reads as a third of the fires having gone out.
      expect(data.partial).toContain("NOAA-20");
      // Named once, not once per area of that spacecraft.
      expect(data.partial?.match(/NOAA-20/g)).toHaveLength(1);
      // The two that answered, over two areas each.
      expect(data.features).toHaveLength(12);
    } finally {
      globalThis.fetch = held;
    }
  });

  it("does not read a file it cannot parse as a day with no fires", async () => {
    // A 200 with a moved header parses to nothing, and drawn as an empty
    // answer it says there are no fires in the country. That is a different
    // claim from Alaska being quiet in September, which is the ordinary
    // empty file this layer sees every day.
    const held = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const moved = String(input).includes("J2_VIIRS");
      return {
        ok: true,
        status: 200,
        text: async () =>
          moved ? CSV.replace("latitude,longitude", "longitude,latitude") : CSV,
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const data = await firmsOverlay.fetchData(
        { west: -180, south: -90, east: 180, north: 90 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
      expect(data.partial).toContain("NOAA-21");
      expect(data.features).toHaveLength(12);
    } finally {
      globalThis.fetch = held;
    }
  });

  it("asks every spacecraft, for every area the office cuts", async () => {
    // Two things the first version of this layer got wrong, and neither
    // could be seen on the map. NOAA-21 was left out while it was
    // publishing more detections than either of the two that were in it;
    // and Alaska is its own file, so the state with the largest burned
    // acreage in the country could never draw a detection at all.
    const asked: string[] = [];
    const held = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return { ok: true, status: 200, text: async () => CSV } as Response;
    }) as unknown as typeof fetch;
    try {
      await firmsOverlay.fetchData(
        { west: -180, south: -90, east: 180, north: 90 },
        undefined,
        DEFAULT_OVERLAY_CHOICES,
      );
    } finally {
      globalThis.fetch = held;
    }
    expect(FIRMS_SATELLITES).toHaveLength(3);
    expect(FIRMS_AREAS).toEqual(["USA_contiguous_and_Hawaii", "Alaska"]);
    expect(asked).toHaveLength(6);
    for (const prefix of ["SUOMI_VIIRS_C2", "J1_VIIRS_C2", "J2_VIIRS_C2"]) {
      for (const area of FIRMS_AREAS) {
        expect(
          asked.some((url) => url.includes(`${prefix}_${area}_24h.csv`)),
          `${prefix} over ${area}`,
        ).toBe(true);
      }
    }
  });

  it("asks once an hour for the whole country, per spacecraft", () => {
    expect(firmsOverlay.global).toBe(true);
    expect(firmsOverlay.refreshMs).toBe(FIRMS_REFRESH_MS);
    // The item's own ceiling is at most hourly, and six files once an hour
    // is well inside it.
    expect(FIRMS_REFRESH_MS).toBe(60 * 60_000);
    expect(firmsOverlay.minZoom).toBe(FIRMS_MIN_ZOOM);
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
    // Every spacecraft answered, which is what `partial` being absent means
    // and what says none of the six files has been renamed. Alaska is
    // usually empty, so this counts platforms rather than files: a platform
    // reaching the map at all means its contiguous file parsed.
    const platforms = new Set(
      data.features.map((one) => String(one.properties.satellite)),
    );
    expect(platforms.size).toBe(FIRMS_SATELLITES.length);
  }, 120_000);

  it("holds all six files by name, whether or not any of them is burning", async () => {
    // `partial` already fails the case above when a file goes missing, but it
    // says a file went missing without saying which, and the Alaska files are
    // empty from about September to May: a rename there would show up only as
    // a sentence naming a spacecraft. This asks for each of the six and holds
    // its header, which is what says the columns still mean what they meant.
    // Separate from whether anything was burning, so it fails in September as
    // well as in July.
    const wanted = FIRMS_SATELLITES.flatMap((satellite) =>
      FIRMS_AREAS.map((area) => ({ satellite, area })),
    );
    expect(wanted).toHaveLength(6);
    const unreadable: string[] = [];
    for (const { satellite, area } of wanted) {
      const where = `${satellite.id} over ${area}`;
      const answer = await fetch(url(satellite, area), {
        headers: { Accept: "text/csv" },
      });
      if (!answer.ok) {
        unreadable.push(`${where}: ${answer.status}`);
        continue;
      }
      const body = await answer.text();
      if (!readable(body)) {
        const first = body.split("\n")[0] ?? "";
        unreadable.push(`${where}: ${first.slice(0, 80)}`);
      }
    }
    expect(unreadable).toEqual([]);
  }, 180_000);
});

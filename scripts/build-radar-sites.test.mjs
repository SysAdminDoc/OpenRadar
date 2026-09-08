import { describe, expect, it } from "vitest";
import { carriedLabels, degrees, rowFor } from "./build-radar-sites.mjs";

describe("labels already committed", () => {
  const table = `
    SiteEntry {
        id: "KTLX",
        city: "Oklahoma City",
        state: "OK",
        latitude: 35.3331,
        longitude: -97.2778,
        elevation_meters: 370,
    },
    SiteEntry {
        id: "RODN",
        city: "Kadena AB",
        state: "",
        latitude: 26.3019,
        longitude: 127.9097,
        elevation_meters: 91,
    },
`;

  it("carries a radar's own name forward rather than renaming it", () => {
    // The office calls KTLX "Norman" and the label readers know is "Oklahoma
    // City". Both are true of the ground; only one is what the picker has
    // said for as long as the app has existed, and a table refresh is not a
    // reason to rename a hundred and fifty radars.
    expect(carriedLabels(table).get("KTLX")).toEqual({
      city: "Oklahoma City",
      state: "OK",
    });
  });

  it("carries an empty state, which is not the same as no entry", () => {
    // Kadena has no state. If this came back as a miss rather than as an
    // empty string, every run would ask the points service about a site it
    // does not cover and write the answer away again.
    expect(carriedLabels(table).get("RODN")).toEqual({
      city: "Kadena AB",
      state: "",
    });
  });

  it("finds nothing in a table that has none", () => {
    expect(carriedLabels("").size).toBe(0);
  });
});

describe("a row of the generated table", () => {
  const site = {
    id: "KHDC",
    city: "Hammond",
    state: "LA",
    latitude: 30.5196,
    longitude: -90.4074,
    elevationMeters: 43,
  };

  it("writes what the module reads back", () => {
    // The round trip that matters: what the generator writes has to be what
    // the reader of the committed table takes back out of it.
    expect(carriedLabels(rowFor(site)).get("KHDC")).toEqual({
      city: "Hammond",
      state: "LA",
    });
  });

  it("keeps four decimal places, which is about ten metres", () => {
    const row = rowFor(site);
    expect(row).toContain("latitude: 30.5196,");
    expect(row).toContain("longitude: -90.4074,");
  });

  it("rounds an elevation to whole metres, because the field is an integer", () => {
    // The office publishes 733.04 m for State College and the field it goes
    // into is an i16.
    expect(rowFor({ ...site, elevationMeters: 733.04 })).toContain(
      "elevation_meters: 733,",
    );
  });

  it("escapes a name that would otherwise end the string early", () => {
    const row = rowFor({ ...site, city: 'He said "go"' });
    expect(row).toContain('city: "He said \\"go\\"",');
  });
});

describe("a position as a Rust literal", () => {
  it("keeps ten metres of precision", () => {
    expect(degrees(-90.40739822)).toBe("-90.4074");
  });

  it("does not pad a digit the type cannot hold", () => {
    // clippy's excessive_precision refuses -116.2360, which is the same f32
    // as -116.236 and claims a digit more than it has.
    expect(degrees(-116.236)).toBe("-116.236");
  });

  it("keeps a decimal point on a whole number", () => {
    // A bare 40 is an integer literal and will not compile into an f32 field.
    expect(degrees(40)).toBe("40.0");
    expect(degrees(-0)).toBe("0.0");
  });
});

describe("the label round trip", () => {
  const roundTrip = (city, state = "OK") =>
    carriedLabels(
      rowFor({
        id: "KTLX",
        city,
        state,
        latitude: 35.3331,
        longitude: -97.2778,
        elevationMeters: 370,
      }),
    ).get("KTLX");

  it("survives a quote in a name", () => {
    // A quote ended the match early, so the row was never recognised: the
    // label and the state were both dropped and the next run silently renamed
    // the radar to whatever the office calls the nearest town.
    expect(roundTrip('Quote"City')).toEqual({
      city: 'Quote"City',
      state: "OK",
    });
  });

  it("survives a backslash, and does not grow one each run", () => {
    // rowFor escapes and carriedLabels did not unescape, so every run added
    // another backslash to a name that had one.
    //
    // The backslash has to be written doubled. The first version of this test
    // wrote it single, which JavaScript reads as "Backslash" with no backslash
    // in it at all, because that is not an escape sequence and the backslash
    // is simply dropped. So it fed the escaping fix a string that could never
    // have broken it: weakening `unescaped` back to handling quotes only left
    // this test green while a real backslash doubled on every run.
    const name = "Back\\slash";
    const once = roundTrip(name);
    expect(once).toEqual({ city: name, state: "OK" });
    const twice = carriedLabels(
      rowFor({
        id: "KTLX",
        ...once,
        latitude: 35.3331,
        longitude: -97.2778,
        elevationMeters: 370,
      }),
    ).get("KTLX");
    expect(twice).toEqual(once);
  });

  it("still reads an ordinary name", () => {
    expect(roundTrip("Oklahoma City")).toEqual({
      city: "Oklahoma City",
      state: "OK",
    });
  });
});

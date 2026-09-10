import { describe, expect, it } from "vitest";
import { alertsOverlay } from "./alerts";
import { alertsToAnnounce } from "../watch";
import { DEFAULT_SETTINGS } from "../settings";
import {
  METEOALARM_COUNTRIES,
  MAX_METEOALARM_COUNTRIES,
  capRing,
  meteoalarmCountriesIn,
  meteoalarmHazard,
  meteoalarmSeverity,
  meteoalarmUrl,
  noAwareness,
  parseMeteoalarm,
  titleParts,
} from "./meteoalarm";

/** The live contract runs only when it is asked for. */
const LIVE = process.env.OPENRADAR_LIVE === "1";

const AT = Date.parse("2026-09-09T13:45:00Z");

/** A square ring around a point, as CAP writes one: latitude first. */
function square(latitude: number, longitude: number): string {
  const corners: [number, number][] = [
    [latitude - 0.1, longitude - 0.1],
    [latitude - 0.1, longitude + 0.1],
    [latitude + 0.1, longitude + 0.1],
    [latitude + 0.1, longitude - 0.1],
    [latitude - 0.1, longitude - 0.1],
  ];
  return corners.map(([lat, lon]) => `${lat},${lon}`).join(" ");
}

/**
 * One entry, in the shape the Swiss feed answered with on 2026-09-10.
 *
 * MeteoAlarm splits an alert by language, area and polygon and publishes one
 * entry per combination, which is why the identifier repeats across entries
 * and the entry's own id carries the three indices.
 */
function entry(over: Partial<Record<string, string>> = {}): string {
  const said = {
    polygon: square(46.17, 8.79),
    areaDesc: "Luganese",
    event: "Heavy thunderstorm",
    expires: "2026-09-09T14:35:00+00:00",
    effective: "2026-09-09T13:36:57+00:00",
    onset: "2026-09-09T13:35:00+00:00",
    severity: "Severe",
    message_type: "Alert",
    status: "Actual",
    identifier: "2.49.0.0.756.0.CH.2609091538412e4b2387381629778d09",
    title: "Orange Thunderstorm Warning issued for Switzerland - Luganese",
    ...over,
  };
  return `  <entry>
    <cap:polygon>${said.polygon}</cap:polygon>
    <link title="Luganese" href="https://meteoalarm.org?polygon=ffbe1eb2,0,0,0" hreflang="en"/>
    <cap:areaDesc>${said.areaDesc}</cap:areaDesc>
    <cap:event>${said.event}</cap:event>
    <cap:sent>2026-09-09T13:38:40+00:00</cap:sent>
    <cap:expires>${said.expires}</cap:expires>
    <cap:effective>${said.effective}</cap:effective>
    <cap:onset>${said.onset}</cap:onset>
    <cap:certainty>Likely</cap:certainty>
    <cap:severity>${said.severity}</cap:severity>
    <cap:urgency>Future</cap:urgency>
    <cap:scope>Public</cap:scope>
    <cap:message_type>${said.message_type}</cap:message_type>
    <cap:status>${said.status}</cap:status>
    <cap:identifier>${said.identifier}</cap:identifier>
    <link type="application/cap+xml" href="https://feeds.meteoalarm.org/api/v1/warnings/feeds-switzerland/ffbe1eb2"/>
    <link title="Switzerland" rel="related" href="https://meteoalarm.org?region=CH" hreflang="en"/>
    <published>2026-09-09T13:38:40Z</published>
    <id>https://feeds.meteoalarm.org/api/v1/warnings/feeds-switzerland/ffbe1eb2?index_info=0&amp;index_area=0&amp;index_polygon=0</id>
    <title>${said.title}</title>
    <updated>2026-09-09T13:38:40Z</updated>
  </entry>`;
}

function feed(...entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <title>MeteoAlarm - Alerting Europe for Extreme Weather</title>
  <rights>Copyright 2026 MeteoAlarm.Org. Licensed under terms equivalent to CC BY 4.0.</rights>
${(entries.length ? entries : [entry()]).join("\n")}
</feed>`;
}

const options = { at: AT, country: "switzerland" };

/** Just the drawable half of a read, which is most of what these assert. */
function drawnBy(xml: string, said: typeof options) {
  return parseMeteoalarm(xml, said).features;
}

describe("which European feeds a view is worth asking", () => {
  it("asks only about countries the view actually reaches", () => {
    // A view over the Swiss plateau. Iceland is not in it.
    const { asked } = meteoalarmCountriesIn({
      west: 6.5,
      south: 46.4,
      east: 8.5,
      north: 47.6,
    });
    expect(asked).toContain("switzerland");
    expect(asked).not.toContain("iceland");
    expect(asked).not.toContain("israel");
  });

  it("asks nobody about a view with no member country in it", () => {
    // Kansas.
    const { asked, skipped } = meteoalarmCountriesIn({
      west: -100,
      south: 37,
      east: -96,
      north: 40,
    });
    expect(asked).toEqual([]);
    expect(skipped).toBe(0);
  });

  it("caps a continent-wide view and says how many it left out", () => {
    // The whole of Europe reaches nearly every member, and one request each
    // on every pan is not a reasonable thing to do to a shared free service.
    const { asked, skipped } = meteoalarmCountriesIn({
      west: -12,
      south: 35,
      east: 32,
      north: 60,
    });
    expect(asked).toHaveLength(MAX_METEOALARM_COUNTRIES);
    expect(skipped).toBeGreaterThan(0);
    // The ones covering most of what is on screen come first, so a country
    // filling the view outranks a small one at the edge of it.
    expect(asked[0]).not.toBe("andorra");
    expect(asked).toContain("france");
  });

  it("keeps every box big enough to be the country it names", () => {
    // The live contract below holds each box against the polygons its feed
    // publishes, which is the real check and which covers only the nine
    // countries that publish any: collapsing Austria's box to a tenth of a
    // degree left the whole suite green while two hundred and ten Austrian
    // warnings were in force. This is the part that does not depend on the
    // weather. The smallest member is Andorra at about 0.4 by 0.3 degrees.
    const tiny: string[] = [];
    for (const country of METEOALARM_COUNTRIES) {
      const across = country.box.east - country.box.west;
      const down = country.box.north - country.box.south;
      if (across < 0.25 || down < 0.25) {
        tiny.push(`${country.id}: ${across.toFixed(2)} by ${down.toFixed(2)}`);
      }
    }
    expect(tiny).toEqual([]);
    // And no box wanders off Europe, which is where a copied line lands.
    for (const country of METEOALARM_COUNTRIES) {
      expect(country.box.west, country.id).toBeGreaterThan(-32);
      expect(country.box.east, country.id).toBeLessThan(41);
      expect(country.box.south, country.id).toBeGreaterThan(8);
      expect(country.box.north, country.id).toBeLessThan(72);
    }
  });

  it("leaves Germany to the office that publishes its geometry", () => {
    // The German feed carries warning cell codes and no polygons, and
    // `dwdWarnings.ts` reads the DWD's own service for the same warnings.
    // Both would draw the same hazard twice.
    expect(METEOALARM_COUNTRIES.map((one) => one.id)).not.toContain("germany");
  });

  it("addresses one country's Atom feed", () => {
    // The Atom rather than the JSON beside it: Switzerland's JSON was 9.6 MB
    // and its Atom 60 kB, and the difference is mostly green "no warnings
    // for this region" entries.
    expect(meteoalarmUrl("switzerland")).toBe(
      "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-switzerland",
    );
  });
});

describe("reading one country's warnings", () => {
  it("draws the polygon the office published, the right way round", () => {
    const [drawn] = drawnBy(feed(), options);
    expect(drawn).toBeTruthy();
    const ring = (drawn.geometry as { coordinates: [number, number][][] })
      .coordinates[0];
    // CAP writes latitude first and GeoJSON writes longitude first. Read the
    // wrong way round this polygon lands in the Indian Ocean.
    for (const [longitude, latitude] of ring) {
      expect(longitude).toBeGreaterThan(8);
      expect(longitude).toBeLessThan(9);
      expect(latitude).toBeGreaterThan(46);
      expect(latitude).toBeLessThan(47);
    }
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("names the hazard, the office and the region", () => {
    const [drawn] = drawnBy(feed(), options);
    expect(drawn.properties.headline).toBe("Orange Thunderstorm Warning");
    expect(drawn.properties.office).toBe("MeteoSwiss");
    expect(drawn.properties.severity).toBe("severe");
    expect(drawn.properties.kind).toBe("thunderstorm");
    expect(drawn.properties.capId).toBe(
      "2.49.0.0.756.0.CH.2609091538412e4b2387381629778d09",
    );
    expect(drawn.properties.area).toBe("Luganese");
    expect(drawn.properties.agency).toBe("meteoalarm");
    expect(String(drawn.properties.url)).toContain("meteoalarm.org");
  });

  it("credits MeteoAlarm alone where no live warning has named the office", () => {
    // Six countries had no warning at all on the day the table was read, so
    // there is no verified name for them. Naming the wrong office is worse
    // than naming the publication.
    const quiet = METEOALARM_COUNTRIES.find((one) => one.id === "malta");
    expect(quiet?.office).toBeUndefined();
    const [drawn] = drawnBy(feed(), { ...options, country: "malta" });
    expect(drawn.properties.office).toBe("MeteoAlarm");
  });

  it("draws nothing for a region with no warnings in it", () => {
    // Green is how MeteoAlarm publishes "no warnings for this region". The
    // Atom feed carries none of them, which is why it is the one read here,
    // and this is the guard that keeps it that way if it ever starts.
    const green = feed(
      entry({
        title: "Green Thunderstorm Warning issued for Switzerland - Luganese",
      }),
    );
    expect(drawnBy(green, options)).toEqual([]);
    expect(noAwareness("Green")).toBe(true);
    expect(noAwareness("Yellow")).toBe(false);
  });

  it("draws nothing for a warning that is over or has not started", () => {
    // The French feed on the day this was written held sixty-eight warnings,
    // every one of which had expired five days earlier.
    const over = feed(
      entry({
        onset: "2026-09-03T06:00:00+00:00",
        effective: "2026-09-03T06:00:00+00:00",
        expires: "2026-09-03T08:00:00+00:00",
      }),
    );
    expect(drawnBy(over, options)).toEqual([]);

    const tomorrow = feed(
      entry({
        onset: "2026-09-10T06:00:00+00:00",
        effective: "2026-09-10T06:00:00+00:00",
        expires: "2026-09-10T18:00:00+00:00",
      }),
    );
    expect(drawnBy(tomorrow, options)).toEqual([]);
  });

  it("drops a cancellation, a test and anything not actual", () => {
    expect(drawnBy(feed(entry({ message_type: "Cancel" })), options)).toEqual(
      [],
    );
    expect(drawnBy(feed(entry({ status: "Test" })), options)).toEqual([]);
    expect(drawnBy(feed(entry({ status: "Exercise" })), options)).toEqual([]);
    // And an ordinary update is a warning, not a cancellation.
    expect(
      drawnBy(feed(entry({ message_type: "Update" })), options),
    ).toHaveLength(1);
  });

  it("counts a warning it cannot draw rather than dropping it silently", () => {
    // Twenty-eight of the thirty-seven member services publish a region code
    // instead of an outline. On a busy day over Austria that is two hundred
    // warnings in force and a map with nothing on it, which is wrong data
    // rather than missing data.
    const coded = feed(entry({ polygon: "" }))
      .replace("<cap:polygon></cap:polygon>", "")
      .replace("<cap:polygon/>", "");
    const read = parseMeteoalarm(coded, options);
    expect(read.features).toEqual([]);
    expect(read.unshaped).toBe(1);

    // And a ring that is not a ring is counted the same way, because the
    // reader is equally left with nothing drawn.
    const broken = parseMeteoalarm(
      feed(entry({ polygon: "46.1,8.7 46.2,8.8" })),
      options,
    );
    expect(broken.features).toEqual([]);
    expect(broken.unshaped).toBe(1);

    // A warning that draws is not counted as one that did not.
    expect(parseMeteoalarm(feed(), options).unshaped).toBe(0);

    // One warning over seven regions is one warning. MeteoAlarm splits an
    // alert into an entry per language, area and polygon, so counting
    // entries said "seven European warnings in force are not drawn" for a
    // single French thunderstorm warning: eighty-three entries against
    // sixty-nine warnings across the thirty-seven feeds.
    const spread = feed(
      entry({ polygon: "", areaDesc: "Ardèche" }),
      entry({ polygon: "", areaDesc: "Aude" }),
      entry({ polygon: "", areaDesc: "Gard" }),
    )
      .replaceAll("<cap:polygon></cap:polygon>", "")
      .replaceAll("<cap:polygon/>", "");
    const many = parseMeteoalarm(spread, options);
    expect(many.features).toEqual([]);
    expect(many.unshaped).toBe(1);

    // Two different warnings are two.
    const both = feed(
      entry({ polygon: "" }),
      entry({ polygon: "", identifier: "2.49.0.0.250.0.FR.20260910160022.1" }),
    )
      .replaceAll("<cap:polygon></cap:polygon>", "")
      .replaceAll("<cap:polygon/>", "");
    expect(parseMeteoalarm(both, options).unshaped).toBe(2);

    // And a warning with one good outline and one bad is drawn, so it is not
    // one the reader is missing.
    const half = feed(entry(), entry({ polygon: "46.1,8.7 46.2,8.8" }));
    const mixed = parseMeteoalarm(half, options);
    expect(mixed.features).toHaveLength(1);
    expect(mixed.unshaped).toBe(0);
  });

  it("credits MeteoAlarm alone where a country has more than one office", () => {
    // Bosnia and Herzegovina has two services, and the same day's feed
    // carried 47 warnings from one and 7 from the other. One name in the
    // table would credit seven of those to an office that did not issue
    // them, and the Atom feed does not carry the sender.
    const two = METEOALARM_COUNTRIES.find(
      (one) => one.id === "bosnia-herzegovina",
    );
    expect(two?.office).toBeUndefined();
    // Poland has three offices under one institute, so the institute is what
    // is named: every live sender began with it.
    const poland = METEOALARM_COUNTRIES.find((one) => one.id === "poland");
    expect(poland?.office).toBe("IMGW-PIB");
  });

  it("gives one warning covering two valleys one identity", () => {
    // MeteoAlarm publishes an entry per polygon. Two of them are one warning
    // and the watch keys on the CAP identifier, so it is announced once.
    const both = feed(
      entry(),
      entry({ areaDesc: "Locarnese", polygon: square(46.3, 8.6) }),
    );
    const drawn = drawnBy(both, options);
    expect(drawn).toHaveLength(2);
    expect(drawn[0].properties.capId).toBe(drawn[1].properties.capId);
    expect(drawn[0].properties.area).not.toBe(drawn[1].properties.area);
  });

  it("gives two countries' warnings two identities", () => {
    const swiss = drawnBy(feed(), options);
    const norwegian = drawnBy(
      feed(
        entry({
          identifier: "2.49.0.0.578.0.NO.2609091538412e4b23873816297",
          title: "Orange Wind Warning issued for Norway - Nordland",
        }),
      ),
      { ...options, country: "norway" },
    );
    // The CAP identifier is the identity the watch keys on, which is the
    // lesson the Canadian feed taught: every ECCC alert shared one because
    // the watch keyed on a field that was the same for all of them.
    expect(swiss[0].properties.capId).not.toBe(norwegian[0].properties.capId);
    expect(swiss[0].properties.capId).toContain(".756.");
    expect(norwegian[0].properties.capId).toContain(".578.");
    expect(norwegian[0].properties.office).toBe("MET Norway");
  });

  it("says so rather than drawing nothing when the feed is unreadable", () => {
    // A feed that changed shape must not read as a continent with no
    // warnings in it.
    expect(() => parseMeteoalarm("<feed>not xml", options)).toThrow();
  });
});

describe("which switch a European warning lands under", () => {
  it("reads the hazard from MeteoAlarm's own normalised title", () => {
    expect(meteoalarmHazard("Thunderstorm")).toBe("thunderstorm");
    expect(meteoalarmHazard("Wind")).toBe("thunderstorm");
    expect(meteoalarmHazard("Snow-ice")).toBe("winter");
    expect(meteoalarmHazard("Avalanches")).toBe("winter");
    expect(meteoalarmHazard("High-temperature")).toBe("heat");
    expect(meteoalarmHazard("Low-temperature")).toBe("winter");
    expect(meteoalarmHazard("Forest-fire")).toBe("fire");
    expect(meteoalarmHazard("Rain")).toBe("flood");
    expect(meteoalarmHazard("Flooding")).toBe("flood");
    expect(meteoalarmHazard("Rain-flood")).toBe("flood");
    expect(meteoalarmHazard("Coastalevent")).toBe("flood");
    expect(meteoalarmHazard("Fog")).toBe("other");
    // And a hazard nobody has met lands under a switch nobody turned off.
    expect(meteoalarmHazard("Something-new")).toBe("other");
  });

  it("reads the colour and the hazard out of a title", () => {
    expect(
      titleParts("Yellow Rain-flood Warning issued for Italy - Sicilia"),
    ).toEqual({ colour: "Yellow", hazard: "Rain-flood" });
    expect(
      titleParts("Orange High-temperature Warning issued for Spain - Sevilla"),
    ).toEqual({ colour: "Orange", hazard: "High-temperature" });
    // The feed's own title is not a warning and must not be read as one.
    expect(
      titleParts("MeteoAlarm - Alerting Europe for Extreme Weather"),
    ).toBeNull();
  });

  it("ranks on CAP's own severity", () => {
    expect(meteoalarmSeverity("Extreme")).toBe("extreme");
    expect(meteoalarmSeverity("Severe")).toBe("severe");
    expect(meteoalarmSeverity("Moderate")).toBe("moderate");
    expect(meteoalarmSeverity("Minor")).toBe("minor");
    expect(meteoalarmSeverity("")).toBe("minor");
  });
});

describe("the ring a CAP polygon is read out of", () => {
  it("refuses a ring that is not one", () => {
    expect(capRing("")).toBeNull();
    expect(capRing("46.1,8.7 46.2,8.8")).toBeNull();
    expect(capRing("46.1,8.7 nonsense 46.2,8.8 46.1,8.7")).toBeNull();
    // A latitude nothing on earth has.
    expect(capRing("95.0,8.7 46.2,8.8 46.3,8.9 95.0,8.7")).toBeNull();
  });

  it("closes a ring the office left open", () => {
    const ring = capRing("46.1,8.7 46.2,8.8 46.3,8.9 46.4,9.0");
    expect(ring).not.toBeNull();
    expect(ring![0]).toEqual(ring![ring!.length - 1]);
  });
});

describe("the watch at a place in Europe", () => {
  it("announces a European warning standing over a watched place", () => {
    // The whole point of putting these on the same layer rather than on a
    // switch of their own: a reader in Ticino gets told the same way a reader
    // in Kansas does, through the machinery that was already there.
    const drawn = drawnBy(feed(), options);
    const said = alertsToAnnounce(
      { type: "FeatureCollection", features: drawn },
      {
        ...DEFAULT_SETTINGS.watch,
        enabled: true,
        // Inside the planted square around Lugano.
        center: [8.79, 46.17],
        radiusMiles: 10,
        minSeverity: "moderate",
      },
      new Map(),
      AT,
    );
    expect(said).toHaveLength(1);
    expect(said[0].headline).toBe("Orange Thunderstorm Warning");
    expect(said[0].agency).toBe("meteoalarm");
    // And the identity it is remembered by is the office's own, so the same
    // warning is not announced again on the next poll.
    expect(said[0].id).toBe(
      "2.49.0.0.756.0.CH.2609091538412e4b2387381629778d09",
    );

    // A place across the country is not under it.
    const elsewhere = alertsToAnnounce(
      { type: "FeatureCollection", features: drawn },
      {
        ...DEFAULT_SETTINGS.watch,
        enabled: true,
        center: [6.14, 46.2],
        radiusMiles: 10,
        minSeverity: "moderate",
      },
      new Map(),
      AT,
    );
    expect(elsewhere).toEqual([]);
  });
});

describe("whose warning a popup says it is", () => {
  it("names the European office rather than the American one", () => {
    const [drawn] = drawnBy(feed(), options);
    const said = alertsOverlay.describe(drawn.properties);
    const source = said!.lines.at(-1)!;
    expect(source).toContain("MeteoSwiss");
    expect(source).not.toContain("NWS");
  });
});

describe.runIf(LIVE)("against the live service", () => {
  it("keeps every country's warnings inside the box that asks for them", async () => {
    // A box that stops short of where a service warns is a warning nobody is
    // ever asked about. The Netherlands box cut off at 53.6 while the live
    // polygons reached 54.16, which is the Wadden and the North Sea, which is
    // where the wind warnings are; Estonia's cut off two islands. Nothing in
    // the suite held the table: pulling the Dutch north edge down to 52.0,
    // losing Amsterdam, left every other test green.
    const outside: string[] = [];
    for (const country of METEOALARM_COUNTRIES) {
      const answer = await fetch(meteoalarmUrl(country.id));
      expect(answer.ok, country.id).toBe(true);
      const document = new DOMParser().parseFromString(
        await answer.text(),
        "text/xml",
      );
      for (const said of Array.from(
        document.getElementsByTagName("cap:polygon"),
      )) {
        const ring = capRing(said.textContent ?? "");
        if (!ring) continue;
        for (const [lon, lat] of ring) {
          if (
            lon < country.box.west ||
            lon > country.box.east ||
            lat < country.box.south ||
            lat > country.box.north
          ) {
            outside.push(
              `${country.id}: ${lat.toFixed(3)}, ${lon.toFixed(3)} outside ${JSON.stringify(country.box)}`,
            );
            break;
          }
        }
      }
    }
    expect([...new Set(outside)]).toEqual([]);
  }, 180_000);

  it("still publishes the fields a European warning is drawn from", async () => {
    // Switzerland publishes geometry and is rarely completely quiet, but an
    // empty answer on a calm day is still the right answer. What this holds
    // is the shape.
    const answer = await fetch(meteoalarmUrl("switzerland"));
    expect(answer.ok).toBe(true);
    const xml = await answer.text();
    expect(xml).toContain("<feed");

    const document = new DOMParser().parseFromString(xml, "text/xml");
    const entries = Array.from(document.getElementsByTagName("entry"));
    if (entries.length === 0) return;

    for (const one of entries.slice(0, 20)) {
      const said = (tag: string) =>
        one.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
      expect(said("cap:identifier")).not.toBe("");
      expect(["Minor", "Moderate", "Severe", "Extreme"]).toContain(
        said("cap:severity"),
      );
      expect(said("cap:expires")).not.toBe("");
      // The title is where the hazard and the colour are read from, and it
      // is MeteoAlarm's own normalisation rather than a service's wording.
      expect(titleParts(said("title"))).not.toBeNull();
    }

    // And geometry somewhere in the feed, because a feed that stopped
    // publishing polygons draws nothing while every assertion above passes.
    const rings = Array.from(document.getElementsByTagName("cap:polygon"));
    expect(rings.length).toBeGreaterThan(0);
    expect(capRing(rings[0].textContent ?? "")).not.toBeNull();

    // And the whole of it through the parser, which is what actually draws.
    const drawn = parseMeteoalarm(xml, {
      at: Date.now(),
      country: "switzerland",
    }).features;
    for (const feature of drawn) {
      expect(String(feature.properties.headline)).not.toBe("");
      expect(String(feature.properties.office)).not.toBe("");
    }
  }, 60_000);
});

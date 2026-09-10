import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseLevelSeries,
  predictedAt,
  MAX_STATION_MILES,
  fetchTides,
  nearestStation,
  parsePredictions,
  parseStationTime,
  state,
  stationDate,
  tideRegime,
  upcoming,
  type TideExtreme,
  type TideStation,
} from "./tides";
import { en } from "../i18n/en";

const STATIONS: TideStation[] = [
  {
    id: "8761724",
    name: "Grand Isle",
    state: "LA",
    lat: 29.2634,
    lon: -89.9567,
  },
  {
    id: "8518750",
    name: "The Battery",
    state: "NY",
    lat: 40.7006,
    lon: -74.0142,
  },
  {
    id: "9414290",
    name: "San Francisco",
    state: "CA",
    lat: 37.8063,
    lon: -122.4659,
  },
];

/** The reply NOAA gives, asked for GMT and high and low water only. */
const PREDICTIONS = {
  predictions: [
    { t: "2026-08-30 04:52", v: "0.192", type: "L" },
    { t: "2026-08-30 11:15", v: "2.470", type: "H" },
    { t: "2026-08-30 17:12", v: "0.313", type: "L" },
    { t: "2026-08-30 23:25", v: "2.451", type: "H" },
  ],
};

describe("the nearest tide station", () => {
  it("finds the one actually closest", () => {
    // New Orleans: Grand Isle is the station on that stretch of coast.
    const found = nearestStation(STATIONS, { lat: 29.95, lon: -90.07 });
    expect(found?.station.id).toBe("8761724");
    expect(found?.distanceMiles).toBeGreaterThan(0);
    expect(found?.distanceMiles).toBeLessThan(MAX_STATION_MILES);
  });

  it("says nothing rather than naming a station an ocean away", () => {
    // Kansas. The nearest station is hundreds of miles off and its tide
    // describes nothing about this place.
    expect(nearestStation(STATIONS, { lat: 38.5, lon: -98.0 })).toBeNull();
    expect(nearestStation([], { lat: 29.95, lon: -90.07 })).toBeNull();
  });

  it("does not fall for a station on the far side of the date line", () => {
    // A great-circle distance, not a difference of coordinates: 179E to 179W
    // is a hundred miles, not most of the way round the world.
    const across: TideStation[] = [
      { id: "a", name: "West", state: "", lat: 51.88, lon: 179.5 },
    ];
    const found = nearestStation(across, { lat: 51.88, lon: -179.5 }, 100);
    expect(found?.station.id).toBe("a");
    expect(found?.distanceMiles).toBeLessThan(60);
  });
});

describe("reading the predictions", () => {
  it("reads the times as GMT rather than as this machine's clock", () => {
    // The request asks for GMT and the reply carries no offset. Handing the
    // string to Date.parse would move every tide by the viewer's own offset,
    // which in New Orleans is five hours of wrong.
    const at = parseStationTime("2026-08-30 11:15");
    expect(new Date(at).getUTCHours()).toBe(11);
    expect(new Date(at).getUTCMinutes()).toBe(15);
    expect(at).toBe(Date.UTC(2026, 7, 30, 11, 15));
  });

  it("refuses a time it cannot read", () => {
    expect(Number.isNaN(parseStationTime("not a time"))).toBe(true);
    expect(Number.isNaN(parseStationTime("2026-08-30T11:15"))).toBe(true);
  });

  it("keeps the height and which way the tide turned", () => {
    const extremes = parsePredictions(PREDICTIONS);
    expect(extremes).toHaveLength(4);
    expect(extremes[0]).toEqual({
      time: Date.UTC(2026, 7, 30, 4, 52),
      feet: 0.192,
      high: false,
    });
    expect(extremes[1].high).toBe(true);
    expect(extremes[1].feet).toBeCloseTo(2.47, 5);
  });

  it("does not pass on what the service says went wrong", () => {
    // This asserted the opposite until 2026-09-04, and the opposite was
    // wrong: the message is CO-OPS's own English prose and it went straight
    // to the panel, so a French reader was told "No Predictions data was
    // found. Please make sure the Datum input is valid." The service's
    // wording is a diagnosis for a log, not a sentence for a reader.
    expect(() =>
      parsePredictions({ error: { message: "No Predictions data was found" } }),
    ).not.toThrow(/No Predictions data/);
  });

  it("drops a row it cannot read rather than the whole reply", () => {
    const extremes = parsePredictions({
      predictions: [
        { t: "2026-08-30 04:52", v: "0.192", type: "L" },
        { t: "2026-08-30 11:15", v: "not a height", type: "H" },
        { v: "1.0", type: "H" },
        { t: "2026-08-30 17:12", v: "0.313", type: "L" },
      ],
    });
    expect(extremes).toHaveLength(2);
  });
});

describe("what the tide is doing now", () => {
  const extremes = parsePredictions(PREDICTIONS);

  it("lists only what has not happened yet", () => {
    const noon = Date.UTC(2026, 7, 30, 12, 0);
    const next = upcoming(extremes, noon);
    expect(next).toHaveLength(2);
    expect(next[0].time).toBe(Date.UTC(2026, 7, 30, 17, 12));
  });

  it("caps the list rather than running off the panel", () => {
    expect(upcoming(extremes, 0, 2)).toHaveLength(2);
  });

  it("says rising when the next turn is a high water", () => {
    // Between the low at 04:52 and the high at 11:15 the water is coming in.
    expect(state(extremes, Date.UTC(2026, 7, 30, 8, 0))?.rising).toBe(true);
    // And after the high it is going out again.
    expect(state(extremes, Date.UTC(2026, 7, 30, 13, 0))?.rising).toBe(false);
    // Past the end of what was fetched there is nothing to say.
    expect(state(extremes, Date.UTC(2026, 8, 5, 0, 0))).toBeNull();
  });
});

describe("asking NOAA for a range of days", () => {
  it("writes the date the way the service wants it", () => {
    expect(stationDate(new Date(Date.UTC(2026, 7, 5, 23, 30)))).toBe(
      "20260805",
    );
    expect(stationDate(new Date(Date.UTC(2026, 11, 31, 0, 0)))).toBe(
      "20261231",
    );
  });
});

describe("how many times a day the tide turns", () => {
  /** A run of turns at a fixed spacing, alternating high and low. */
  const turns = (count: number, hoursApart: number): TideExtreme[] =>
    Array.from({ length: count }, (_, at) => ({
      time: Date.UTC(2026, 8, 7) + at * hoursApart * 3_600_000,
      feet: at % 2 === 0 ? 0.4 : 2.4,
      high: at % 2 === 1,
    }));

  it("reads one high and one low a day as diurnal", () => {
    // New Canal Station, Lake Pontchartrain, over the three days this app
    // asks for on 2026-09-07: seven turns across 3.09 days, 1.94 a day.
    expect(tideRegime(turns(7, 12.4))).toBe("diurnal");
  });

  it("reads two of each a day as semidiurnal", () => {
    // The Battery the same day: fifteen turns across 3.62 days, 3.87 a day.
    // San Francisco, which NOAA calls Mixed rather than Semidiurnal, came out
    // at 3.81 and belongs on this side: a mixed coast still turns four times
    // a day and differs in the heights, which the rows already show.
    expect(tideRegime(turns(15, 6.2))).toBe("semidiurnal");
    expect(tideRegime(turns(15, 6.3))).toBe("semidiurnal");
  });

  it("says nothing rather than guessing from too little", () => {
    // Half a day of turns says nothing about the next three.
    expect(tideRegime(turns(3, 6))).toBe("unknown");
    // Two turns carry one interval, which is not a rate.
    expect(tideRegime(turns(2, 12))).toBe("unknown");
    expect(tideRegime([])).toBe("unknown");
  });

  it("says nothing through the band where the count cannot tell", () => {
    // Sampled on 2026-09-07 across 44 stations of the bundled list against
    // NOAA's own classification. Shell Island in Atchafalaya Bay is Diurnal
    // and publishes 3.45 turns a day; station 8726436 is Mixed and publishes
    // 3.17. Both sit between the clear cases, so neither answer would be
    // right and the panel is better off silent.
    expect(tideRegime(turns(13, 6.95))).toBe("unknown"); // 3.45 a day
    expect(tideRegime(turns(11, 7.57))).toBe("unknown"); // 3.17 a day
    // And a Diurnal station at the top of its own range, 2.88 a day.
    expect(tideRegime(turns(12, 8.33))).toBe("unknown");
  });
});

/**
 * Against the live service. Off by default, the way the Rust live tests are:
 * `OPENRADAR_LIVE=1 npx vitest run src/lib/tides.test.ts`.
 */
const live = process.env.OPENRADAR_LIVE ? describe : describe.skip;

live("against NOAA itself", () => {
  it("reads the tide at the station nearest New Orleans", async () => {
    const stations: TideStation[] = JSON.parse(
      readFileSync(join(process.cwd(), "public", "tide-stations.json"), "utf8"),
    );
    expect(stations.length).toBeGreaterThan(3000);

    const found = nearestStation(stations, { lat: 29.95, lon: -90.07 });
    expect(found).not.toBeNull();

    const reading = await fetchTides(found!.station, found!.distanceMiles);
    // Enough to alternate, and no more of a claim than that. This asked for
    // more than four until 2026-09-07, which is the Atlantic assumption this
    // test was rewritten to remove, and it sat ahead of the regime-aware
    // floor below where it made that floor unreachable: anything clearing
    // "more than four" clears "at least two" on the way past.
    expect(reading.extremes.length).toBeGreaterThan(1);

    // A tide goes high, low, high, low. Two of the same in a row means the
    // rows were read in the wrong order or the type column was misread.
    for (let at = 1; at < reading.extremes.length; at += 1) {
      expect(
        reading.extremes[at].high,
        `${at} and the one before it are both the same turn`,
      ).not.toBe(reading.extremes[at - 1].high);
      // And they run forwards in time.
      expect(reading.extremes[at].time).toBeGreaterThan(
        reading.extremes[at - 1].time,
      );
    }

    // Heights on the Gulf coast are small but not zero, and are given above
    // the chart datum, so they do not go far below it.
    for (const extreme of reading.extremes) {
      expect(extreme.feet).toBeGreaterThan(-3);
      expect(extreme.feet).toBeLessThan(20);
    }

    // How many turns to expect is a fact about the coast, and NOAA holds it
    // per station. This asked for eight in three days until 2026-09-07 under
    // a comment saying "roughly two of each a day", which is the Atlantic
    // shape; the nearest station to New Orleans is on Lake Pontchartrain,
    // NOAA calls it Diurnal, and it published seven. The floor now follows
    // the station rather than the assumption.
    const described = await fetch(
      `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${found!.station.id}.json`,
    );
    expect(described.ok).toBe(true);
    const noaaType = String(
      ((await described.json()) as { stations?: { tideType?: unknown }[] })
        .stations?.[0]?.tideType ?? "",
    ).trim();

    // Diurnal is one high and one low a day, so three days is six or seven.
    // A station NOAA calls Mixed or Semi Diurnal turns four times a day.
    // Everything else carries no floor: 24 of 44 stations sampled from the
    // bundled list on 2026-09-07 publish no classification at all, which is
    // a subordinate station rather than a service that has changed, and
    // "Mixed Diurnal" showed up at both 1.92 and 3.93 turns a day.
    const fourADay = noaaType === "Mixed" || /^Semi/.test(noaaType);
    expect(reading.extremes.length).toBeGreaterThanOrEqual(fourADay ? 8 : 2);
    expect(reading.extremes.length).toBeLessThanOrEqual(30);

    // The premise this test rests on, asserted rather than assumed. The
    // station nearest New Orleans is on Lake Pontchartrain and NOAA calls it
    // Diurnal, so `fourADay` is false here every time. This carried a
    // `if (fourADay && ...)` check of the reading against NOAA until
    // 2026-09-07, which could not run at this station on any day: it was not
    // an assertion that might be skipped, it was one that never executed, and
    // a green run said nothing whatever about `tideRegime`. If NOAA ever
    // reclassifies the station, this line says so instead of the test quietly
    // starting to check something else.
    expect(
      fourADay,
      `NOAA now calls ${found!.station.id} ${noaaType}, so this test is no longer reading a diurnal coast`,
    ).toBe(false);

    // What can be claimed here, and it is claimed unconditionally. The
    // function has to answer in its own vocabulary, and the turns have to
    // land in the band a diurnal station actually keeps: 44 bundled stations
    // sampled on 2026-09-07 put the Diurnal group between 1.90 and 3.45 a
    // day. A semidiurnal coast read by mistake lands above four, and a
    // misparsed reply lands near zero.
    const read = tideRegime(reading.extremes);
    expect(["diurnal", "semidiurnal", "unknown"]).toContain(read);

    const span = reading.extremes.at(-1)!.time - reading.extremes[0].time;
    const perDay = (reading.extremes.length - 1) / (span / (24 * 3_600_000));
    expect(
      perDay,
      `${found!.station.id} turned ${perDay} times a day`,
    ).toBeGreaterThan(1.5);
    expect(perDay).toBeLessThan(4);

    // And the times are inside the window that was asked for.
    const first = reading.extremes[0].time;
    const last = reading.extremes.at(-1)!.time;
    expect(last - first).toBeLessThan(5 * 24 * 3_600_000);
  }, 30_000);
});

describe("what CO-OPS says when it will not answer", () => {
  it("says which of the two it is, in the reader's language", () => {
    // The service answers in English prose and the panel printed it: "No
    // Predictions data was found. Please make sure the Datum input is
    // valid." reached a French reader exactly like that. The station being
    // wrong for tides and the request being wrong are different things to
    // do about, and both are said here rather than quoted.
    expect(() =>
      parsePredictions({
        error: {
          message:
            "No Predictions data was found. Please make sure the Datum input is valid.",
        },
      }),
    ).toThrow(en["tides.noPredictions"]);

    expect(() =>
      parsePredictions({ error: { message: "Wrong Date Format" } }),
    ).toThrow(en["tides.unknown"]);
  });

  it("still reads a good answer", () => {
    const read = parsePredictions({
      predictions: [{ t: "2026-09-04 18:00", v: "3.2", type: "H" }],
    });
    expect(read).toHaveLength(1);
    expect(read[0].high).toBe(true);
  });
});

describe("what the gauge reads against what the tide said", () => {
  /** The shape CO-OPS answers `product=water_level&date=latest` with. */
  const measured = {
    metadata: { id: "8723214", name: "Virginia Key" },
    data: [{ t: "2026-09-10 06:54", v: "0.63", s: "0.007", f: "1,0,0,0" }],
  };

  /** And `product=predictions&date=latest`, on the same six minute step. */
  const forecast = {
    predictions: [
      { t: "2026-09-10 06:48", v: "0.278" },
      { t: "2026-09-10 06:54", v: "0.283" },
      { t: "2026-09-10 07:00", v: "0.291" },
    ],
  };

  it("reads both series with the same reader", () => {
    expect(parseLevelSeries(measured, "data")).toEqual([
      { time: Date.UTC(2026, 8, 10, 6, 54), feet: 0.63 },
    ]);
    expect(parseLevelSeries(forecast, "predictions")).toHaveLength(3);
  });

  it("leaves out a step the gauge had no reading for", () => {
    // CO-OPS sends the row with an empty value where the instrument was down
    // or the reading was flagged. Zero feet is mean lower low water, which is
    // a real height and a very alarming one to draw during a storm, so a
    // blank has to be absent rather than a number.
    const gappy = {
      data: [
        { t: "2026-09-10 06:48", v: "" },
        { t: "2026-09-10 06:54", v: "0.63" },
      ],
    };
    expect(parseLevelSeries(gappy, "data")).toEqual([
      { time: Date.UTC(2026, 8, 10, 6, 54), feet: 0.63 },
    ]);
  });

  it("takes the prediction from the same moment as the reading", () => {
    const series = parseLevelSeries(forecast, "predictions");
    const at = Date.UTC(2026, 8, 10, 6, 54);
    expect(predictedAt(series, at)).toBe(0.283);
    // The surge is the gap: 0.63 measured against 0.283 predicted is a third
    // of a foot of water the tide alone does not account for.
    expect(0.63 - (predictedAt(series, at) ?? 0)).toBeCloseTo(0.347, 3);
  });

  it("refuses a prediction from a different moment rather than using it", () => {
    const series = parseLevelSeries(forecast, "predictions");
    // Twenty minutes past the end of what came back. On a fast-running tide
    // that is several inches of nothing, and a difference taken against it
    // would be this app inventing surge.
    expect(predictedAt(series, Date.UTC(2026, 8, 10, 7, 20))).toBeNull();
    // And one inside the six minute step is still the nearest point.
    expect(predictedAt(series, Date.UTC(2026, 8, 10, 6, 56))).toBe(0.283);
  });

  it("answers with nothing for a station that publishes no gauge", () => {
    // A subordinate station is an offset applied to somebody else's harmonic
    // constants, so there is no hull in the water to read.
    expect(
      parseLevelSeries({ error: { message: "No data was found." } }, "data"),
    ).toEqual([]);
    expect(predictedAt([], Date.now())).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_STATION_MILES,
  fetchTides,
  nearestStation,
  parsePredictions,
  parseStationTime,
  state,
  stationDate,
  upcoming,
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
    expect(reading.extremes.length).toBeGreaterThan(4);

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

    // Roughly two of each a day, so three days is somewhere near a dozen.
    expect(reading.extremes.length).toBeGreaterThanOrEqual(8);
    expect(reading.extremes.length).toBeLessThanOrEqual(30);

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

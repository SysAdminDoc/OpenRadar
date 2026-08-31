import { describe, expect, it } from "vitest";
import {
  AHEAD_MINUTES,
  isCurrentReading,
  probSevereFeatures,
  readingTime,
  type ProbSevereReading,
} from "./probsevere";

const STALE_MINUTES = 15;

describe("when a reading was taken", () => {
  it("reads the stamp the file carries", () => {
    // Written `20260830_230841 UTC`, which no date parser takes on its own.
    expect(readingTime("20260830_230841 UTC")).toBe(
      Date.UTC(2026, 7, 30, 23, 8, 41),
    );
    expect(readingTime("20260101_000000")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  it("refuses a stamp it cannot read rather than guessing", () => {
    // Anything that is not the shape the file writes has to come back as
    // nothing, so the caller can say so.
    expect(readingTime("2026-08-30T23:08:41Z")).toBeNull();
    expect(readingTime("20260830 230841 UTC")).toBeNull();
    expect(readingTime("")).toBeNull();
    expect(readingTime("soon")).toBeNull();
  });

  it("refuses parts that are not a date, rather than rolling them over", () => {
    // Date.UTC takes month 99 and gives back a date eight years out, and takes
    // minute 61 and gives back the next hour. Every one of these used to come
    // back as a real number and be drawn as the current reading.
    expect(readingTime("99999999_999999")).toBeNull();
    expect(readingTime("20261301_000000")).toBeNull();
    expect(readingTime("20260830_236199")).toBeNull();
    expect(readingTime("20260230_120000")).toBeNull();
    expect(readingTime("20260431_120000")).toBeNull();
    expect(readingTime("20260830_240000")).toBeNull();
    expect(readingTime("20260800_120000")).toBeNull();
  });

  it("keeps a leap day, which is a real date", () => {
    expect(readingTime("20280229_120000")).toBe(
      Date.UTC(2028, 1, 29, 12, 0, 0),
    );
    expect(readingTime("20260229_120000")).toBeNull();
  });
});

describe("whether a reading is worth drawing", () => {
  const at = Date.UTC(2026, 7, 30, 23, 8, 41);
  const observed = "20260830_230841 UTC";

  it("draws one from the last quarter of an hour", () => {
    expect(isCurrentReading(observed, at, STALE_MINUTES)).toBe(true);
    expect(
      isCurrentReading(observed, at + STALE_MINUTES * 60_000, STALE_MINUTES),
    ).toBe(true);
  });

  it("drops one about storms that have moved on", () => {
    expect(
      isCurrentReading(
        observed,
        at + (STALE_MINUTES + 1) * 60_000,
        STALE_MINUTES,
      ),
    ).toBe(false);
    expect(isCurrentReading(observed, at + 3_600_000, STALE_MINUTES)).toBe(
      false,
    );
  });

  it("allows for a clock a couple of minutes behind the publisher's", () => {
    expect(
      isCurrentReading(observed, at - AHEAD_MINUTES * 60_000, STALE_MINUTES),
    ).toBe(true);
  });

  it("drops a stamp from the future", () => {
    // The check ran in one direction only, so any stamp at or after the clock
    // passed forever: a file stamped in 2099 was drawn as the current reading
    // about storms that have not happened.
    expect(
      isCurrentReading(
        observed,
        at - (AHEAD_MINUTES + 1) * 60_000,
        STALE_MINUTES,
      ),
    ).toBe(false);
    expect(isCurrentReading("20990101_000000", at, STALE_MINUTES)).toBe(false);
  });

  it("draws nothing for a stamp it could not read", () => {
    expect(isCurrentReading("2026-08-30T23:08:41Z", at, STALE_MINUTES)).toBe(
      false,
    );
    expect(isCurrentReading("99999999_999999", at, STALE_MINUTES)).toBe(false);
  });
});

describe("which storms are drawn", () => {
  const reading: ProbSevereReading = {
    observed: "20260830_230841 UTC",
    storms: [
      {
        id: "1",
        rings: [
          [
            [-97, 35],
            [-96, 35],
            [-96, 36],
            [-97, 35],
          ],
        ],
        severe: 62,
        hail: 40,
        wind: 20,
        tornado: 5,
        attributes: [
          ["MUCAPE", "2400"],
          ["EBSHEAR", "45"],
        ],
      },
      {
        id: "2",
        rings: [
          [
            [-90, 30],
            [-89, 30],
            [-89, 31],
            [-90, 30],
          ],
        ],
        severe: 3,
        hail: 1,
        wind: 1,
        tornado: 0,
        attributes: [],
      },
    ],
  };

  it("leaves out the cells the model expects nothing from", () => {
    // Drawing every cell in the country would bury the ones it does expect
    // something from.
    const drawn = probSevereFeatures(reading) as {
      features: Array<{ properties: { id: string; detail: string } }>;
    };
    expect(drawn.features).toHaveLength(1);
    expect(drawn.features[0].properties.id).toBe("1");
  });

  it("flattens the measurements, because a feature carries flat values", () => {
    const drawn = probSevereFeatures(reading) as {
      features: Array<{ properties: { detail: string } }>;
    };
    expect(drawn.features[0].properties.detail).toContain("MUCAPE 2400");
    expect(drawn.features[0].properties.detail).toContain("EBSHEAR 45");
  });
});

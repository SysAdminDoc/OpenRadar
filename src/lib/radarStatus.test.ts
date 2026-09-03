import { describe, expect, it } from "vitest";
import {
  faultReason,
  levelTwoLate,
  minutesSinceLevelTwo,
  statusFor,
  type SiteStatus,
} from "./radarStatus";

const NOW = Date.parse("2026-09-03T02:06:00Z");

function station(overrides: Partial<SiteStatus> = {}): SiteStatus {
  return {
    station: "KDMX",
    status: "Operate",
    operability: "RDA - On-line",
    levelTwoAt: "2026-09-03T02:05:01+00:00",
    fault: null,
    ...overrides,
  };
}

describe("what the office says about a radar", () => {
  it("says nothing about a site it reported as running", () => {
    expect(faultReason(station(), NOW)).toBeNull();
    // And nothing at all about a site nobody asked about. The picker offers
    // forty-five terminal radars and the status feed is one request for the
    // whole country, so an empty answer is a feed that has not arrived yet
    // rather than a network with nothing wrong.
    expect(faultReason(null, NOW)).toBeNull();
  });

  it("names the state a radar reports rather than the word 'down'", () => {
    // "Start-Up" is the office's own word and it is the useful one: a radar
    // restarting after a power cut will be back, and one in maintenance will
    // not be back this afternoon. Flattening both to "down" throws away the
    // only part a reader can act on.
    const restarting = station({ status: "Start-Up", fault: "notOperating" });
    expect(faultReason(restarting, NOW)).toBe("Start-Up");
  });

  it("says how long a silent radar has been silent", () => {
    const quiet = station({
      levelTwoAt: "2026-08-13T13:58:38+00:00",
      fault: "noRecentData",
    });
    expect(faultReason(quiet, NOW)).toBe("nothing received for 21 days");
  });

  it("falls back to a plain phrase when the feed gave no time", () => {
    const quiet = station({ levelTwoAt: null, fault: "noRecentData" });
    expect(faultReason(quiet, NOW)).toBe("not sending");
  });
});

describe("how long since anything was heard from a radar", () => {
  it("reads the offset the feed publishes rather than assuming UTC", () => {
    // The feed stamps these with a local offset. Parsed as UTC, a site in
    // Eastern time reads four hours in the future, which then reads as a
    // clock disagreement and hides a genuinely silent radar.
    expect(minutesSinceLevelTwo(station(), NOW)).toBe(0);
    expect(
      minutesSinceLevelTwo(
        station({ levelTwoAt: "2026-09-02T22:05:01-04:00" }),
        NOW,
      ),
    ).toBe(0);
  });

  it("treats a time from the future as now, not as a dead radar", () => {
    expect(
      minutesSinceLevelTwo(
        station({ levelTwoAt: "2026-09-03T02:20:00Z" }),
        NOW,
      ),
    ).toBe(0);
  });

  it("has nothing to say without a time", () => {
    expect(minutesSinceLevelTwo(station({ levelTwoAt: null }), NOW)).toBeNull();
    expect(
      minutesSinceLevelTwo(station({ levelTwoAt: "soon" }), NOW),
    ).toBeNull();
    expect(minutesSinceLevelTwo(null, NOW)).toBeNull();
  });
});

describe("what the legend says about a held site's silence", () => {
  it("stays quiet while the radar is being heard from", () => {
    expect(levelTwoLate(station(), NOW)).toBeNull();
    // Nine minutes is an ordinary gap: a radar in clear air scans every ten.
    expect(
      levelTwoLate(station({ levelTwoAt: "2026-09-03T01:57:00Z" }), NOW),
    ).toBeNull();
  });

  it("says how long once the gap is longer than a scan", () => {
    // The site keeps being drawn, because the reader chose it and the last
    // volume is still the last thing anybody knows. What it must not do is go
    // on looking current.
    expect(
      levelTwoLate(station({ levelTwoAt: "2026-09-03T01:36:00Z" }), NOW),
    ).toBe("NOT HEARD FROM FOR 30 min");
  });
});

describe("finding one site in the country's worth of them", () => {
  it("answers for the station asked about and nothing else", () => {
    const said = [station(), station({ station: "KTLX" })];
    expect(statusFor(said, "KTLX")?.station).toBe("KTLX");
    expect(statusFor(said, "KOUN")).toBeNull();
    expect(statusFor(said, null)).toBeNull();
    expect(statusFor([], "KDMX")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  ambientObservation,
  AMBIENT_STALE_MS,
  conditionFromMetar,
} from "./ambient";

/** Real reports, trimmed, from the stations they name. */
const RAIN = "KDFW 021253Z 15012KT 6SM -RA BR BKN012 OVC025 18/17 A2989";
const HEAVY = "KDFW 021253Z 15012KT 2SM +SHRA BKN012 OVC025 18/17 A2989";
const SNOW = "KDEN 021253Z 03008KT 1/2SM -SN FZFG VV006 M04/M06 A3012";
const THUNDER = "KOUN 021253Z 18015G25KT 4SM TSRA BKN020CB 22/20 A2985";
const FOG = "KSFO 021253Z 00000KT 1/4SM FG VV002 12/12 A3005";
const CLEAR = "KLAX 021253Z 26008KT 10SM FEW020 SCT250 21/14 A2996";
const WINTRY = "KORD 021253Z 03012KT 3SM -SN -RA BR OVC015 00/M01 A2998";

describe("what a station says is falling", () => {
  it("reads the present weather and nothing else in the report", () => {
    expect(conditionFromMetar(RAIN)).toBe("rain");
    expect(conditionFromMetar(HEAVY)).toBe("rain");
    expect(conditionFromMetar(SNOW)).toBe("snow");
    expect(conditionFromMetar(FOG)).toBe("fog");
    expect(conditionFromMetar(CLEAR)).toBeNull();
  });

  it("calls a thunderstorm a thunderstorm whatever else is in it", () => {
    // TSRA is a thunderstorm with rain. Drawing it as rain would be true and
    // would leave out the part worth noticing.
    expect(conditionFromMetar(THUNDER)).toBe("thunder");
  });

  it("takes the colder of two when a report carries both", () => {
    // Somebody is dressing for the snow rather than for the rain.
    expect(conditionFromMetar(WINTRY)).toBe("snow");
  });

  it("does not read a wind, a cloud layer or a temperature as weather", () => {
    // The failure this guards: `BKN012` has RA nowhere in it but `FEW020`
    // near enough anything can be found in a report read letter by letter.
    expect(
      conditionFromMetar("KXYZ 021253Z 24015G25KT 10SM BKN035 M02/M08 A3001"),
    ).toBeNull();
    // A station whose identifier happens to spell a code is still an
    // identifier, because the first group is skipped.
    expect(conditionFromMetar("KRA 021253Z 10SM CLR 20/10 A3000")).toBeNull();
    // And the remarks are prose. RMK carries things like RAB35 for the minute
    // rain began, which is history rather than the present.
    expect(
      conditionFromMetar("KXYZ 021253Z 10SM CLR 20/10 A3000 RMK RAB35E52"),
    ).toBeNull();
  });
});

describe("an observation the chrome is allowed to draw", () => {
  const now = Date.UTC(2026, 8, 2, 13, 30);

  it("carries the station and the time it was taken", () => {
    const seen = ambientObservation(RAIN, now - 5 * 60_000, "KDFW", now);
    expect(seen).toEqual({
      condition: "rain",
      station: "KDFW",
      observed: now - 5 * 60_000,
    });
  });

  it("stops rather than carrying on with the last thing it knew", () => {
    // An hour and a half of silence is a station that has stopped reporting,
    // not a station where it is still raining.
    expect(
      ambientObservation(RAIN, now - AMBIENT_STALE_MS + 1000, "KDFW", now),
    ).not.toBeNull();
    expect(
      ambientObservation(RAIN, now - AMBIENT_STALE_MS - 1000, "KDFW", now),
    ).toBeNull();
  });

  it("refuses a report it cannot date", () => {
    // An effect that cannot go stale is an effect that lies eventually.
    expect(ambientObservation(RAIN, null, "KDFW", now)).toBeNull();
    expect(ambientObservation(RAIN, Number.NaN, "KDFW", now)).toBeNull();
    // And a report from the future is a clock somebody has set wrong.
    expect(ambientObservation(RAIN, now + 60 * 60_000, "KDFW", now)).toBeNull();
  });

  it("says nothing when the weather is doing nothing", () => {
    expect(ambientObservation(CLEAR, now, "KLAX", now)).toBeNull();
    expect(ambientObservation("", now, "KLAX", now)).toBeNull();
  });
});

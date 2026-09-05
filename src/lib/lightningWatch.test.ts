import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lightningBody } from "../hooks/useLightningWatch";
import { setUnits } from "./units";
import {
  DEFAULT_LIGHTNING_RULE,
  LIGHTNING_COUNTS,
  LIGHTNING_FRESH_MS,
  LIGHTNING_RADII,
  QUIET_AFTER_MS,
  forgetLightning,
  lightningRemembered,
  lightningStep,
  rememberLightning,
  flashesNear,
  lightningAfter,
  lightningNear,
  lightningToAnnounce,
  type LightningSaid,
} from "./lightningWatch";
import type { Flash, FlashWindow } from "../hooks/useLightning";
import type { WatchPlace } from "./watch";

const NOW = Date.parse("2026-09-03T18:00:00Z");

/** A flash, at a point, at a moment. Times are seconds, as the decoder gives. */
function flash(lat: number, lon: number, at = NOW): Flash {
  return {
    latitude: lat,
    longitude: lon,
    energyJoules: 1,
    areaSquareKm: 10,
    time: at / 1000,
  };
}

function window_(flashes: Flash[]): FlashWindow {
  return {
    satellite: "GOES-19",
    windowMinutes: 5,
    observed: NOW / 1000,
    flashes,
    trimmed: false,
    filesRead: 5,
    filesExpected: 5,
  };
}

function place(
  id: string,
  name: string,
  lon: number,
  lat: number,
  overrides: Partial<WatchPlace> = {},
): WatchPlace {
  return {
    id,
    name,
    enabled: true,
    center: [lon, lat],
    radiusMiles: 25,
    minSeverity: "severe",
    sound: false,
    named: true,
    ...overrides,
  };
}

const FIELD = place("field", "Ballfield", -93.6, 41.6);
const ON = { ...DEFAULT_LIGHTNING_RULE, enabled: true, radiusMiles: 10 };

describe("which flashes are near a place", () => {
  it("counts by distance, not by a box", () => {
    // A flash nine miles away diagonally is nine miles away. A box would
    // count one at thirteen miles on the corner and miss the point of a
    // radius somebody set to ten.
    const near = flashesNear(
      [
        flash(41.6, -93.6),
        // About eight miles north.
        flash(41.716, -93.6),
        // About twenty miles east, outside.
        flash(41.6, -93.21),
      ],
      { lon: -93.6, lat: 41.6 },
      10,
    );
    expect(near).toHaveLength(2);
  });

  it("answers for each watched place and leaves the rest out", () => {
    const far = place("far", "Far", -80.2, 25.8);
    const off = place("off", "Off", -93.6, 41.6, { enabled: false });
    const near = lightningNear(
      window_([flash(41.6, -93.6), flash(41.62, -93.62)]),
      [FIELD, far, off],
      ON,
    );
    expect(near.map((one) => one.placeId)).toEqual(["field", "far"]);
    expect(near[0].flashes).toBe(2);
    expect(near[1].flashes).toBe(0);
    // The busiest first, which is the order somebody reads this in.
    expect(near[0].flashes).toBeGreaterThanOrEqual(near[1].flashes);
  });

  it("reads the newest flash in the unit every clock here uses", () => {
    // The decoder publishes seconds and every comparison in the app is
    // milliseconds. Passed through unmultiplied, the quiet rule would fire
    // instantly: a flash from this afternoon would read as 1970.
    const near = lightningNear(
      window_([flash(41.6, -93.6, NOW - 60_000), flash(41.6, -93.6, NOW)]),
      [FIELD],
      ON,
    );
    expect(near[0].newest).toBe(NOW);
  });

  it("reports the nearest flash, not the newest one", () => {
    // A reader at a ballfield acts on how close the storm has come. The
    // closest flash and the most recent one are rarely the same flash, and
    // reading the distance off the newest would say a strike was eight miles
    // out while one had landed two miles away a minute earlier.
    const near = lightningNear(
      window_([
        // About eight miles north, just now, and first in the file: taking
        // whichever flash comes first reads this one.
        flash(41.716, -93.6, NOW),
        // About two miles east, a minute ago.
        flash(41.6, -93.5613, NOW - 60_000),
      ]),
      [FIELD],
      ON,
    );
    expect(near[0].newest).toBe(NOW);
    expect(near[0].nearestMiles).toBeCloseTo(2, 0);
    // Due east of the place, which is where the near one was planted.
    expect(near[0].nearestBearing).toBeCloseTo(90, 0);
  });

  it("says nothing about distance for a place with no flashes", () => {
    const near = lightningNear(window_([]), [FIELD], ON);
    expect(near[0].flashes).toBe(0);
    expect(near[0].nearestMiles).toBeNull();
    expect(near[0].nearestBearing).toBeNull();
  });
});

describe("the stoplight a watched place shows", () => {
  it("steps at ten minutes and again at half an hour", () => {
    // The testbed's finding is the negative one: nothing but elapsed time may
    // read as clear, because a probability that has trended down is not an
    // all-clear while a strike six miles out is ten minutes old. So the
    // clock is driven forward through all three and nothing else changes.
    // The feed is read at each of these moments, so the quiet is observed
    // rather than assumed; the case where it is not is below.
    const at = NOW;
    const read = (now: number) => lightningStep(at, now, now);
    expect(read(at)).toBe("fresh");
    expect(read(at + LIGHTNING_FRESH_MS - 1)).toBe("fresh");
    expect(read(at + LIGHTNING_FRESH_MS)).toBe("recent");
    expect(read(at + QUIET_AFTER_MS - 1)).toBe("recent");
    expect(read(at + QUIET_AFTER_MS)).toBe("clear");
    expect(read(at + QUIET_AFTER_MS * 4)).toBe("clear");
  });

  it("steps on the same half hour the all-clear is said on", () => {
    // Two numbers for one rule is how a chip reads clear while the notice has
    // not gone out, or the other way round.
    expect(lightningStep(NOW, NOW + QUIET_AFTER_MS, NOW + QUIET_AFTER_MS)).toBe(
      "clear",
    );
    expect(LIGHTNING_FRESH_MS).toBeLessThan(QUIET_AFTER_MS);
  });

  it("will not call a place clear off a feed nobody has read", () => {
    // The failure this exists for: with the lightning layer on and the notice
    // off, the app stops polling while the window is hidden, and the flashes
    // it is holding go on being the flashes it was holding. Elapsed time says
    // half an hour; nobody watched any of it.
    const stale = NOW + 60_000;
    expect(lightningStep(NOW, NOW + QUIET_AFTER_MS, stale)).toBe("recent");
    expect(lightningStep(NOW, NOW + QUIET_AFTER_MS * 4, stale)).toBe("recent");
    // Read since, and for long enough, it is the all-clear.
    expect(lightningStep(NOW, NOW + QUIET_AFTER_MS, NOW + QUIET_AFTER_MS)).toBe(
      "clear",
    );
    // A minute short of it is not.
    expect(
      lightningStep(NOW, NOW + QUIET_AFTER_MS, NOW + QUIET_AFTER_MS - 60_000),
    ).toBe("recent");
  });

  it("says nothing at all about a place that has seen no flash", () => {
    // Not "clear". Nothing has happened, which is a different statement from
    // something that has stopped, and the chip draws neither.
    expect(lightningStep(null, NOW)).toBeNull();
  });

  it("treats a flash stamped after the clock as now", () => {
    // The satellite's stamp and this machine's clock are two clocks. One
    // ahead of the other by a few seconds must not read as half an hour of
    // quiet in the other direction.
    expect(lightningStep(NOW + 5_000, NOW)).toBe("fresh");
  });
});

describe("what a place is remembered as having had", () => {
  it("keeps the last flash after it falls out of the window", () => {
    // The feed holds five minutes. Read from that alone the age of the last
    // flash could never pass about six minutes, so the chip could never reach
    // its second step and the all-clear it exists to say was unreachable.
    const seen = lightningNear(window_([flash(41.6, -93.6, NOW)]), [FIELD], ON);
    const held = new Map(seen.map((place) => [place.placeId, place]));

    // The next window, four minutes later, with the storm gone.
    const empty = lightningNear(window_([]), [FIELD], ON);
    expect(empty[0].newest).toBeNull();

    const remembered = lightningRemembered(empty, held);
    expect(remembered[0].newest).toBe(NOW);
    expect(remembered[0].nearestMiles).toBeCloseTo(0, 1);
    // The count is the window's own and is not carried: a place that has gone
    // quiet has had no flashes, whatever it had before.
    expect(remembered[0].flashes).toBe(0);
  });

  it("takes a real reading over the one it was holding", () => {
    const older = lightningNear(
      window_([flash(41.6, -93.6, NOW - 600_000)]),
      [FIELD],
      ON,
    );
    const held = new Map(older.map((place) => [place.placeId, place]));
    const newer = lightningNear(
      window_([flash(41.6, -93.6, NOW)]),
      [FIELD],
      ON,
    );
    expect(lightningRemembered(newer, held)[0].newest).toBe(NOW);
  });

  it("remembers nothing for a place that has never had a flash", () => {
    const empty = lightningNear(window_([]), [FIELD], ON);
    expect(lightningRemembered(empty, new Map())[0].newest).toBeNull();
  });

  describe("the store the app keeps it in", () => {
    beforeEach(forgetLightning);
    afterEach(forgetLightning);

    it("carries a flash across the window that loses it", () => {
      const seen = rememberLightning(
        lightningNear(window_([flash(41.6, -93.6, NOW)]), [FIELD], ON),
      );
      expect(seen[0].newest).toBe(NOW);
      const after = rememberLightning(lightningNear(window_([]), [FIELD], ON));
      expect(after[0].newest).toBe(NOW);
      expect(after[0].flashes).toBe(0);
    });

    it("gives the same answer folded twice, which is what a re-render is", () => {
      // The fold happens while rendering, and React renders a component twice
      // in development. A second pass over the same window must not move the
      // answer, or a chip would read one age and then another.
      const window = window_([flash(41.6, -93.6, NOW)]);
      const once = rememberLightning(lightningNear(window, [FIELD], ON));
      const twice = rememberLightning(lightningNear(window, [FIELD], ON));
      expect(twice).toEqual(once);
    });

    it("forgets a place that is no longer watched", () => {
      rememberLightning(
        lightningNear(window_([flash(41.6, -93.6, NOW)]), [FIELD], ON),
      );
      // The place goes away, and comes back an hour later.
      rememberLightning(
        lightningNear(window_([]), [place("other", "Other", -80.2, 25.8)], ON),
      );
      const back = rememberLightning(lightningNear(window_([]), [FIELD], ON));
      expect(back[0].newest).toBeNull();
    });
  });
});

describe("what is worth saying about it", () => {
  it("says nothing at all until somebody asks", () => {
    expect(DEFAULT_LIGHTNING_RULE.enabled).toBe(false);
    expect(DEFAULT_LIGHTNING_RULE.sound).toBe(false);
    const near = lightningNear(window_([flash(41.6, -93.6)]), [FIELD], ON);
    expect(
      lightningToAnnounce(
        near,
        DEFAULT_LIGHTNING_RULE,
        [FIELD],
        new Map(),
        NOW,
      ),
    ).toEqual([]);
  });

  it("waits for the count the reader set", () => {
    const rule = { ...ON, count: 3 };
    const two = lightningNear(
      window_([flash(41.6, -93.6), flash(41.61, -93.6)]),
      [FIELD],
      rule,
    );
    expect(lightningToAnnounce(two, rule, [FIELD], new Map(), NOW)).toEqual([]);
    const three = lightningNear(
      window_([flash(41.6, -93.6), flash(41.61, -93.6), flash(41.62, -93.6)]),
      [FIELD],
      rule,
    );
    expect(
      lightningToAnnounce(three, rule, [FIELD], new Map(), NOW).map(
        (one) => one.kind,
      ),
    ).toEqual(["started"]);
  });

  it("says it once, not once per poll", () => {
    // A storm overhead for an hour is one thing to say, not sixty.
    const near = lightningNear(window_([flash(41.6, -93.6)]), [FIELD], ON);
    let said = new Map<string, LightningSaid>();
    const first = lightningToAnnounce(near, ON, [FIELD], said, NOW);
    expect(first).toHaveLength(1);
    said = lightningAfter(near, said, first);
    expect(lightningToAnnounce(near, ON, [FIELD], said, NOW)).toEqual([]);
    expect(lightningToAnnounce(near, ON, [FIELD], said, NOW + 60_000)).toEqual(
      [],
    );
  });

  it("says it is over half an hour after the last flash, not the last poll", () => {
    // Measured from the flash. A window that goes empty because the satellite
    // missed a file is not half an hour of quiet, and a reader told to go
    // back out on that would be going out under a storm.
    const busy = lightningNear(window_([flash(41.6, -93.6)]), [FIELD], ON);
    let said = lightningAfter(
      busy,
      new Map(),
      lightningToAnnounce(busy, ON, [FIELD], new Map(), NOW),
    );
    const empty = lightningNear(window_([]), [FIELD], ON);

    // Ten minutes later, still nothing to say.
    expect(
      lightningToAnnounce(empty, ON, [FIELD], said, NOW + 10 * 60_000),
    ).toEqual([]);
    // Half an hour after the flash, it is over.
    const over = lightningToAnnounce(
      empty,
      ON,
      [FIELD],
      said,
      NOW + QUIET_AFTER_MS,
    );
    expect(over.map((one) => one.kind)).toEqual(["quiet"]);
    // And once. The next poll has nothing to add.
    said = lightningAfter(empty, said, over);
    expect(
      lightningToAnnounce(empty, ON, [FIELD], said, NOW + QUIET_AFTER_MS + 1),
    ).toEqual([]);
  });

  it("stands down during quiet hours, but still says when it is over", () => {
    // Somebody who was not told to come in does not need telling; somebody
    // who was has to hear that they can go back out, whatever the hour.
    const night = place("night", "Cabin", -93.6, 41.6, {
      quietHours: {
        enabled: true,
        startMinute: 0,
        endMinute: 23 * 60 + 59,
        overrideSeverity: "extreme",
      },
    });
    const busy = lightningNear(window_([flash(41.6, -93.6)]), [night], ON);
    expect(lightningToAnnounce(busy, ON, [night], new Map(), NOW)).toEqual([]);

    // Told during the day, then quiet hours begin: the all-clear still comes.
    const told = new Map<string, LightningSaid>([
      ["night", { active: true, newest: NOW }],
    ]);
    const empty = lightningNear(window_([]), [night], ON);
    expect(
      lightningToAnnounce(empty, ON, [night], told, NOW + QUIET_AFTER_MS).map(
        (one) => one.kind,
      ),
    ).toEqual(["quiet"]);
  });

  it("forgets a place that is no longer being watched", () => {
    // Switching one back on must not announce a storm that ended an hour ago.
    const busy = lightningNear(window_([flash(41.6, -93.6)]), [FIELD], ON);
    const said = lightningAfter(
      busy,
      new Map(),
      lightningToAnnounce(busy, ON, [FIELD], new Map(), NOW),
    );
    expect(said.get("field")?.active).toBe(true);
    const gone = lightningAfter([], said, []);
    expect(gone.has("field")).toBe(false);
  });

  it("offers only the radii and counts the setting can hold", () => {
    expect(LIGHTNING_RADII).toContain(DEFAULT_LIGHTNING_RULE.radiusMiles);
    expect(LIGHTNING_COUNTS).toContain(DEFAULT_LIGHTNING_RULE.count);
  });
});

describe("what the lightning watch says a radius is", () => {
  afterEach(() => setUnits("imperial"));

  it("says it in the units the reader chose", async () => {
    // Every other distance the app says out loud goes through
    // `distanceValue`; this one was handed raw miles under a catalogue
    // string that wrote "mi" into all three languages, so a metric reader
    // was told "10 mi" on the control and "within 10 miles" in the notice.
    setUnits("metric");
    const said = lightningBody({
      kind: "started",
      place: {
        placeId: "home",
        placeName: "Home",
        named: false,
        flashes: 3,
        radiusMiles: 10,
        nearestMiles: 4,
        nearestBearing: 90,
        checkedAt: Date.UTC(2026, 8, 4, 20),
        newest: Date.UTC(2026, 8, 4, 20),
      },
    });
    // The long word in a sentence, the way every other distance the app
    // says out loud reads: "within 16 kilometres".
    expect(said).toContain("16 kilometres");
    expect(said).not.toContain("miles");

    setUnits("imperial");
    expect(
      lightningBody({
        kind: "started",
        place: {
          placeId: "home",
          placeName: "Home",
          named: false,
          flashes: 3,
          radiusMiles: 10,
          nearestMiles: 4,
          nearestBearing: 90,
          checkedAt: Date.UTC(2026, 8, 4, 20),
          newest: Date.UTC(2026, 8, 4, 20),
        },
      }),
    ).toContain("10 miles");
  });
});

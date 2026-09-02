import { describe, expect, it } from "vitest";
import {
  alertsToAnnounce,
  alertsToAnnounceAcross,
  inQuietHours,
  localMinute,
  silencedByQuietHours,
  testWatchAlert,
  watchAlertBody,
  watchBounds,
  watchesBounds,
  watchReasonLines,
  type WatchPlace,
} from "./watch";
import type { OverlayData } from "./overlays";
import { DEFAULT_SETTINGS, normalizeSettings, watchedPlaces } from "./settings";
import { translate } from "../i18n";

const watch = {
  enabled: true,
  center: [-96.8, 32.78] as [number, number],
  radiusMiles: 30,
  minSeverity: "severe" as const,
  sound: false,
};

const now = Date.parse("2026-08-30T12:00:00Z");

function alert(
  headline: string,
  severity: string,
  ring: Array<[number, number]>,
  extra: Record<string, unknown> = {},
): OverlayData["features"][number] {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { headline, severity, url: `https://x/${headline}`, ...extra },
  };
}

const near: Array<[number, number]> = [
  [-96.9, 32.7],
  [-96.7, 32.7],
  [-96.7, 32.9],
  [-96.9, 32.9],
  [-96.9, 32.7],
];
const far: Array<[number, number]> = [
  [-90, 30],
  [-89, 30],
  [-89, 31],
  [-90, 31],
  [-90, 30],
];

describe("watched area", () => {
  it("asks for a box that covers the radius", () => {
    const bounds = watchBounds(watch);
    expect(bounds.north - bounds.south).toBeCloseTo((30 * 2) / 69, 3);
    expect(bounds.east).toBeGreaterThan(watch.center[0]);
    expect(bounds.west).toBeLessThan(watch.center[0]);
  });

  it("announces a severe alert that reaches the watched point", () => {
    const found = alertsToAnnounce(
      {
        type: "FeatureCollection",
        features: [alert("Tornado Warning", "extreme", near)],
      },
      watch,
      new Map(),
      now,
    );
    expect(found).toHaveLength(1);
    expect(found[0].headline).toBe("Tornado Warning");
    expect(watchAlertBody(found[0])).toContain("where you are watching");
  });

  it("stays quiet for anything too far, too mild, expired, or already said", () => {
    const features = [
      alert("Distant Warning", "extreme", far),
      alert("Heat Advisory", "minor", near),
      alert("Old Warning", "severe", near, { expires: now - 1000 }),
      alert("Seen Warning", "severe", near),
    ];
    const found = alertsToAnnounce(
      { type: "FeatureCollection", features },
      watch,
      new Map([["https://x/Seen Warning", 0]]),
      now,
    );
    expect(found).toEqual([]);
  });

  it("says nothing at all while the watch is switched off", () => {
    expect(
      alertsToAnnounce(
        {
          type: "FeatureCollection",
          features: [alert("Tornado Warning", "extreme", near)],
        },
        { ...watch, enabled: false },
        new Map(),
        now,
      ),
    ).toEqual([]);
  });

  it("puts the worst first", () => {
    const found = alertsToAnnounce(
      {
        type: "FeatureCollection",
        features: [
          alert("Severe Thunderstorm Warning", "severe", near),
          alert("Tornado Warning", "extreme", near),
        ],
      },
      watch,
      new Map(),
      now,
    );
    expect(found.map((item) => item.headline)).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
    ]);
  });
});

describe("a warning the office upgrades", () => {
  const collection = (features: OverlayData["features"]): OverlayData => ({
    type: "FeatureCollection",
    features,
  });

  it("is announced again, once, and not a third time", () => {
    // An office can upgrade a warning already in force. That is the office
    // saying the thing got worse, and it is worth interrupting somebody for a
    // second time. What it must not do is interrupt them on every refresh
    // afterwards.
    const announced = new Map<string, number>();
    const say = (found: ReturnType<typeof alertsToAnnounce>) => {
      for (const one of found) announced.set(one.id, one.rank);
      return found;
    };

    const ordinary = collection([
      alert("Tornado Warning", "extreme", near, { impact: "" }),
    ]);
    expect(say(alertsToAnnounce(ordinary, watch, announced, now))).toHaveLength(
      1,
    );

    // The same warning, still in force, still ordinary.
    expect(alertsToAnnounce(ordinary, watch, announced, now)).toHaveLength(0);

    const upgraded = collection([
      alert("Tornado Warning", "extreme", near, { impact: "considerable" }),
    ]);
    const second = say(alertsToAnnounce(upgraded, watch, announced, now));
    expect(second).toHaveLength(1);
    expect(second[0].impact).toBe("considerable");

    // And then quiet again, however many times it is checked.
    expect(alertsToAnnounce(upgraded, watch, announced, now)).toHaveLength(0);
    expect(alertsToAnnounce(upgraded, watch, announced, now)).toHaveLength(0);

    // Upgraded once more, which is a third thing worth saying.
    const worse = collection([
      alert("Tornado Warning", "extreme", near, { impact: "destructive" }),
    ]);
    const third = say(alertsToAnnounce(worse, watch, announced, now));
    expect(third).toHaveLength(1);
    expect(third[0].impact).toBe("destructive");
  });

  it("says nothing when the tag goes away, because that is not a downgrade", () => {
    // The tag comes from a feed that rate-limits. When it does, the tag
    // disappears and the warning looks new again. Somebody told the office
    // called it destructive should not be woken a second time with the plain
    // wording because a service somewhere returned 429.
    const announced = new Map<string, number>();
    const tagged = collection([
      alert("Tornado Warning", "extreme", near, { impact: "destructive" }),
    ]);
    for (const one of alertsToAnnounce(tagged, watch, announced, now)) {
      announced.set(one.id, one.rank);
    }

    const untagged = collection([
      alert("Tornado Warning", "extreme", near, { impact: "" }),
    ]);
    expect(alertsToAnnounce(untagged, watch, announced, now)).toHaveLength(0);
    // Flapping does not accumulate either.
    expect(alertsToAnnounce(tagged, watch, announced, now)).toHaveLength(0);
    expect(alertsToAnnounce(untagged, watch, announced, now)).toHaveLength(0);

    // A genuine further upgrade still gets through.
    const worse = collection([
      alert("Tornado Warning", "extreme", near, { impact: "catastrophic" }),
    ]);
    expect(alertsToAnnounce(worse, watch, announced, now)).toHaveLength(1);
  });

  it("says which tag it was given, so the second one reads differently", () => {
    const plain = alertsToAnnounce(
      collection([alert("Tornado Warning", "extreme", near)]),
      watch,
      new Map(),
      now,
    )[0];
    const tagged = alertsToAnnounce(
      collection([
        alert("Tornado Warning", "extreme", near, { impact: "destructive" }),
      ]),
      watch,
      new Map(),
      now,
    )[0];

    const plainBody = watchAlertBody(plain);
    const taggedBody = watchAlertBody(tagged);
    expect(plainBody).not.toContain("destructive");
    expect(taggedBody).toContain("destructive");
    // The rest of the sentence is the same, so somebody woken twice can see
    // what changed rather than reading two unrelated lines.
    expect(taggedBody.startsWith(plainBody)).toBe(true);
  });
});

describe("quiet hours", () => {
  const overnight = {
    enabled: true,
    // Ten at night until seven, which crosses midnight.
    startMinute: 22 * 60,
    endMinute: 7 * 60,
    overrideSeverity: "extreme" as const,
  };

  /** A local time of day, built so the test does not depend on the zone. */
  const at = (hour: number, minute = 0) =>
    new Date(2026, 7, 30, hour, minute, 0, 0);

  it("covers a window that crosses midnight, on both sides of it", () => {
    expect(inQuietHours(overnight, at(23))).toBe(true);
    expect(inQuietHours(overnight, at(2))).toBe(true);
    expect(inQuietHours(overnight, at(6, 59))).toBe(true);
    expect(inQuietHours(overnight, at(12))).toBe(false);
    expect(inQuietHours(overnight, at(21, 59))).toBe(false);
  });

  // The boundaries themselves, which is where an off-by-one hides.
  it("starts on its start minute and ends on its end minute", () => {
    expect(inQuietHours(overnight, at(22, 0))).toBe(true);
    expect(inQuietHours(overnight, at(7, 0))).toBe(false);
  });

  it("covers a window inside one day", () => {
    const daytime = { ...overnight, startMinute: 9 * 60, endMinute: 17 * 60 };
    expect(inQuietHours(daytime, at(12))).toBe(true);
    expect(inQuietHours(daytime, at(8, 59))).toBe(false);
    expect(inQuietHours(daytime, at(17))).toBe(false);
  });

  // A window of no width must silence nothing. The other reading silences
  // everything forever, which is the one outcome a weather app must not reach
  // by accident.
  it("silences nothing when the window has no width", () => {
    const empty = { ...overnight, startMinute: 300, endMinute: 300 };
    expect(inQuietHours(empty, at(5))).toBe(false);
    expect(inQuietHours(empty, at(17))).toBe(false);
  });

  it("does nothing at all when switched off", () => {
    expect(inQuietHours({ ...overnight, enabled: false }, at(3))).toBe(false);
  });

  it("holds an ordinary warning back and lets an extreme one through", () => {
    const quiet = { ...watch, quietHours: overnight };
    expect(silencedByQuietHours(quiet, "severe", at(3))).toBe(true);
    expect(silencedByQuietHours(quiet, "extreme", at(3))).toBe(false);
    // Outside the window nothing is held back.
    expect(silencedByQuietHours(quiet, "severe", at(12))).toBe(false);
  });

  it("holds nothing back for a watch that never configured them", () => {
    expect(silencedByQuietHours(watch, "minor", at(3))).toBe(false);
  });

  // Reading the clock as UTC rather than as the reader's own would move the
  // window by the offset, which is the whole bug this guards.
  //
  // A local noon and a UTC noon are the same number on a machine running at
  // UTC, so asserting only the local one proves nothing there. This asserts
  // that the two readings differ by exactly the machine's own offset, which
  // holds everywhere and only passes for a local reading.
  it("reads the reader's own clock rather than UTC", () => {
    const noonLocal = at(12);
    expect(localMinute(noonLocal)).toBe(12 * 60);
    expect(localMinute(noonLocal.getTime())).toBe(12 * 60);

    // Midday UTC, whatever that is locally.
    const noonUtc = new Date(Date.UTC(2026, 7, 30, 12, 0, 0));
    const offsetMinutes = -noonUtc.getTimezoneOffset();
    const expected = (12 * 60 + offsetMinutes + 1440) % 1440;
    expect(localMinute(noonUtc)).toBe(expected);
  });
});

describe("why an alert was announced", () => {
  it("names the event, the threshold, and the distance", () => {
    const lines = watchReasonLines({
      event: "tornado",
      severity: "extreme",
      minSeverity: "severe",
      radiusMiles: 30,
      distanceMiles: 12,
      upgradedFrom: null,
    });
    const text = lines.join(" ");
    expect(text).toContain("tornado");
    expect(text).toContain("severe");
    expect(lines).toHaveLength(3);
  });

  it("says so when the same alert is being raised again", () => {
    const lines = watchReasonLines({
      event: "thunderstorm",
      severity: "severe",
      minSeverity: "severe",
      radiusMiles: 30,
      distanceMiles: 5,
      upgradedFrom: 1,
    });
    expect(lines).toHaveLength(4);
    expect(lines.at(-1)).toContain("before");
  });
});

describe("the test alert", () => {
  const home: WatchPlace = { ...watch, id: "home", name: "Home", named: false };

  it("is harmless and carries its own reason", () => {
    const alert = testWatchAlert(home);
    expect(alert.reason.event).toBe("test");
    expect(alert.distanceMiles).toBe(0);
    expect(alert.impact).toBe("");
    // It must never look like a real warning that has expired.
    expect(alert.expires).toBeNull();
  });

  it("names the place, so a reader can see the naming works", () => {
    // The point of the test alert is that somebody can watch the real
    // delivery path do its job. A reader who has called home something and
    // sees a sentence with the name left out has not seen it work.
    const named: WatchPlace = { ...home, name: "Casa", named: true };
    expect(watchAlertBody(testWatchAlert(named))).toContain("At Casa");
    expect(watchAlertBody(testWatchAlert(home))).not.toContain("At Home");
  });
});

describe("an alert held back by quiet hours", () => {
  const quiet = {
    ...watch,
    quietHours: {
      enabled: true,
      startMinute: 22 * 60,
      endMinute: 7 * 60,
      overrideSeverity: "extreme" as const,
    },
  };
  const overnight = new Date(2026, 7, 30, 3, 0, 0, 0);
  const morning = new Date(2026, 7, 30, 9, 0, 0, 0);

  /** A flash flood warning is rated severe, which is under the override. */
  const flood: OverlayData = {
    type: "FeatureCollection",
    features: [alert("Flash Flood Warning", "severe", near)],
  };

  // The bug this replaced: the watch recorded a silenced alert as announced,
  // and every later poll then filtered it out. A warning issued at three in
  // the morning and still in force at nine was never mentioned once.
  it("is still waiting to be announced when the window ends", () => {
    const announced = new Map<string, number>();

    // Overnight it is found, and the watch holds it back rather than
    // recording it. Nothing is written to the announced map.
    const atNight = alertsToAnnounce(flood, quiet, announced, now);
    expect(atNight).toHaveLength(1);
    expect(silencedByQuietHours(quiet, atNight[0].severity, overnight)).toBe(
      true,
    );
    expect(announced.size).toBe(0);

    // The morning poll finds the same warning, still in force, and this time
    // nothing silences it.
    const atMorning = alertsToAnnounce(flood, quiet, announced, now);
    expect(atMorning).toHaveLength(1);
    expect(silencedByQuietHours(quiet, atMorning[0].severity, morning)).toBe(
      false,
    );
  });

  it("does not claim it was mentioned before when it finally is", () => {
    // The upgrade line reads "You were told about this one before", and a
    // silenced alert was never told about. It has to be a first sighting.
    const announced = new Map<string, number>();
    const found = alertsToAnnounce(flood, quiet, announced, now);
    expect(found[0].reason.upgradedFrom).toBeNull();
  });
});

describe("watching more than one place", () => {
  const place = (
    id: string,
    name: string,
    center: [number, number],
    over: Partial<WatchPlace> = {},
  ): WatchPlace => ({
    id,
    // Home is the one place with a built-in label, so it is the one place
    // that can be unnamed. `watchedPlaces` sets this the same way.
    named: id !== "home",
    name,
    enabled: true,
    center,
    radiusMiles: 30,
    minSeverity: "severe",
    sound: false,
    ...over,
  });

  /** A polygon a mile or so across, centred where it is put. */
  const boxAt = (
    [lon, lat]: [number, number],
    headline: string,
    severity = "severe",
  ) => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [lon - 0.01, lat - 0.01],
          [lon + 0.01, lat - 0.01],
          [lon + 0.01, lat + 0.01],
          [lon - 0.01, lat + 0.01],
          [lon - 0.01, lat - 0.01],
        ],
      ],
    },
    properties: {
      cap_id: headline,
      headline,
      severity,
      kind: "tornado",
      expires: Date.now() + 3_600_000,
    },
  });

  const collection = (features: ReturnType<typeof boxAt>[]) => ({
    type: "FeatureCollection" as const,
    features,
  });

  it("asks for one box covering every place rather than one each", () => {
    const dallas = place("home", "Home", [-96.8, 32.78]);
    const boston = place("b", "Mum's", [-71.06, 42.36]);
    const bounds = watchesBounds([dallas, boston])!;
    expect(bounds).not.toBeNull();
    // Both places inside it, with their own radius to spare.
    for (const one of [dallas, boston]) {
      const own = watchBounds(one);
      expect(bounds.west).toBeLessThanOrEqual(own.west);
      expect(bounds.east).toBeGreaterThanOrEqual(own.east);
      expect(bounds.south).toBeLessThanOrEqual(own.south);
      expect(bounds.north).toBeGreaterThanOrEqual(own.north);
    }
    // Nothing to watch is a reason not to ask at all.
    expect(watchesBounds([])).toBeNull();
    expect(
      watchesBounds([place("off", "Off", [-96.8, 32.78], { enabled: false })]),
    ).toBeNull();
  });

  it("says one warning once and names every place it reached", () => {
    // Two places a few miles apart, and one warning over both of them.
    const here = place("home", "Home", [-96.8, 32.78]);
    const school = place("s", "School", [-96.75, 32.8]);
    const found = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [here, school],
      new Map(),
      Date.now(),
    );
    expect(found).toHaveLength(1);
    expect(found[0].places?.map((place) => place.name)).toEqual([
      "Home",
      "School",
    ]);
  });

  it("does not name a place the alert never reached", () => {
    const here = place("home", "Home", [-96.8, 32.78]);
    const away = place("a", "Mum's", [-71.06, 42.36]);
    const found = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [here, away],
      new Map(),
      Date.now(),
    );
    expect(found).toHaveLength(1);
    expect(found[0].places?.map((place) => place.name)).toEqual(["Home"]);
  });

  it("lets each place set its own floor", () => {
    // The same moderate alert over both. Home wants everything; the other
    // place only wants to hear about the serious ones.
    const here = place("home", "Home", [-96.8, 32.78], {
      minSeverity: "moderate",
    });
    const quiet = place("q", "Cabin", [-96.79, 32.79], {
      minSeverity: "extreme",
    });
    const found = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Flood Advisory", "moderate")]),
      [here, quiet],
      new Map(),
      Date.now(),
    );
    expect(found).toHaveLength(1);
    expect(found[0].places?.map((place) => place.name)).toEqual(["Home"]);
  });

  it("keeps the nearest distance when two places see the same warning", () => {
    const near = place("home", "Home", [-96.781, 32.791]);
    const far = place("f", "Work", [-96.6, 32.7]);
    const found = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [far, near],
      new Map(),
      Date.now(),
    );
    expect(found).toHaveLength(1);
    expect(found[0].places?.map((place) => place.name)).toEqual([
      "Work",
      "Home",
    ]);
    // The nearest of the two, which is the one worth reporting.
    expect(found[0].distanceMiles).toBeLessThan(1);
  });

  it("names the places in the notification when there is more than one", () => {
    const [alert] = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [
        place("home", "Home", [-96.8, 32.78]),
        place("s", "School", [-96.75, 32.8]),
      ],
      new Map(),
      Date.now(),
    );
    expect(watchAlertBody(alert)).toContain("Home, School");
  });

  it("does not repeat the obvious when only home is watched", () => {
    const [alert] = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [place("home", "Home", [-96.8, 32.78])],
      new Map(),
      Date.now(),
    );
    expect(watchAlertBody(alert)).not.toContain("At Home");
  });

  it("says the name when the reader has given home one", () => {
    // Told apart by whether the reader named it rather than by comparing the
    // label to the word "Home", which stopped being true the moment home
    // could be called something else, and was never true in Spanish.
    const [alert] = alertsToAnnounceAcross(
      collection([boxAt([-96.78, 32.79], "Tornado Warning")]),
      [place("home", "Casa", [-96.8, 32.78], { named: true })],
      new Map(),
      Date.now(),
    );
    expect(watchAlertBody(alert)).toContain("At Casa");
  });
});

describe("naming a place", () => {
  it("changes what is said and nothing about what is asked for", () => {
    // The whole point of the rule: a name is a label. Two workspaces that
    // differ only by what home is called must ask the alert service for the
    // same box, or naming a place would quietly change what is polled.
    const plain = { ...DEFAULT_SETTINGS };
    const named = {
      ...DEFAULT_SETTINGS,
      watch: { ...DEFAULT_SETTINGS.watch, name: "Casa" },
    };
    expect(watchesBounds(watchedPlaces(named))).toEqual(
      watchesBounds(watchedPlaces(plain)),
    );
    const [home] = watchedPlaces(named);
    expect(home.name).toBe("Casa");
    expect(home.named).toBe(true);
    expect(home.radiusMiles).toBe(plain.watch.radiusMiles);
    expect(home.center).toEqual(plain.watch.center);

    // And an unnamed home still says the built-in word, marked as the
    // built-in word rather than as something the reader chose.
    const [unnamed] = watchedPlaces(plain);
    expect(unnamed.named).toBe(false);
    expect(unnamed.name).toBe(translate("watch.home"));
  });

  it("keeps a name a person could have typed", () => {
    const stored = normalizeSettings({
      schemaVersion: 3,
      watch: { ...DEFAULT_SETTINGS.watch, name: "   " },
    });
    // Whitespace is not a name, so home keeps its built-in word.
    expect(stored.watch.name).toBeUndefined();
    const long = normalizeSettings({
      schemaVersion: 3,
      watch: { ...DEFAULT_SETTINGS.watch, name: `  ${"z".repeat(90)}  ` },
    });
    expect(long.watch.name).toHaveLength(60);
  });
});

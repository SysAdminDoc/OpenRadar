import { describe, expect, it } from "vitest";
import { alertsToAnnounce, watchAlertBody, watchBounds } from "./watch";
import type { OverlayData } from "./overlays";

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

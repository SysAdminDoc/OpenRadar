import { describe, expect, it } from "vitest";
import {
  ALERT_PAIRINGS,
  UNPAIRED,
  groupOf,
  pairingById,
  pairingFor,
} from "./alertPairings";
import { ALERT_TYPES, type AlertType } from "./alertTypes";
import { DEFAULT_SETTINGS } from "./settings";
import { alertsOverlay } from "./overlays/alerts";
import { en } from "../i18n/en";

/** A product name the service actually publishes, per switch group. */
const REAL_PRODUCTS: Record<AlertType, string> = {
  tornado: "Tornado Warning",
  thunderstorm: "Severe Thunderstorm Warning",
  flood: "Flash Flood Warning",
  winter: "Snow Squall Warning",
  tropical: "Storm Surge Warning",
  fire: "Red Flag Warning",
  heat: "Excessive Heat Warning",
  other: "Civil Emergency Message",
};

describe("the layer that explains a warning", () => {
  it("hands a flash flood the rain that has already fallen", () => {
    const pairing = pairingFor("Flash Flood Warning");
    expect(pairing?.id).toBe("flash-flood-rainfall");
    expect(pairing?.layers).toEqual({ qpeHour: true });
    // The hour, not the day: a flash flood is about what fell in the last
    // hour over ground that could not take it.
    expect(pairing?.layers.qpeDay).toBeUndefined();
    // A plain flood warning is the day's total instead.
    expect(pairingFor("Flood Warning")?.layers).toEqual({ qpeDay: true });
  });

  it("hands a tornado warning the wind inside the storm", () => {
    const pairing = pairingFor("Tornado Warning");
    expect(pairing?.radarProduct).toBe("velocity");
    expect(pairing?.layers).toEqual({ rotationTracks: true });
  });

  it("hands a snow squall what is falling", () => {
    expect(pairingFor("Snow Squall Warning")?.layers).toEqual({
      precipType: true,
    });
    // And the same for the rest of winter, which is the more general rule
    // sitting behind the specific one.
    expect(pairingFor("Winter Storm Warning")?.layers).toEqual({
      precipType: true,
    });
  });

  it("reads the most specific rule first", () => {
    // A flash flood emergency is water in a hurry rather than a flood, and a
    // snow squall is not the same answer as a blizzard would get by accident.
    expect(pairingFor("Flash Flood Emergency")?.id).toBe(
      "flash-flood-rainfall",
    );
    expect(pairingFor("Snow Squall Warning")?.id).toBe("snow-squall-type");
  });

  it("changes only switches this build has", () => {
    for (const pairing of ALERT_PAIRINGS) {
      expect(pairing.key in en).toBe(true);
      for (const key of Object.keys(pairing.layers)) {
        expect(key in DEFAULT_SETTINGS.layers).toBe(true);
      }
      // A pairing that named a layer and left it off would be a button that
      // does nothing.
      for (const value of Object.values(pairing.layers)) {
        expect(value).toBe(true);
      }
      expect(pairingById(pairing.id)).toBe(pairing);
    }
    expect(pairingById("nothing-like-this")).toBeNull();
  });

  it("has an answer or a reason for every switch group", () => {
    // The point of the table: a hazard with nothing to show is a decision
    // somebody wrote down, and a new one is a gap this points at rather than
    // a button that quietly never appears.
    for (const { id } of ALERT_TYPES) {
      const product = REAL_PRODUCTS[id];
      expect(groupOf(product)).toBe(id);
      const pairing = pairingFor(product);
      if (pairing) {
        expect(UNPAIRED[id]).toBeUndefined();
        continue;
      }
      expect(UNPAIRED[id]).toBeTruthy();
      expect(String(UNPAIRED[id]).length).toBeGreaterThan(40);
    }
  });

  it("says nothing at all about a product it does not know", () => {
    expect(pairingFor("")).toBeNull();
    expect(pairingFor("Special Marine Warning")).toBeNull();
  });
});

describe("what the warning popup offers", () => {
  const properties = {
    headline: "Flash Flood Warning",
    issued: Date.parse("2026-09-01T20:00:00Z"),
    expires: Date.parse("2026-09-01T23:00:00Z"),
    office: "Des Moines",
  };

  it("carries the action beside the warning's own words", () => {
    const said = alertsOverlay.describe(properties);
    expect(said.title).toBe("Flash Flood Warning");
    expect(said.action?.id).toBe("flash-flood-rainfall");
    expect(said.action?.label).toBe(en["pairing.rainfall"]);
    // And the warning still reads as itself: the action is an extra, not a
    // change to what the popup says about the hazard.
    expect(said.lines.join(" ")).toContain("Des Moines");
  });

  it("offers nothing on a warning out of the archive", () => {
    // Today's rainfall over a warning from 2011 would be the false-currency
    // mistake the whole replay path is careful about.
    const said = alertsOverlay.describe({
      ...properties,
      historical: true,
      polygonBegin: Date.parse("2011-04-27T20:00:00Z"),
    });
    expect(said.action).toBeUndefined();
  });

  it("offers nothing for a hazard with no paired layer", () => {
    const said = alertsOverlay.describe({
      ...properties,
      headline: "Excessive Heat Warning",
    });
    expect(said.action).toBeUndefined();
  });
});

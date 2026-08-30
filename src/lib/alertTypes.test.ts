import { describe, expect, it } from "vitest";
import { ALERT_TYPES, alertType } from "./alertTypes";
import { alertsOfKind, parseAlerts } from "./overlays/alerts";

describe("which switch an alert belongs to", () => {
  it("puts the products people think of together, together", () => {
    expect(alertType("Tornado Warning")).toBe("tornado");
    expect(alertType("Severe Thunderstorm Warning")).toBe("thunderstorm");
    expect(alertType("High Wind Warning")).toBe("thunderstorm");
    expect(alertType("Flash Flood Warning")).toBe("flood");
    expect(alertType("Winter Storm Warning")).toBe("winter");
    expect(alertType("Blizzard Warning")).toBe("winter");
    expect(alertType("Hurricane Warning")).toBe("tropical");
    expect(alertType("Storm Surge Watch")).toBe("tropical");
    expect(alertType("Red Flag Warning")).toBe("fire");
    expect(alertType("Excessive Heat Warning")).toBe("heat");
  });

  it("reads the more specific word first", () => {
    // A flash flood emergency is water rather than a thunderstorm, and a
    // tropical storm warning is tropical rather than wind. Both contain a
    // word that would otherwise put them somewhere else.
    expect(alertType("Flash Flood Emergency")).toBe("flood");
    expect(alertType("Tropical Storm Warning")).toBe("tropical");
    expect(alertType("Tornado Watch")).toBe("tornado");
    // And a winter storm is winter, not a thunderstorm.
    expect(alertType("Winter Weather Advisory")).toBe("winter");
  });

  it("has somewhere to put a product it has never seen", () => {
    // The service publishes over a hundred product names and adds to them. A
    // product that matches nothing has to appear rather than vanish.
    expect(alertType("Ashfall Advisory")).toBe("other");
    expect(alertType("Special Marine Warning")).toBe("other");
    expect(alertType("")).toBe("other");
    expect(ALERT_TYPES.some((kind) => kind.id === "other")).toBe(true);
  });
});

describe("switching a kind off", () => {
  const drawn = parseAlerts({
    features: [
      {
        geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
        properties: { prod_type: "Tornado Warning", sig: "W" },
      },
      {
        geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
        properties: { prod_type: "Flood Warning", sig: "W" },
      },
      {
        geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
        properties: { prod_type: "Ashfall Advisory", sig: "Y" },
      },
    ],
  });

  it("takes it out and leaves the rest", () => {
    expect(drawn.features).toHaveLength(3);
    const withoutFloods = alertsOfKind(drawn, { flood: false });
    expect(withoutFloods.features).toHaveLength(2);
    expect(
      withoutFloods.features.some(
        (feature) => feature.properties.kind === "flood",
      ),
    ).toBe(false);
  });

  it("draws a kind nobody has touched", () => {
    // Only the kinds switched off are stored, so a kind added in a later build
    // arrives switched on rather than missing for anyone with saved settings.
    expect(alertsOfKind(drawn, {}).features).toHaveLength(3);
    expect(alertsOfKind(drawn, { tornado: true }).features).toHaveLength(3);
  });

  it("can take everything off, which is a choice somebody made", () => {
    const nothing = alertsOfKind(drawn, {
      tornado: false,
      flood: false,
      other: false,
    });
    expect(nothing.features).toHaveLength(0);
  });
});

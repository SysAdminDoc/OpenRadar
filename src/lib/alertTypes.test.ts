import { describe, expect, it } from "vitest";
import { ALERT_TYPES, alertType } from "./alertTypes";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
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

  it("never puts a life-safety product behind a switch nobody would look under", () => {
    // The rule is by hazard, not by wording. A tsunami is not a flood to
    // anybody deciding whether to leave, and the eyewall wind of a hurricane
    // is not a thunderstorm. All of these are ranked extreme elsewhere in the
    // workspace, so a reader who unchecked the wrong box would lose the one
    // alert that mattered.
    expect(alertType("Tsunami Warning")).toBe("tornado");
    expect(alertType("Extreme Wind Warning")).toBe("tornado");
    expect(alertType("Civil Danger Warning")).toBe("tornado");
    expect(alertType("Evacuation Immediate")).toBe("tornado");
    expect(alertType("Shelter In Place Warning")).toBe("tornado");
    expect(alertType("Radiological Hazard Warning")).toBe("tornado");
  });

  it("keeps one hazard under one switch", () => {
    // A Dust Storm Warning and a Blowing Dust Advisory are the same weather,
    // and used to land under Tornado and Everything Else respectively.
    expect(alertType("Dust Storm Warning")).toBe(
      alertType("Blowing Dust Advisory"),
    );
    // Freezing Rain and Freezing Fog are the reason people crash. "freeze" is
    // not a substring of "freezing", so both fell to the bottom of the list.
    expect(alertType("Freezing Rain Advisory")).toBe("winter");
    expect(alertType("Freezing Fog Advisory")).toBe("winter");
    expect(alertType("Freezing Spray Warning")).toBe("winter");
    expect(alertType("Hard Freeze Warning")).toBe("winter");
    expect(alertType("Avalanche Warning")).toBe("winter");
    // Water is water, whichever shore it is on.
    expect(alertType("Coastal Flood Warning")).toBe("flood");
    expect(alertType("Lakeshore Flood Advisory")).toBe("flood");
    expect(alertType("High Surf Advisory")).toBe("flood");
    expect(alertType("Rip Current Statement")).toBe("flood");
    // And a marine wind warning is a wind warning.
    expect(alertType("Special Marine Warning")).toBe("thunderstorm");
  });

  it("reads the hazard before the words that happen to be in the name", () => {
    // "Extreme Wind" contains "wind"; "Tsunami" does not contain "flood" but
    // used to be routed there deliberately. Order is what decides both.
    expect(alertType("Extreme Wind Warning")).not.toBe("thunderstorm");
    expect(alertType("Tsunami Advisory")).not.toBe("flood");
    // A hurricane wind warning is tropical, not wind.
    expect(alertType("Hurricane Force Wind Warning")).toBe("tropical");
    // And a winter storm is winter, not a thunderstorm.
    expect(alertType("Winter Storm Warning")).toBe("winter");
  });

  it("has somewhere to put a product it has never seen", () => {
    // The service publishes over a hundred product names and adds to them. A
    // product that matches nothing has to appear rather than vanish.
    expect(alertType("Ashfall Advisory")).toBe("other");
    expect(alertType("Air Quality Alert")).toBe("other");
    expect(alertType("Earthquake Warning")).toBe("other");
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

describe("what the switch says it hides", () => {
  /**
   * Every product name the CAP feed publishes, near enough.
   *
   * Grouping is by hazard rather than by wording, which is right, but it means
   * a switch holds products whose names do not resemble its own. A reader in
   * Honolulu turning off a switch labelled only "Tornado", because tornadoes
   * are not their weather, would have lost tsunami warnings from the map and
   * from the watch with nothing on screen to warn them.
   */
  const PRODUCTS = [
    "Tornado Warning",
    "Tornado Watch",
    "Tsunami Warning",
    "Tsunami Advisory",
    "Tsunami Watch",
    "Extreme Wind Warning",
    "Civil Danger Warning",
    "Evacuation Immediate",
    "Shelter In Place Warning",
    "Hazardous Materials Warning",
    "Nuclear Power Plant Warning",
    "Radiological Hazard Warning",
    "Severe Thunderstorm Warning",
    "High Wind Warning",
    "Dust Storm Warning",
    "Special Marine Warning",
    "Flash Flood Warning",
    "Coastal Flood Warning",
    "High Surf Advisory",
    "Rip Current Statement",
    "Winter Storm Warning",
    "Blizzard Warning",
    "Freezing Rain Advisory",
    "Avalanche Warning",
    "Hurricane Warning",
    "Tropical Storm Warning",
    "Storm Surge Watch",
    "Hurricane Force Wind Warning",
    "Red Flag Warning",
    "Dense Smoke Advisory",
    "Excessive Heat Warning",
    "Heat Advisory",
    "Ashfall Advisory",
    "Air Quality Alert",
  ];

  /** The distinct first words of the products a switch covers. */
  const covered = (id: string) =>
    PRODUCTS.filter((product) => alertType(product) === id);

  it("gives every switch a line saying what is under it", () => {
    for (const { id, key, detailKey } of ALERT_TYPES) {
      expect(en[key], id).toBeTruthy();
      expect(en[detailKey], id).toBeTruthy();
      expect(es[key], id).toBeTruthy();
      expect(es[detailKey], id).toBeTruthy();
    }
  });

  it("names the life-safety products that are not tornadoes", () => {
    // Each of these is somebody telling you to move now, and each is grouped
    // with the tornado warnings for that reason. The switch has to say so.
    const wording = `${en["alertType.tornado"]} ${en["alertType.tornadoDetail"]}`.toLowerCase();
    for (const word of [
      "tsunami",
      "extreme wind",
      "nuclear",
      "radiological",
      "hazardous materials",
      "shelter in place",
      "evacuate",
    ]) {
      expect(wording, word).toContain(word);
    }
    // And the products really are in there, so the wording is not describing
    // something the grouping stopped doing.
    for (const product of [
      "Tsunami Warning",
      "Extreme Wind Warning",
      "Nuclear Power Plant Warning",
      "Radiological Hazard Warning",
      "Hazardous Materials Warning",
      "Shelter In Place Warning",
      "Evacuation Immediate",
    ]) {
      expect(alertType(product), product).toBe("tornado");
    }
  });

  it("does not name the take-cover switch after tornadoes alone", () => {
    // It holds tsunami warnings, extreme wind and the civil emergencies as
    // well, because all of them are somebody telling you to move now. A reader
    // in Honolulu who goes down the switch names and turns off "Tornado",
    // because tornadoes are not their weather, would lose the tsunami warning
    // from the map and from the watch and never be told.
    expect(alertType("Tsunami Warning")).toBe("tornado");
    expect(String(en["alertType.tornado"]).toLowerCase()).not.toBe("tornado");
    expect(String(es["alertType.tornado"]).toLowerCase()).not.toBe("tornado");
    // Nor after any one of the others it holds.
    for (const word of ["tsunami", "nuclear", "evacuation"]) {
      expect(String(en["alertType.tornado"]).toLowerCase()).not.toBe(word);
    }
  });

  it("never labels a switch with one hazard when it holds several", () => {
    // The general form of the same rule. A switch whose products all start
    // with the same word may be named for it; one that mixes hazards has to
    // carry a line saying what else is under it.
    for (const { id, key, detailKey } of ALERT_TYPES) {
      const products = covered(id);
      if (products.length < 2) continue;
      const label = String(en[key]).toLowerCase();
      const unnamed = products.filter(
        (product) => !label.includes(product.split(" ")[0].toLowerCase()),
      );
      if (!unnamed.length) continue;
      const detail = String(en[detailKey]).toLowerCase();
      expect(detail.length, `${id} says nothing about ${unnamed.join(", ")}`)
        .toBeGreaterThan(20);
    }
  });
});

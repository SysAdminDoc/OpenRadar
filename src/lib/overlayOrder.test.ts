import { describe, expect, it } from "vitest";
import {
  OVERLAY_DEPTH,
  PINNED_OVERLAYS,
  overlayBandOrder,
} from "./overlayOrder";
import { OVERLAY_ADAPTERS } from "./overlays";

const MOVABLE = OVERLAY_ADAPTERS.map((adapter) => adapter.id).filter(
  (id) => !PINNED_OVERLAYS.includes(id),
);

describe("the order the overlays are drawn in", () => {
  it("puts the warnings on top, whatever anybody arranged", () => {
    // Nothing may be put over somebody being told to take cover.
    for (const arrangement of [[], [...MOVABLE].reverse(), ["alerts"]]) {
      const order = overlayBandOrder(arrangement as string[]);
      expect(order[order.length - 1]).toBe("alerts");
      expect(order.filter((id) => id === "alerts")).toHaveLength(1);
    }
  });

  it("draws every layer exactly once, whatever it is handed", () => {
    for (const arrangement of [
      [],
      [...MOVABLE],
      [...MOVABLE].reverse(),
      ["metar", "metar", "nonsense", "spcOutlooks"],
    ]) {
      const order = overlayBandOrder(arrangement as string[]);
      expect(new Set(order).size).toBe(order.length);
      expect(new Set(order)).toEqual(new Set([...MOVABLE, ...PINNED_OVERLAYS]));
    }
  });

  it("opens at the depth each layer was designed for", () => {
    const order = overlayBandOrder([]);
    const depths = order
      .filter((id) => !PINNED_OVERLAYS.includes(id))
      .map((id) => OVERLAY_DEPTH[id]);
    expect(depths).toEqual([...depths].sort((left, right) => left - right));
  });

  it("puts a layer nobody has arranged at its own depth, not on top", () => {
    // The defect this replaces: anything missing from the reader's own
    // arrangement was appended, which meant a layer added in a later build
    // landed above every layer they had ever moved. A reader who had arranged
    // their overlays once got the next release's thirty-per-cent fill painted
    // over their station plots and their gauge dots.
    //
    // The arrangement below is what such a reader's settings file holds: the
    // layers that existed when they last touched the control, in the order
    // they left them, and nothing about the ones added since.
    const arranged = ["spcOutlooks", "stormReports", "metar", "riverGauges"];
    const order = overlayBandOrder(arranged);
    const at = (id: string) => order.indexOf(id as (typeof order)[number]);

    // The new outlooks were designed to sit with the SPC one, well under the
    // station plots and the gauges.
    expect(at("wpcExcessiveRain")).toBeLessThan(at("metar"));
    expect(at("wpcWinterSeverity")).toBeLessThan(at("metar"));
    expect(at("wpcExcessiveRain")).toBeLessThan(at("riverGauges"));
    // And the reader's own order is untouched among itself.
    const kept = order.filter((id) => arranged.includes(id));
    expect(kept).toEqual(arranged);
  });

  it("keeps the reader's own arrangement in the order they left it", () => {
    // Their choice, not the table's: a reader who put the fires over the
    // smoke meant it.
    const arranged = ["wildfires", "smoke", "earthquakes"];
    const order = overlayBandOrder(arranged);
    const seen = order.filter((id) => arranged.includes(id));
    expect(seen).toEqual(arranged);
  });
});

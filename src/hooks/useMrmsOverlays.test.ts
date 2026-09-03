import { describe, expect, it } from "vitest";
import { MRMS_LAYERS, productFor } from "./useMrmsOverlays";
import { GAUGE_QPE_PERIODS } from "../lib/gaugeQpe";
import { MRMS_PRODUCT_IDS } from "../lib/providers/mrms";

describe("which grid is behind a switch", () => {
  it("is the one the table names, for every ordinary layer", () => {
    for (const { layer, product } of MRMS_LAYERS) {
      if (layer === "gaugeQpe") continue;
      for (const period of GAUGE_QPE_PERIODS) {
        expect(productFor(layer, product, period)).toBe(product);
      }
    }
  });

  it("follows the period for the one switch that has one", () => {
    // Getting this wrong draws the right layer over the wrong number of
    // hours, which looks entirely normal: a day of rain labelled as an hour
    // of it is a flood that is not happening.
    const entry = MRMS_LAYERS.find(({ layer }) => layer === "gaugeQpe");
    expect(entry, "the gauge-corrected switch is in the table").toBeTruthy();
    const chosen = GAUGE_QPE_PERIODS.map((period) =>
      productFor("gaugeQpe", entry!.product, period),
    );
    expect(chosen).toEqual([
      "gauge-qpe-hour",
      "gauge-qpe-day",
      "gauge-qpe-three-day",
    ]);
    // Three windows, three grids, no repeats.
    expect(new Set(chosen).size).toBe(GAUGE_QPE_PERIODS.length);
  });

  it("names a grid the native side actually has, whichever way it is asked", () => {
    // The table and the period map are two lists of ids typed against the
    // same union, and a made-up id here reports a made-up observation time
    // rather than failing.
    for (const { layer, product } of MRMS_LAYERS) {
      for (const period of GAUGE_QPE_PERIODS) {
        expect(MRMS_PRODUCT_IDS).toContain(productFor(layer, product, period));
      }
    }
  });
});

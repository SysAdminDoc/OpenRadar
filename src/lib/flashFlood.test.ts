import { describe, expect, it } from "vitest";
import {
  CFS_PER_SQ_MI_PER_CMS_PER_SQ_KM,
  DEFAULT_FLOOD_THRESHOLDS,
  floodCall,
  floodWords,
  inPaperUnits,
  normalizeFloodThresholds,
  panelLevel,
  withFloodReadout,
  type FloodReading,
} from "./flashFlood";

/** A reading written in the paper's units, turned into the grids' own. */
function reading(
  qpeInches: number | null,
  ariYears: number | null,
  ratioPercent: number | null,
  streamflowCfs: number | null,
): FloodReading {
  return {
    qpeMm: qpeInches === null ? null : qpeInches * 25.4,
    ariYears,
    ratioPercent,
    streamflowCms:
      streamflowCfs === null
        ? null
        : streamflowCfs / CFS_PER_SQ_MI_PER_CMS_PER_SQ_KM,
  };
}

describe("the four-panel flash flood call", () => {
  it("keeps the paper's own bars", () => {
    // Table 2 of Technical Attachment 23-03, word for word.
    expect(DEFAULT_FLOOD_THRESHOLDS).toEqual({
      qpe: [1.5, 2.0, 2.5, 2.7],
      ari: [1, 5, 125, 175],
      ratio: [125, 140, 325, 375],
      streamflow: [200, 230, 850, 1100],
    });
  });

  it("calls the level when three of the four panels reach it", () => {
    // Two inches, a ten-year rain, 150 per cent of guidance: three panels at
    // warning. The fourth is quiet, which is what three of four allows.
    const call = floodCall(reading(2.1, 10, 150, 50));
    expect(call.levels).toEqual({ qpe: 2, ari: 2, ratio: 2, streamflow: 0 });
    expect(call.tier).toBe("warning");
  });

  it("calls nothing when only two agree", () => {
    const call = floodCall(reading(2.1, 10, 100, 50));
    expect(call.levels).toEqual({ qpe: 2, ari: 2, ratio: 0, streamflow: 0 });
    expect(call.tier).toBeNull();
  });

  it("calls the highest level three panels reach, not the highest one does", () => {
    // Catastrophic, catastrophic, considerable and advisory: three panels
    // are past the considerable bar, two past the catastrophic one.
    const call = floodCall(reading(2.8, 200, 330, 210));
    expect(call.levels).toEqual({ qpe: 4, ari: 4, ratio: 3, streamflow: 1 });
    expect(call.tier).toBe("considerable");
  });

  it("counts a panel that read nothing as nothing", () => {
    // Three panels at warning and one with no grid: still three.
    expect(floodCall(reading(2.1, 10, 150, null)).tier).toBe("warning");
    // Two at warning and one missing: two is not three.
    expect(floodCall(reading(2.1, 10, null, 50)).tier).toBeNull();
    expect(floodCall(reading(null, null, null, null)).tier).toBeNull();
  });

  it("reaches a bar at the bar, and not a hair under it", () => {
    const bars = [1, 5, 125, 175];
    expect(panelLevel(0.99, bars)).toBe(0);
    expect(panelLevel(1, bars)).toBe(1);
    expect(panelLevel(174.9, bars)).toBe(3);
    expect(panelLevel(175, bars)).toBe(4);
    expect(panelLevel(null, bars)).toBeNull();
    expect(panelLevel(Number.NaN, bars)).toBeNull();
  });

  it("reads the grids' metric units against the paper's", () => {
    // One cubic metre a second from a square kilometre is 91.5 cubic feet a
    // second from a square mile, so the grid's 2.2 is the paper's 200.
    expect(CFS_PER_SQ_MI_PER_CMS_PER_SQ_KM).toBeCloseTo(91.466, 2);
    const paper = inPaperUnits({
      qpeMm: 50.8,
      ariYears: 5,
      ratioPercent: 140,
      streamflowCms: 2.2,
    });
    expect(paper.qpe).toBeCloseTo(2, 6);
    expect(paper.streamflow).toBeCloseTo(201.2, 1);
  });

  it("uses the reader's own bars when they have set them", () => {
    const stricter = {
      ...DEFAULT_FLOOD_THRESHOLDS,
      qpe: [3, 4, 5, 6] as [number, number, number, number],
    };
    expect(floodCall(reading(2.1, 10, 150, 50)).tier).toBe("warning");
    expect(floodCall(reading(2.1, 10, 150, 50), stricter).tier).toBeNull();
  });
});

describe("the reader's own bars", () => {
  it("keeps a panel whose four bars climb", () => {
    const mine = normalizeFloodThresholds({
      qpe: [1, 1.5, 2, 3],
      ari: [2, 10, 100, 200],
    });
    expect(mine.qpe).toEqual([1, 1.5, 2, 3]);
    expect(mine.ari).toEqual([2, 10, 100, 200]);
    // A panel the file said nothing about keeps the paper's.
    expect(mine.ratio).toEqual(DEFAULT_FLOOD_THRESHOLDS.ratio);
  });

  it("puts back a whole panel whose bars stop climbing", () => {
    // Half kept would be a scale that is not one: a considerable bar under
    // the warning bar calls a level the rain has not reached.
    const mine = normalizeFloodThresholds({ ratio: [125, 300, 200, 375] });
    expect(mine.ratio).toEqual(DEFAULT_FLOOD_THRESHOLDS.ratio);
  });

  it("puts back a panel that is not four positive numbers", () => {
    for (const bad of [
      [1, 2, 3],
      [0, 5, 125, 175],
      [1, 5, Number.NaN, 175],
      [1, 5, "125", 175],
      "1,5,125,175",
      null,
    ]) {
      expect(normalizeFloodThresholds({ ari: bad }).ari, String(bad)).toEqual(
        DEFAULT_FLOOD_THRESHOLDS.ari,
      );
    }
    expect(normalizeFloodThresholds(undefined)).toEqual(
      DEFAULT_FLOOD_THRESHOLDS,
    );
  });

  it("hands back a copy, so an edit cannot reach the paper's", () => {
    const mine = normalizeFloodThresholds(null);
    mine.qpe[0] = 99;
    expect(DEFAULT_FLOOD_THRESHOLDS.qpe[0]).toBe(1.5);
  });
});

describe("the readout", () => {
  it("says each panel in the paper's units, and the call", () => {
    const said = floodWords(reading(2.1, 10, 150, 50));
    expect(said.panels).toBe(
      "2.10 in of rain in the past hour · A 10-year rain at worst · " +
        "150% of flash flood guidance · Runoff 50 ft³/s/mi²",
    );
    expect(said.call).toBe("Three of the four panels reach the warning level.");
  });

  it("says which panel had no grid, and that no level is called", () => {
    const said = floodWords(reading(null, 10, 150, 50));
    expect(said.panels.startsWith("Rain in an hour: no grid")).toBe(true);
    expect(said.call).toBe(
      "Fewer than three panels agree, so no level is called.",
    );
  });

  it("follows an inspect reading with the panels at its point", () => {
    const render = () => "41.6°, -93.6°";
    expect(withFloodReadout(render, null, DEFAULT_FLOOD_THRESHOLDS)).toBe(
      render,
    );
    expect(
      withFloodReadout(null, reading(2, 2, 2, 2), DEFAULT_FLOOD_THRESHOLDS),
    ).toBeNull();
    const both = withFloodReadout(
      render,
      reading(2.1, 10, 150, 50),
      DEFAULT_FLOOD_THRESHOLDS,
    );
    expect(both?.()).toMatch(/^41\.6°, -93\.6° · Flash flood panels: 2\.10 in/);
    expect(both?.()).toContain("warning level");
  });
});

import { describe, expect, it } from "vitest";
import {
  BARB_MAX_KNOTS,
  PLOT_SCALE,
  PLOT_SIZE,
  SKY_FILL,
  barbId,
  barbImage,
  barbParts,
  skyImage,
  stationPlotImages,
} from "./stationPlot";

/** How many pixels the icon actually inked, which is its whole content. */
function inked(data: Uint8Array): number {
  let count = 0;
  for (let at = 3; at < data.length; at += 4) if (data[at] > 0) count += 1;
  return count;
}

describe("counting the feathers", () => {
  it("reads the conventional speeds off a barb", () => {
    expect(barbParts(5)).toEqual({ pennants: 0, full: 0, half: 1 });
    expect(barbParts(10)).toEqual({ pennants: 0, full: 1, half: 0 });
    expect(barbParts(25)).toEqual({ pennants: 0, full: 2, half: 1 });
    expect(barbParts(50)).toEqual({ pennants: 1, full: 0, half: 0 });
    expect(barbParts(75)).toEqual({ pennants: 1, full: 2, half: 1 });
    expect(barbParts(100)).toEqual({ pennants: 2, full: 0, half: 0 });
  });

  it("rounds to the nearest five, which is how a barb is read", () => {
    // 12 kt is drawn as 10, not as 10 with something left over.
    expect(barbParts(12)).toEqual({ pennants: 0, full: 1, half: 0 });
    expect(barbParts(13)).toEqual({ pennants: 0, full: 1, half: 1 });
    expect(barbParts(2)).toEqual({ pennants: 0, full: 0, half: 0 });
    expect(barbParts(3)).toEqual({ pennants: 0, full: 0, half: 1 });
  });

  it("treats a missing or impossible speed as calm rather than throwing", () => {
    expect(barbParts(0)).toEqual({ pennants: 0, full: 0, half: 0 });
    expect(barbParts(-8)).toEqual({ pennants: 0, full: 0, half: 0 });
  });

  it("adds up to the speed it was given", () => {
    for (let knots = 0; knots <= 120; knots += 1) {
      const { pennants, full, half } = barbParts(knots);
      expect(pennants * 50 + full * 10 + half * 5).toBe(
        Math.round(knots / 5) * 5,
      );
    }
  });
});

describe("the images the map places", () => {
  /**
   * How many separate marks cross the staff, counted a little way out from it.
   *
   * Ink alone will not do: a pennant is deliberately more compact than the
   * five feathers it replaces, so sixty-five knots inks less than thirty-five
   * and that is the convention working rather than a fault. What has to hold
   * is that the picture carries exactly the marks the arithmetic asked for.
   */
  function feathers(image: { data: Uint8Array; width: number }): number {
    const middle = (PLOT_SIZE / 2) * PLOT_SCALE;
    const column = middle + 3 * PLOT_SCALE;
    let marks = 0;
    let inMark = false;
    for (let row = 0; row < image.width; row += 1) {
      const lit = image.data[(row * image.width + column) * 4 + 3] > 0;
      if (lit && !inMark) marks += 1;
      inMark = lit;
    }
    return marks;
  }

  it("draws exactly the marks the speed asks for", () => {
    for (let knots = 5; knots <= BARB_MAX_KNOTS; knots += 5) {
      const { pennants, full, half } = barbParts(knots);
      expect(feathers(barbImage(knots)), `${knots} kt`).toBe(
        pennants + full + half,
      );
    }
  });

  it("draws calm as a ring with no staff", () => {
    // Deliberately not the lightest barb with the feathers left off: calm is
    // its own symbol, and it inks more than five knots does because the ring
    // is wider than a staff is long. The test that matters is that nothing is
    // drawn above the ring, where a staff would be.
    const image = barbImage(0);
    const size = image.width;
    const middle = (PLOT_SIZE / 2) * PLOT_SCALE;
    let aboveTheRing = 0;
    for (let row = 0; row < middle - 10 * PLOT_SCALE; row += 1) {
      aboveTheRing += image.data[(row * size + middle) * 4 + 3] > 0 ? 1 : 0;
    }
    expect(aboveTheRing).toBe(0);
    // And five knots does put something there.
    const light = barbImage(5);
    let staff = 0;
    for (let row = 0; row < middle - 10 * PLOT_SCALE; row += 1) {
      staff += light.data[(row * size + middle) * 4 + 3] > 0 ? 1 : 0;
    }
    expect(staff).toBeGreaterThan(0);
  });

  it("names one icon per five knots and stops growing past the cap", () => {
    expect(barbId(12)).toBe("station-barb-10");
    expect(barbId(13)).toBe("station-barb-15");
    expect(barbId(999)).toBe(`station-barb-${BARB_MAX_KNOTS}`);
    // Every name a station can produce is one the set actually contains.
    const names = new Set(stationPlotImages().map((image) => image.id));
    for (let knots = 0; knots <= 200; knots += 1) {
      expect(names.has(barbId(knots))).toBe(true);
    }
  });

  it("fills the sky disc by how much sky is covered", () => {
    const counts = ["SKC", "FEW", "SCT", "BKN", "OVC"].map((cover) =>
      inked(skyImage(cover).data),
    );
    for (let at = 1; at < counts.length; at += 1) {
      expect(counts[at]).toBeGreaterThan(counts[at - 1]);
    }
    // A code nobody has heard of draws the empty ring rather than nothing at
    // all, so a station with an odd report is still on the map.
    expect(inked(skyImage("WHAT").data)).toBe(inked(skyImage("SKC").data));
  });

  it("writes a whole buffer of the size it declares", () => {
    for (const image of stationPlotImages()) {
      expect(image.width).toBe(PLOT_SIZE * PLOT_SCALE);
      expect(image.height).toBe(PLOT_SIZE * PLOT_SCALE);
      expect(image.data.length).toBe(image.width * image.height * 4);
      // White throughout, so the map's own halo is what separates it from
      // whatever it is drawn over.
      for (let at = 0; at < image.data.length; at += 4) {
        if (image.data[at + 3] === 0) continue;
        expect(image.data[at]).toBe(255);
        expect(image.data[at + 1]).toBe(255);
        expect(image.data[at + 2]).toBe(255);
      }
    }
  });

  it("keeps the barb inside its box at the fastest speed it draws", () => {
    const image = barbImage(BARB_MAX_KNOTS);
    const size = image.width;
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const alpha = image.data[(row * size + column) * 4 + 3];
        if (alpha === 0) continue;
        expect(row).toBeGreaterThan(0);
        expect(column).toBeGreaterThan(0);
        expect(row).toBeLessThan(size - 1);
        expect(column).toBeLessThan(size - 1);
      }
    }
  });

  it("builds one image per speed and per coverage code, and no duplicates", () => {
    const images = stationPlotImages();
    const names = images.map((image) => image.id);
    expect(new Set(names).size).toBe(names.length);
    expect(
      names.filter((name) => name.startsWith("station-barb-")),
    ).toHaveLength(BARB_MAX_KNOTS / 5 + 1);
    expect(
      names.filter((name) => name.startsWith("station-sky-")),
    ).toHaveLength(Object.keys(SKY_FILL).length);
  });
});

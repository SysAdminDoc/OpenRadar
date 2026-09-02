import { describe, expect, it } from "vitest";
import { rangeFill } from "./rangeFill";

const share = (value: number, min: number, max: number) =>
  (rangeFill(value, min, max) as Record<string, string>)["--range-fill"];

describe("rangeFill", () => {
  it("gives the share of the track the handle has passed", () => {
    expect(share(0, 0, 10)).toBe("0.00%");
    expect(share(5, 0, 10)).toBe("50.00%");
    expect(share(10, 0, 10)).toBe("100.00%");
  });

  it("counts from the bottom of the range rather than from zero", () => {
    // The reflectivity sliders start at 0.05 and the pack ceiling at 256, and
    // treating the value as a share of the maximum would paint the handle at
    // five percent while it sits at the very bottom of the track.
    expect(share(0.05, 0.05, 1)).toBe("0.00%");
    expect(share(256, 256, 32_768)).toBe("0.00%");
  });

  it("stays on the track when the value is outside the range", () => {
    // A saved setting can outlive the range it was chosen in: a threshold of
    // 70 kept from the mosaic slider lands on a product whose scale stops at
    // 8, and a negative frame index is the empty timeline's own value.
    expect(share(70, 0, 8)).toBe("100.00%");
    expect(share(-1, 0, 10)).toBe("0.00%");
  });

  it("paints nothing when there is no range to paint", () => {
    // An empty or single-frame timeline: max and min are both zero, and the
    // division would otherwise be NaN reaching the stylesheet as a length.
    expect(share(0, 0, 0)).toBe("0.00%");
    expect(share(3, 5, 5)).toBe("0.00%");
  });
});

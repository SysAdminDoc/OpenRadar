import { describe, expect, it } from "vitest";
import { formatDistance, haversineMiles } from "./geo";

describe("map measurements", () => {
  it("calculates a great-circle range", () => {
    const miles = haversineMiles(
      { lat: 40.7128, lon: -74.006 },
      { lat: 34.0522, lon: -118.2437 },
    );
    expect(miles).toBeGreaterThan(2440);
    expect(miles).toBeLessThan(2460);
  });

  it("formats feet, decimal miles, and whole miles", () => {
    expect(formatDistance(0.05)).toMatch(/ft$/);
    expect(formatDistance(4.25)).toBe("4.3 mi");
    expect(formatDistance(42.4)).toBe("42 mi");
  });
});

import { describe, expect, it } from "vitest";
import { windLabel, type WindField } from "./wind";
import { seedParticles } from "./windLayer";

const field: WindField = {
  columns: 720,
  rows: 361,
  north: 90,
  west: 0,
  dLat: 0.5,
  dLon: 0.5,
  minU: -30.2,
  maxU: 24.6,
  minV: -27.4,
  maxV: 29.3,
  init: "2026-08-30T06:00:00+00:00",
  leadHours: 0,
  image: "data:image/png;base64,AAAA",
};

describe("the wind banner", () => {
  it("names the run and how old it is", () => {
    const now = Date.parse("2026-08-30T12:30:00Z");
    expect(windLabel(field, now)).toBe("GFS 06Z · 6 h old");
  });

  it("says which forecast hour a lead time is", () => {
    const now = Date.parse("2026-08-30T09:00:00Z");
    expect(windLabel({ ...field, leadHours: 3 }, now)).toBe(
      "GFS 06Z +3 h · 3 h old",
    );
  });

  it("does not report a negative age when the clock is behind", () => {
    const before = Date.parse("2026-08-30T05:00:00Z");
    expect(windLabel(field, before)).toBe("GFS 06Z · 0 h old");
  });

  it("says so rather than lying when the run has no time", () => {
    expect(windLabel({ ...field, init: "nonsense" }, Date.now())).toContain(
      "unknown",
    );
  });
});

describe("seeding the particles", () => {
  it("gives every particle a position, encoded in four bytes", () => {
    const state = seedParticles(4, () => 0.5);
    expect(state).toHaveLength(16);
    // Two bytes an axis: the coarse byte and the fine one.
    for (let at = 0; at < 4; at += 1) {
      const x = state[at * 4] / 255 / 255 + state[at * 4 + 2] / 255;
      expect(x).toBeGreaterThan(0.4);
      expect(x).toBeLessThan(0.6);
    }
  });

  it("spreads them rather than stacking them", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const state = seedParticles(2048, random);
    const places = new Set<string>();
    for (let at = 0; at < 2048; at += 1) {
      places.add(`${state[at * 4 + 2]},${state[at * 4 + 3]}`);
    }
    // A thousand distinct coarse cells out of two thousand particles is a
    // spread; a broken seed puts them all on a handful.
    expect(places.size).toBeGreaterThan(1000);
  });
});

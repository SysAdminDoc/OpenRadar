import { describe, expect, it } from "vitest";
import { haversineMiles } from "./geo";
import { ringAround, watchRingFeatures } from "./ring";

describe("the ring a watched place is judged inside", () => {
  it("puts every point at the radius, at every latitude", () => {
    // The rules measure with `haversineMiles`, so the ring drawn has to be
    // the same measurement. A circle drawn by adding degrees is a circle on
    // the screen and the wrong shape on the ground: at sixty degrees north it
    // is twice as wide as it is tall, and the storms it shows inside the
    // radius are not the ones the rules count.
    for (const lat of [0, 25.8, 41.6, 60.2, 71]) {
      for (const radiusMiles of [1, 10, 30, 120]) {
        const center = { lat, lon: -93.6 };
        const ring = ringAround(center, radiusMiles);
        for (const [lon, pointLat] of ring) {
          expect(
            haversineMiles(center, { lat: pointLat, lon }),
            `${radiusMiles} miles at ${lat} degrees`,
          ).toBeCloseTo(radiusMiles, 6);
        }
      }
    }
  });

  it("closes", () => {
    // A polygon whose ends do not meet is not one, and readers disagree about
    // whether to close it for you or draw the gap.
    const ring = ringAround({ lat: 41.6, lon: -93.6 }, 30);
    expect(ring.length).toBeGreaterThan(24);
    expect(ring.at(0)).toEqual(ring.at(-1));
  });

  it("crosses the date line rather than jumping the world", () => {
    // Every point stays in the range the map draws in. Left unwrapped, a ring
    // around Semisopochnoi, which is American and sits at 179.6 east, reached
    // past 180 and drew as a line back across the whole northern hemisphere.
    const ring = ringAround({ lat: 51.95, lon: 179.6 }, 120);
    for (const [lon] of ring) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
    // And it really does cross: the ring holds points on both sides.
    expect(ring.some(([lon]) => lon > 179)).toBe(true);
    expect(ring.some(([lon]) => lon < -177)).toBe(true);
  });

  it("draws nothing wider than nothing for a radius of nothing", () => {
    const ring = ringAround({ lat: 41.6, lon: -93.6 }, 0);
    for (const [lon, lat] of ring) {
      expect(lon).toBeCloseTo(-93.6, 9);
      expect(lat).toBeCloseTo(41.6, 9);
    }
  });
});

describe("the rings the map is given", () => {
  const places = [
    {
      id: "home",
      name: "Home",
      center: [-93.6, 41.6] as [number, number],
      radiusMiles: 30,
      minSeverity: "severe" as const,
      sound: false,
      quietHours: { enabled: false, from: 22, to: 7, severe: true },
    },
    {
      id: "school",
      name: "School",
      center: [-96.8, 32.78] as [number, number],
      radiusMiles: 10,
      minSeverity: "severe" as const,
      sound: false,
      quietHours: { enabled: false, from: 22, to: 7, severe: true },
    },
  ];

  it("labels each place once, with its own radius", () => {
    // Once per place rather than repeated around the circle: the distance is
    // one fact about it. And each place's own radius, because two watched
    // places rarely use the same one, which is the whole reason a reader
    // cannot tell which storms are inside which circle.
    const drawn = watchRingFeatures(places) as {
      features: Array<{
        properties: { kind: string; label?: string };
        geometry: { type: string; coordinates: unknown };
      }>;
    };
    const labels = drawn.features.filter(
      (feature) => feature.properties.kind === "label",
    );
    expect(labels).toHaveLength(2);
    expect(labels.map((one) => one.properties.label)).toEqual([
      "30 mi",
      "10 mi",
    ]);
    expect(labels.every((one) => one.geometry.type === "Point")).toBe(true);
    const rings = drawn.features.filter(
      (feature) => feature.properties.kind === "ring",
    );
    expect(rings).toHaveLength(2);
    expect(rings.every((one) => one.geometry.type === "LineString")).toBe(true);
  });

  it("draws each ring at its own radius", () => {
    const drawn = watchRingFeatures(places) as {
      features: Array<{
        properties: { kind: string };
        geometry: { coordinates: Array<[number, number]> };
      }>;
    };
    const rings = drawn.features.filter(
      (feature) => feature.properties.kind === "ring",
    );
    for (const [at, place] of places.entries()) {
      const center = { lon: place.center[0], lat: place.center[1] };
      for (const [lon, lat] of rings[at].geometry.coordinates) {
        expect(haversineMiles(center, { lat, lon })).toBeCloseTo(
          place.radiusMiles,
          6,
        );
      }
    }
  });
});

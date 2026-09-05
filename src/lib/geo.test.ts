import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

describe("one helper, not several", () => {
  /** Every TypeScript file under src, tests included. */
  function sources(from: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(from)) {
      const path = join(from, entry);
      if (statSync(path).isDirectory()) {
        found.push(...sources(path));
        continue;
      }
      // Tests left out: a copy in one is not a copy that ships, and this
      // file has to name each helper in order to count it.
      if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
        found.push(path);
      }
    }
    return found;
  }

  const files = sources(join(import.meta.dirname, ".."));
  const all = files.map((path) => readFileSync(path, "utf8")).join("\n");

  it("defines the bearing and the ArcGIS read once each", () => {
    // `cells.ts` and `nearby.ts` held the same great-circle bearing in two
    // spellings, and `spc.ts` and `wpc.ts` held the same ArcGIS read byte for
    // byte but for the catalogue key it throws with. Neither pair had drifted
    // yet. The pair beside them had: this file and `sounding.ts` were holding
    // two different Earth radii.
    const bearings = [...all.matchAll(/function bearingDegrees\b/g)];
    expect(bearings).toHaveLength(1);
    const readers = [...all.matchAll(/function arcgisQuery\b/g)];
    expect(readers).toHaveLength(1);
  });

  it("writes the mile in kilometres down once", () => {
    // Five copies of 1.609344, one of them a bare literal inside a component.
    const named = files.filter((path) => path.endsWith("units.ts"));
    expect(named).toHaveLength(1);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      if (path.endsWith("units.ts")) continue;
      expect(source, path).not.toContain("1.609344");
    }
  });

  it("subscribes to a media query in one place", () => {
    // Three copies, and the first of the three had no `matchMedia` guard
    // while the two written later did, which is the shape a duplicated
    // helper drifts into.
    const watchers = [
      ...all.matchAll(/\.addEventListener\("change", listener\)/g),
    ];
    expect(watchers).toHaveLength(1);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a map lane may read while it is being built.
 *
 * A lane hands `syncVectorLane` a `layers()` function, and that function is
 * called when the lane is added to the map. After the reader changes the
 * basemap, MapLibre drops every source, and the lanes are put back from the
 * `style.load` handler that was registered when the map was made. That
 * handler holds the first render's props for the life of the map.
 *
 * So a lane that reads the `mapStyle` prop is dressed for whichever basemap
 * the app started on. Two lanes did: the county lines and the ring round a
 * watched place both chose their colour from `isLightBasemap(mapStyle)`, and
 * choosing Light left both in their dark-basemap colours until restart. The
 * fix is a ref, written before `setStyle` is called.
 *
 * Held here because it cannot be seen from inside a lane: the code reads
 * correctly, and the value is a render old.
 */
const source = readFileSync(
  join(import.meta.dirname, "MapViewport.tsx"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
  .replace(/\/\/.*/g, "");

/** A colour spelled out, in any of the lengths CSS takes. */
const HEX = /#[0-9a-f]{3,8}/i;

describe("which basemap a lane thinks it is drawing over", () => {
  it("is asked of the prop once, where the ref is written", () => {
    // Twice, and neither is a lane: the ref's initial value, read during
    // the render that makes the map and right by construction, and the
    // assignment that keeps it so. Anything else is a lane reading a prop
    // through a closure that will not see it change.
    const calls = source.match(/isLightBasemap\([^)]*\)/g) ?? [];
    expect(calls).toEqual([
      "isLightBasemap(mapStyle)",
      "isLightBasemap(mapStyle)",
    ]);
    const writes = source.match(/overLightRef\.current = [^;]+;/g) ?? [];
    expect(writes).toEqual([
      "overLightRef.current = isLightBasemap(mapStyle);",
    ]);
    expect(source).toContain("useRef(isLightBasemap(mapStyle))");
  });

  it("names no colour of its own inside the storm cell lane", () => {
    // The lane this item was written about. Its ring, its dashed track, its
    // forecast dots and its name were four near-whites written out where
    // they were used, chosen against the dark basemap, and over the light
    // one they composited to about the ground's own lightness. Each is a
    // small mark that cannot carry a casing under it, so each takes the
    // lightness the ground is not.
    const at = source.indexOf("const CELL_LANE");
    expect(at, "CELL_LANE is no longer in MapViewport.tsx").toBeGreaterThan(-1);
    const lane = source.slice(at, source.indexOf("const syncCells", at));
    expect(lane.length).toBeGreaterThan(500);
    expect(lane).toContain('"line-color": ink');
    expect(lane).toContain('"circle-color": ink');
    expect(lane).toContain('"text-color": ink');
    // A storm with rotation in it is the one to look at first, so its ring
    // is the one mark here that must not be missed.
    expect(lane).toContain("rotating,");
    // And nothing in it spells a colour out. A hex here is a mark that has
    // gone back to being right on one basemap.
    expect(lane).not.toMatch(HEX);
  });
});

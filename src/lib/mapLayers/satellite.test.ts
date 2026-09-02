import { describe, expect, it } from "vitest";
import { satelliteLane, syncSatelliteLane } from "./satellite";
import type { MapLike } from "./raster";

const LAYER = "openradar-satellite-layer";
const SOURCE = "openradar-satellite-source";
const TIME = Date.parse("2026-08-30T07:20:00Z") / 1000;

/** A map that remembers what it was told, the way the raster tests use one. */
function fakeMap() {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, Record<string, unknown>>();
  const tiles = new Map<string, string[]>();
  const calls: string[] = [];
  const map: MapLike & {
    sources: typeof sources;
    layers: typeof layers;
    tiles: typeof tiles;
    calls: string[];
  } = {
    sources,
    layers,
    tiles,
    calls,
    getSource: (id) => {
      const held = sources.get(id);
      if (!held) return undefined;
      return {
        tiles: tiles.get(id),
        setTiles: (next: string[]) => {
          calls.push(`setTiles ${id}`);
          tiles.set(id, next);
        },
      };
    },
    addSource: ((id: string, source: Record<string, unknown>) => {
      calls.push(`addSource ${id}`);
      sources.set(id, source);
      tiles.set(id, source.tiles as string[]);
    }) as MapLike["addSource"],
    removeSource: (id) => {
      calls.push(`removeSource ${id}`);
      sources.delete(id);
      tiles.delete(id);
    },
    getLayer: (id) => layers.get(id),
    addLayer: ((layer: Record<string, unknown>) => {
      calls.push(`addLayer ${String(layer.id)}`);
      layers.set(String(layer.id), layer);
    }) as MapLike["addLayer"],
    removeLayer: (id) => {
      calls.push(`removeLayer ${id}`);
      layers.delete(id);
    },
  };
  return map;
}

describe("the satellite lane", () => {
  it("carries each product's own reach", () => {
    // Band 13 is published one zoom shallower than GeoColor. A source built
    // for the deeper one would ask for tiles the shallower one does not have.
    expect(satelliteLane("geocolor", LAYER).maxZoom).toBe(7);
    expect(satelliteLane("clean-ir", LAYER).maxZoom).toBe(6);
    expect(satelliteLane("clean-ir", LAYER).sourceId).toBe(
      satelliteLane("geocolor", LAYER).sourceId,
    );
  });

  it("re-points the source for a new time and rebuilds it for a new product", () => {
    const map = fakeMap();
    const under = () => undefined;

    let drawn = syncSatelliteLane(
      map,
      LAYER,
      "geocolor",
      "geocolor",
      TIME,
      under,
    );
    expect(drawn.drawn).toBe("geocolor");
    expect(drawn.changed).toBe(true);
    expect(map.sources.get(SOURCE)?.maxzoom).toBe(7);
    expect(String(map.tiles.get(SOURCE)?.[0])).toContain("GeoColor");

    // A later slot of the same product is the same source pointed elsewhere,
    // which keeps whatever the reader has above it from blinking.
    map.calls.length = 0;
    drawn = syncSatelliteLane(
      map,
      LAYER,
      drawn.drawn,
      "geocolor",
      TIME + 600,
      under,
    );
    expect(map.calls).toEqual([`setTiles ${SOURCE}`]);
    expect(drawn.changed).toBe(false);

    // The other product is a new source, because a raster source carries its
    // maximum zoom from the moment it is added. Re-pointing instead would
    // leave the map asking GIBS for a zoom 7 infrared tile, and every one of
    // those comes back 400 and paints nothing.
    map.calls.length = 0;
    drawn = syncSatelliteLane(
      map,
      LAYER,
      drawn.drawn,
      "clean-ir",
      TIME + 600,
      under,
    );
    expect(drawn.drawn).toBe("clean-ir");
    expect(map.calls).toContain(`removeSource ${SOURCE}`);
    expect(map.calls).toContain(`addSource ${SOURCE}`);
    expect(map.sources.get(SOURCE)?.maxzoom).toBe(6);
    expect(String(map.tiles.get(SOURCE)?.[0])).toContain(
      "Band13_Clean_Infrared",
    );
    expect(String(map.tiles.get(SOURCE)?.[0])).toContain(
      "GoogleMapsCompatible_Level6",
    );
  });

  it("takes the layer off when there is no image to draw", () => {
    const map = fakeMap();
    const under = () => undefined;
    syncSatelliteLane(map, LAYER, "geocolor", "geocolor", TIME, under);
    const off = syncSatelliteLane(
      map,
      LAYER,
      "geocolor",
      "geocolor",
      null,
      under,
    );
    expect(off.changed).toBe(true);
    expect(map.sources.has(SOURCE)).toBe(false);
    expect(map.layers.has(LAYER)).toBe(false);
  });
});

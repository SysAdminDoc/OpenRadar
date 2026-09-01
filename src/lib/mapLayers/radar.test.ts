import { describe, expect, it } from "vitest";
import { syncRadarLane, type RadarTiles } from "./radar";
import type { MapLike } from "./raster";

/** A map that remembers its sources, its layers and what they are painted. */
function fakeMap() {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, Record<string, unknown>>();
  const tiles = new Map<string, string[]>();
  const paint = new Map<string, unknown>();
  const calls: string[] = [];
  const map = {
    sources,
    layers,
    tiles,
    paint,
    calls,
    getSource: (id: string) => {
      if (!sources.has(id)) return undefined;
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
    removeSource: (id: string) => {
      calls.push(`removeSource ${id}`);
      sources.delete(id);
      tiles.delete(id);
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: ((layer: Record<string, unknown>, before?: string) => {
      calls.push(`addLayer ${String(layer.id)} before ${before ?? "top"}`);
      layers.set(String(layer.id), layer);
    }) as MapLike["addLayer"],
    removeLayer: (id: string) => {
      calls.push(`removeLayer ${id}`);
      layers.delete(id);
    },
    setPaintProperty: ((id: string, property: string, value: unknown) => {
      paint.set(`${id}.${property}`, value);
    }) as never,
  };
  return map;
}

const PLAN = { sourceId: "radar-observed", layerId: "radar-layer-observed" };

const frame = (overrides: Partial<RadarTiles> = {}): RadarTiles => ({
  tileUrl: "https://tiles.test/1/{z}/{x}/{y}.png",
  tileSize: 256,
  maxZoom: 8,
  attribution: "A service",
  key: "ridge:256:8",
  ...overrides,
});

const under = () => "openradar-overlay-alerts-fill";

describe("a radar lane", () => {
  it("arrives at nothing and is faded up, never the other way round", () => {
    // Added at zero and then told, so a lane never shows for one frame at
    // full before the opacity it should have been drawn at arrives.
    const map = fakeMap();
    const result = syncRadarLane(map, PLAN, frame(), 0.7, null, under);
    expect(result.added).toBe(true);
    expect(map.layers.get(PLAN.layerId)).toMatchObject({
      paint: { "raster-opacity": 0 },
    });
    expect(map.paint.get(`${PLAN.layerId}.raster-opacity`)).toBe(0.7);
    expect(result.key).toBe("ridge:256:8");
  });

  it("is faded out rather than taken off when the other lane has the frame", () => {
    // The whole reason this is not an ordinary raster lane. A reader scrubbing
    // a loop crosses between observed and forecast repeatedly, and removing
    // the source each time would refetch every tile of both.
    const map = fakeMap();
    syncRadarLane(map, PLAN, frame(), 0.7, null, under);
    map.calls.length = 0;

    const result = syncRadarLane(map, PLAN, null, 0.7, "ridge:256:8", under);
    expect(result.opacity).toBe(0);
    expect(map.calls).toEqual([]);
    expect(map.sources.has(PLAN.sourceId)).toBe(true);
    expect(map.layers.has(PLAN.layerId)).toBe(true);
    expect(map.paint.get(`${PLAN.layerId}.raster-opacity`)).toBe(0);
  });

  it("re-points for a new time and rebuilds for a new provider", () => {
    const map = fakeMap();
    const first = syncRadarLane(map, PLAN, frame(), 0.7, null, under);
    map.calls.length = 0;

    // Same provider, next frame: the same source pointed at another address.
    const next = syncRadarLane(
      map,
      PLAN,
      frame({ tileUrl: "https://tiles.test/2/{z}/{x}/{y}.png" }),
      0.7,
      first.key,
      under,
    );
    expect(map.calls).toEqual(["setTiles radar-observed"]);
    expect(next.added).toBe(false);
    map.calls.length = 0;

    // A different provider brings a different tile size and credit, and those
    // belong to the source rather than to the address.
    const swapped = syncRadarLane(
      map,
      PLAN,
      frame({ key: "rainviewer:512:10", tileSize: 512, maxZoom: 10 }),
      0.7,
      next.key,
      under,
    );
    expect(map.calls).toEqual([
      "removeLayer radar-layer-observed",
      "removeSource radar-observed",
      "addSource radar-observed",
      "addLayer radar-layer-observed before openradar-overlay-alerts-fill",
    ]);
    expect(swapped.added).toBe(true);
    expect(map.sources.get(PLAN.sourceId)).toMatchObject({
      tileSize: 512,
      maxzoom: 10,
    });
  });

  it("hands the map to a single site's sweep without taking anything down", () => {
    // The caller passes zero while a sweep owns the picture. The mosaic stays
    // loaded so that leaving the single site is instant.
    const map = fakeMap();
    const held = syncRadarLane(map, PLAN, frame(), 0.7, null, under);
    const hidden = syncRadarLane(map, PLAN, frame(), 0, held.key, under);
    expect(hidden.opacity).toBe(0);
    expect(map.sources.has(PLAN.sourceId)).toBe(true);
  });

  it("does nothing for a lane that has never had a frame", () => {
    const map = fakeMap();
    const result = syncRadarLane(map, PLAN, null, 0.7, null, under);
    expect(result).toEqual({ added: false, opacity: 0, key: null });
    expect(map.calls).toEqual([]);
  });

  it("always says how opaque the lane ended up", () => {
    // The caller reports this beside the map, so a wrong answer here is a
    // wrong number on the screen rather than a wrong picture.
    const map = fakeMap();
    expect(syncRadarLane(map, PLAN, frame(), 0.55, null, under).opacity).toBe(
      0.55,
    );
    expect(
      syncRadarLane(map, PLAN, null, 0.55, "ridge:256:8", under).opacity,
    ).toBe(0);
  });
});

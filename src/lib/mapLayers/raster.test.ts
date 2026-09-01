import { describe, expect, it } from "vitest";
import { syncRasterLane, type MapLike, type RasterLane } from "./raster";

/**
 * A map that remembers what it was told.
 *
 * Small on purpose. What is worth holding about a layer's lifecycle is the
 * order of the calls and what survives them, and a real MapLibre instance
 * needs a canvas and a GPU to answer any of that.
 */
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
    addLayer: ((layer: Record<string, unknown>, before?: string) => {
      calls.push(`addLayer ${String(layer.id)} before ${before ?? "top"}`);
      layers.set(String(layer.id), layer);
    }) as MapLike["addLayer"],
    removeLayer: (id) => {
      calls.push(`removeLayer ${id}`);
      layers.delete(id);
    },
  };
  return map;
}

const LANE: RasterLane<number> = {
  sourceId: "test-source",
  layerId: "test-layer",
  attribution: "A service",
  opacity: 0.85,
  maxZoom: 8,
  tileUrl: (time) => `https://tiles.test/${time}/{z}/{x}/{y}.png`,
};

const under = () => "openradar-radar-layer-observed";

describe("one raster lane's whole life", () => {
  it("adds the source and the layer, under whatever it belongs under", () => {
    const map = fakeMap();
    expect(syncRasterLane(map, LANE, 100, under)).toBe(true);
    expect(map.calls).toEqual([
      "addSource test-source",
      "addLayer test-layer before openradar-radar-layer-observed",
    ]);
    expect(map.sources.get("test-source")).toMatchObject({
      type: "raster",
      tileSize: 256,
      maxzoom: 8,
      attribution: "A service",
    });
    expect(map.layers.get("test-layer")).toMatchObject({
      type: "raster",
      source: "test-source",
      paint: { "raster-opacity": 0.85 },
    });
  });

  it("leaves out a maximum zoom the lane does not have", () => {
    const map = fakeMap();
    const noZoom: RasterLane<number> = { ...LANE };
    delete noZoom.maxZoom;
    syncRasterLane(map, noZoom, 100, under);
    expect(map.sources.get("test-source")).not.toHaveProperty("maxzoom");
  });

  it("re-points the source rather than rebuilding it", () => {
    // Rebuilding flashes the map through empty and loses whatever the reader
    // arranged above it, for what is the same lane pointed somewhere else.
    const map = fakeMap();
    syncRasterLane(map, LANE, 100, under);
    map.calls.length = 0;

    expect(syncRasterLane(map, LANE, 200, under)).toBe(false);
    expect(map.calls).toEqual(["setTiles test-source"]);
    expect(map.tiles.get("test-source")).toEqual([
      "https://tiles.test/200/{z}/{x}/{y}.png",
    ]);
  });

  it("takes the source away with the layer when it is switched off", () => {
    // Leaving the source behind means the old tiles are still there the next
    // time the layer comes on.
    const map = fakeMap();
    syncRasterLane(map, LANE, 100, under);
    map.calls.length = 0;

    expect(syncRasterLane(map, LANE, null, under)).toBe(true);
    expect(map.calls).toEqual([
      "removeLayer test-layer",
      "removeSource test-source",
    ]);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it("does nothing at all for a lane that was never on", () => {
    const map = fakeMap();
    expect(syncRasterLane(map, LANE, null, under)).toBe(false);
    expect(syncRasterLane(map, LANE, undefined, under)).toBe(false);
    expect(map.calls).toEqual([]);
  });

  it("comes back after being switched off, in the right place", () => {
    const map = fakeMap();
    syncRasterLane(map, LANE, 100, under);
    syncRasterLane(map, LANE, null, under);
    map.calls.length = 0;

    expect(syncRasterLane(map, LANE, 300, under)).toBe(true);
    expect(map.calls).toEqual([
      "addSource test-source",
      "addLayer test-layer before openradar-radar-layer-observed",
    ]);
    expect(map.tiles.get("test-source")).toEqual([
      "https://tiles.test/300/{z}/{x}/{y}.png",
    ]);
  });

  it("only says the stack changed when it actually did", () => {
    // The caller republishes the layer list on a true, and that list is read
    // by the panel and by every browser test.
    const map = fakeMap();
    expect(syncRasterLane(map, LANE, 1, under)).toBe(true);
    expect(syncRasterLane(map, LANE, 2, under)).toBe(false);
    expect(syncRasterLane(map, LANE, 2, under)).toBe(false);
    expect(syncRasterLane(map, LANE, null, under)).toBe(true);
    expect(syncRasterLane(map, LANE, null, under)).toBe(false);
  });

  it("places the lane at the top when nothing is above it yet", () => {
    const map = fakeMap();
    syncRasterLane(map, LANE, 1, () => undefined);
    expect(map.calls).toContain("addLayer test-layer before top");
  });

  it("survives a source that cannot re-point itself", () => {
    // A source that has lost `setTiles` between MapLibre versions must not
    // take the layer down with it.
    const map = fakeMap();
    syncRasterLane(map, LANE, 1, under);
    map.getSource = () => ({});
    expect(() => syncRasterLane(map, LANE, 2, under)).not.toThrow();
  });
});

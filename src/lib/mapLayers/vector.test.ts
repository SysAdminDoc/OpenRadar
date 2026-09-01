import { describe, expect, it } from "vitest";
import { syncVectorLane, type VectorLane } from "./vector";
import type { MapLike } from "./raster";

/** A map that remembers what it was told, and what data it is holding. */
function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const map: MapLike & {
    sources: typeof sources;
    layers: typeof layers;
    calls: string[];
  } = {
    sources,
    layers,
    calls,
    getSource: (id) => {
      if (!sources.has(id)) return undefined;
      return {
        setData: (data: unknown) => {
          calls.push(`setData ${id}`);
          sources.set(id, data);
        },
      };
    },
    addSource: ((id: string, source: { data: unknown }) => {
      calls.push(`addSource ${id}`);
      sources.set(id, source.data);
    }) as MapLike["addSource"],
    removeSource: (id) => {
      calls.push(`removeSource ${id}`);
      sources.delete(id);
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

const LANE: VectorLane = {
  sourceId: "test-source",
  layers: () => [
    { id: "test-fill", type: "fill", source: "test-source" },
    { id: "test-line", type: "line", source: "test-source" },
  ],
};

const under = () => "openradar-tool-line";
const SHAPES = { type: "FeatureCollection", features: [] };

describe("one vector lane's whole life", () => {
  it("adds the source, then every layer, in the order they are listed", () => {
    // The lane's own order is its business. Asking the arrangement per layer
    // would let it reorder the inside of one lane, which it knows nothing
    // about.
    const map = fakeMap();
    expect(syncVectorLane(map, LANE, SHAPES, under)).toBe(true);
    expect(map.calls).toEqual([
      "addSource test-source",
      "addLayer test-fill before openradar-tool-line",
      "addLayer test-line before openradar-tool-line",
    ]);
  });

  it("refills the source rather than rebuilding the layers", () => {
    const map = fakeMap();
    syncVectorLane(map, LANE, SHAPES, under);
    map.calls.length = 0;

    const next = { type: "FeatureCollection", features: [{ id: 1 }] };
    expect(syncVectorLane(map, LANE, next, under)).toBe(false);
    expect(map.calls).toEqual(["setData test-source"]);
    expect(map.sources.get("test-source")).toBe(next);
    expect(map.layers.size).toBe(2);
  });

  it("takes every layer and the source away when it is switched off", () => {
    const map = fakeMap();
    syncVectorLane(map, LANE, SHAPES, under);
    map.calls.length = 0;

    expect(syncVectorLane(map, LANE, null, under)).toBe(true);
    expect(map.calls).toEqual([
      "removeLayer test-fill",
      "removeLayer test-line",
      "removeSource test-source",
    ]);
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });

  it("says nothing changed for a lane that was never on", () => {
    // One of the three this replaced republished the whole layer list every
    // time it was called with nothing, which is on every render of a
    // workspace with no route in it.
    const map = fakeMap();
    expect(syncVectorLane(map, LANE, null, under)).toBe(false);
    expect(syncVectorLane(map, LANE, undefined, under)).toBe(false);
    expect(map.calls).toEqual([]);
  });

  it("comes back whole after being switched off", () => {
    const map = fakeMap();
    syncVectorLane(map, LANE, SHAPES, under);
    syncVectorLane(map, LANE, null, under);
    map.calls.length = 0;

    expect(syncVectorLane(map, LANE, SHAPES, under)).toBe(true);
    expect(map.layers.size).toBe(2);
  });

  it("reads its layers again each time, so a preference can change them", () => {
    // Several of these are drawn heavier when the reader asks for more
    // contrast, and the band is dropped and rebuilt to apply that. A list
    // captured once would rebuild it exactly as it was.
    let width = 2;
    const lane: VectorLane = {
      sourceId: "test-source",
      layers: () => [
        { id: "test-line", type: "line", paint: { "line-width": width } },
      ],
    };
    const map = fakeMap();
    syncVectorLane(map, lane, SHAPES, under);
    expect(map.layers.get("test-line")).toMatchObject({
      paint: { "line-width": 2 },
    });

    width = 4;
    syncVectorLane(map, lane, null, under);
    syncVectorLane(map, lane, SHAPES, under);
    expect(map.layers.get("test-line")).toMatchObject({
      paint: { "line-width": 4 },
    });
  });

  it("puts an empty collection on the map rather than taking it off", () => {
    // An empty answer is an answer. Treating it as nothing would take the
    // layer off the stack and make "no storms right now" look like a layer
    // that failed.
    const map = fakeMap();
    expect(syncVectorLane(map, LANE, SHAPES, under)).toBe(true);
    expect(map.layers.size).toBe(2);
  });
});

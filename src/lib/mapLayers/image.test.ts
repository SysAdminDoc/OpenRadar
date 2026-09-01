import { describe, expect, it } from "vitest";
import { syncImageLane, type ImageLane, type PinnedImage } from "./image";
import type { MapLike } from "./raster";

function fakeMap() {
  const sources = new Map<string, Record<string, unknown>>();
  const layers = new Map<string, Record<string, unknown>>();
  const shown = new Map<string, { url: string; corners: unknown }>();
  const paint = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    sources,
    layers,
    shown,
    paint,
    calls,
    getSource: (id: string) => {
      if (!sources.has(id)) return undefined;
      return {
        updateImage: (next: { url: string; coordinates: unknown }) => {
          calls.push(`updateImage ${id}`);
          shown.set(id, { url: next.url, corners: next.coordinates });
        },
      };
    },
    addSource: ((id: string, source: Record<string, unknown>) => {
      calls.push(`addSource ${id}`);
      sources.set(id, source);
      shown.set(id, {
        url: String(source.url),
        corners: source.coordinates,
      });
    }) as MapLike["addSource"],
    removeSource: (id: string) => {
      calls.push(`removeSource ${id}`);
      sources.delete(id);
      shown.delete(id);
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
}

const LANE: ImageLane = {
  sourceId: "sweep-source",
  layerId: "sweep-layer",
  paint: { "raster-resampling": "nearest", "raster-fade-duration": 0 },
};

const CORNERS: Array<[number, number]> = [
  [-98, 36],
  [-96, 36],
  [-96, 34],
  [-98, 34],
];

const picture = (overrides: Partial<PinnedImage> = {}): PinnedImage => ({
  url: "blob:one",
  coordinates: CORNERS,
  opacity: 0.7,
  ...overrides,
});

const under = () => "openradar-overlay-alerts-fill";

describe("a picture pinned to four corners", () => {
  it("arrives with the paint the lane asked for and the opacity it was told", () => {
    const map = fakeMap();
    expect(syncImageLane(map, LANE, picture(), under)).toBe(true);
    expect(map.calls).toEqual([
      "addSource sweep-source",
      "addLayer sweep-layer before openradar-overlay-alerts-fill",
    ]);
    expect(map.layers.get("sweep-layer")).toMatchObject({
      paint: {
        "raster-resampling": "nearest",
        "raster-fade-duration": 0,
        "raster-opacity": 0.7,
      },
    });
  });

  it("moves the image and its corners together", () => {
    // A new volume drawn over the previous one's footprint, even for a frame,
    // puts a storm somewhere it was not.
    const map = fakeMap();
    syncImageLane(map, LANE, picture(), under);
    map.calls.length = 0;

    const moved: Array<[number, number]> = [
      [-99, 37],
      [-97, 37],
      [-97, 35],
      [-99, 35],
    ];
    expect(
      syncImageLane(
        map,
        LANE,
        picture({ url: "blob:two", coordinates: moved }),
        under,
      ),
    ).toBe(false);
    expect(map.calls).toEqual(["updateImage sweep-source"]);
    expect(map.shown.get("sweep-source")).toEqual({
      url: "blob:two",
      corners: moved,
    });
  });

  it("follows the opacity without rebuilding anything", () => {
    const map = fakeMap();
    syncImageLane(map, LANE, picture(), under);
    syncImageLane(map, LANE, picture({ opacity: 0.2 }), under);
    expect(map.paint.get("sweep-layer.raster-opacity")).toBe(0.2);
    expect(map.layers.size).toBe(1);
  });

  it("takes the layer and the source away together", () => {
    const map = fakeMap();
    syncImageLane(map, LANE, picture(), under);
    map.calls.length = 0;

    expect(syncImageLane(map, LANE, null, under)).toBe(true);
    expect(map.calls).toEqual([
      "removeLayer sweep-layer",
      "removeSource sweep-source",
    ]);
  });

  it("says nothing changed for a lane that was never on", () => {
    const map = fakeMap();
    expect(syncImageLane(map, LANE, null, under)).toBe(false);
    expect(map.calls).toEqual([]);
  });
});

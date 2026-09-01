import { describe, expect, it } from "vitest";
import { baseOpacity } from "./opacity";
import { OVERLAY_ADAPTERS } from "../overlays";

describe("what a reader's opacity slider multiplies", () => {
  it("remembers both halves of a symbol layer", () => {
    // The station plots are the only symbol layers here, and their slider
    // stored a value and changed nothing until this was a pair: an icon and
    // its text fade through separate properties.
    expect(baseOpacity({ id: "plot", type: "symbol", paint: {} })).toEqual([
      ["icon-opacity", 1],
      ["text-opacity", 1],
    ]);
  });

  it("keeps the value the layer was designed with, expression and all", () => {
    // Flattening an expression to a number would throw the design away: the
    // alert fill is fainter than its outline and a faded flash is fainter
    // than a fresh one.
    const fade = ["interpolate", ["linear"], ["get", "age"], 0, 1, 300, 0.2];
    expect(
      baseOpacity({
        id: "flash",
        type: "circle",
        paint: { "circle-opacity": fade },
      }),
    ).toEqual([["circle-opacity", fade]]);
  });

  it("gives a layer that never said MapLibre's own default", () => {
    expect(baseOpacity({ id: "a", type: "fill" })).toEqual([
      ["fill-opacity", 1],
    ]);
    expect(baseOpacity({ id: "b", type: "line", paint: {} })).toEqual([
      ["line-opacity", 1],
    ]);
  });

  it("has nothing to say about a layer with no opacity of its own", () => {
    // A raster or a custom layer is not in the overlay band and its opacity
    // is decided elsewhere.
    expect(baseOpacity({ id: "c", type: "raster" })).toEqual([]);
    expect(baseOpacity({ id: "d", type: "background" })).toEqual([]);
  });

  it("covers every layer every overlay adapter draws", () => {
    // The check that would have caught the station plots. A layer type this
    // does not name has a slider in the panel that does nothing, and nothing
    // else in the app would notice.
    for (const adapter of OVERLAY_ADAPTERS) {
      for (const layer of adapter.layers(`source-${adapter.id}`)) {
        expect(
          baseOpacity(layer as never).length,
          `${adapter.id}: ${layer.id} is a ${layer.type}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

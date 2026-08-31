import { describe, expect, it } from "vitest";
import { layerStackOrder, stackHeight, topmost } from "./layerStack";
import { OVERLAY_ADAPTERS } from "./overlays/index";

/** A hit test result, cut down to the part that decides which one wins. */
const hitOn = (id: string) => ({ layer: { id } });

describe("which layer a click answers with", () => {
  it("picks the one drawn on top, whichever order the hits arrive in", () => {
    const order = ["bottom", "middle", "top"];
    const hits = [hitOn("bottom"), hitOn("top"), hitOn("middle")];
    expect(topmost(hits, order)?.layer.id).toBe("top");
    expect(topmost([...hits].reverse(), order)?.layer.id).toBe("top");
  });

  it("keeps the first of two hits on the same layer", () => {
    // A hit test hands its results back nearest the viewer first, so among
    // features at the same height the earlier one is the one on top. Every
    // alert in the country is drawn by a single fill layer, so a tornado
    // warning inside a flood watch arrives as two hits at the same height.
    const order = ["bottom", "alerts"];
    const first = { layer: { id: "alerts" }, what: "warning" };
    const second = { layer: { id: "alerts" }, what: "watch" };
    expect(topmost([first, second], order)?.what).toBe("warning");
    expect(topmost([second, first], order)?.what).toBe("watch");
    // And a genuinely higher layer still wins over both.
    const above = { layer: { id: "tools" }, what: "tool" };
    expect(topmost([first, above, second], order)?.what).toBe("tool");
  });

  it("has nothing to say about an empty click", () => {
    expect(topmost([], ["a", "b"])).toBeNull();
  });

  it("lets a layer nobody placed answer rather than making it unreachable", () => {
    // The same miss the insertion anchor makes, and the safer one: a layer
    // added without being put in the order is drawn on top, so it should be
    // clickable rather than silently deaf.
    const order = ["bottom", "top"];
    expect(topmost([hitOn("top"), hitOn("brand-new")], order)?.layer.id).toBe(
      "brand-new",
    );
    expect(stackHeight(order, "brand-new")).toBeGreaterThan(
      stackHeight(order, "top"),
    );
  });
});

describe("guidance never sits in front of a decision", () => {
  // The real overlay layer ids, in their default arrangement, so the test
  // measures the order the map is actually built with.
  const order = layerStackOrder(
    OVERLAY_ADAPTERS.flatMap((adapter) =>
      adapter
        .layers(`openradar-overlay-${adapter.id}`)
        .map((layer) => layer.id),
    ),
  );

  it("draws severe probability under every warning", () => {
    // A warning is somebody telling you to take cover. A model's guess at what
    // a storm might do is not, and it is drawn underneath for that reason. The
    // click handler reads this same order, so the two cannot drift: it used to
    // ask the guidance layer first, and a tornado warning was then unreachable
    // by click anywhere the model had drawn over the same storm.
    const guidance = order.filter((id) => id.includes("probsevere"));
    const warnings = order.filter((id) => id.includes("overlay-alerts"));
    expect(guidance.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
    for (const guess of guidance) {
      for (const warning of warnings) {
        expect(stackHeight(order, guess)).toBeLessThan(
          stackHeight(order, warning),
        );
      }
    }
  });

  it("answers a click over both with the warning", () => {
    const guidance = order.find((id) => id.includes("probsevere-fill"));
    const warning = order.find((id) => id.includes("overlay-alerts"));
    expect(guidance).toBeDefined();
    expect(warning).toBeDefined();
    expect(
      topmost([hitOn(guidance as string), hitOn(warning as string)], order)
        ?.layer.id,
    ).toBe(warning);
  });

  it("puts every storm cell above the pictures it was found in", () => {
    // Same rule, the other way up: the radar's own reading of a storm should
    // not be hidden by a model's guess about it.
    const cells = order.filter((id) => id.includes("cell-"));
    const guidance = order.filter((id) => id.includes("probsevere"));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      for (const guess of guidance) {
        expect(stackHeight(order, cell)).toBeGreaterThan(
          stackHeight(order, guess),
        );
      }
    }
  });
});
